package controller

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	taskdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func relayHandler(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	var err *types.NewAPIError
	switch info.RelayMode {
	case relayconstant.RelayModeImagesGenerations, relayconstant.RelayModeImagesEdits:
		err = relay.ImageHelper(c, info)
	case relayconstant.RelayModeAudioSpeech:
		fallthrough
	case relayconstant.RelayModeAudioTranslation:
		fallthrough
	case relayconstant.RelayModeAudioTranscription:
		err = relay.AudioHelper(c, info)
	case relayconstant.RelayModeRerank:
		err = relay.RerankHelper(c, info)
	case relayconstant.RelayModeEmbeddings:
		err = relay.EmbeddingHelper(c, info)
	case relayconstant.RelayModeResponses, relayconstant.RelayModeResponsesCompact:
		err = relay.ResponsesHelper(c, info)
	case relayconstant.RelayModeAlphaSearch:
		err = relay.AlphaSearchHelper(c, info)
	default:
		err = relay.TextHelper(c, info)
	}
	return err
}

func geminiRelayHandler(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	var err *types.NewAPIError
	if strings.Contains(c.Request.URL.Path, "embed") {
		err = relay.GeminiEmbeddingHandler(c, info)
	} else {
		err = relay.GeminiHelper(c, info)
	}
	return err
}

func Relay(c *gin.Context, relayFormat types.RelayFormat) {

	requestId := c.GetString(common.RequestIdKey)
	var (
		newAPIError *types.NewAPIError
		ws          *websocket.Conn
	)

	if relayFormat == types.RelayFormatOpenAIRealtime {
		var err error
		ws, err = upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			helper.WssError(c, ws, types.NewError(err, types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry()).ToOpenAIError())
			return
		}
		defer ws.Close()
	}

	defer func() {
		if newAPIError != nil {
			service.RecordRequestPolicyTermination(c, newAPIError)
			writeRelayErrorResponse(c, ws, relayFormat, newAPIError, requestId)
		}
	}()

	request, err := helper.GetAndValidateRequest(c, relayFormat)
	if err != nil {
		// Map "request body too large" to 413 so clients can handle it correctly
		if common.IsRequestBodyTooLargeError(err) || errors.Is(err, common.ErrRequestBodyTooLarge) {
			newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, http.StatusRequestEntityTooLarge, types.ErrOptionWithSkipRetry())
		} else {
			newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithStatusCode(http.StatusBadRequest), types.ErrOptionWithSkipRetry())
		}
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, relayFormat, request, ws)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeGenRelayInfoFailed)
		return
	}

	defer func() {
		recovered := recover()
		resultErr := newAPIError
		if recovered != nil {
			resultErr = types.NewError(fmt.Errorf("relay panic: %v", recovered), types.ErrorCodeBadResponse)
		}
		if relayFormat != types.RelayFormatOpenAIRealtime {
			perfmetrics.RecordRelayResult(c.Request.Context(), relayInfo, resultErr)
		}
		if recovered != nil {
			panic(recovered)
		}
	}()

	if newAPIError = relay.PrepareRequestBilling(c, relayInfo); newAPIError != nil {
		return
	}
	defer func() {
		newAPIError = relay.RefundFailedRequestBilling(c, relayInfo, newAPIError)
	}()

	retryParam := &service.RetryParam{
		Ctx:         c,
		TokenGroup:  relayInfo.TokenGroup,
		ModelName:   relayInfo.OriginModelName,
		RequestPath: c.Request.URL.Path,
		Retry:       common.GetPointer(0),
	}
	defer service.FinalizeChannelExecutionTrace(c)
	relayInfo.RetryIndex = 0
	relayInfo.LastError = nil
	var retrySameChannel *model.Channel
	sameChannelRetriesUsed := 0
	var lastFailedChannelError *types.NewAPIError

	for {
		relayInfo.StreamStatus = nil
		relayInfo.PerformanceBusinessRejection = false
		relayInfo.PerformanceOutputTokens = 0
		relayInfo.PerformanceCacheEligible = false
		relayInfo.PerformanceCachedTokens = 0
		relayInfo.PerformanceCacheInputTokens = 0
		relayInfo.PerformanceCacheCreationTokens = 0
		relayInfo.RetryIndex = retryParam.GetRetry()
		relayInfo.ResetActualResponseModel()
		var channel *model.Channel
		var channelErr *types.NewAPIError
		if retrySameChannel != nil {
			channel, channelErr = reloadChannelForRetry(retrySameChannel)
			retrySameChannel = nil
			if channelErr == nil {
				channelErr = middleware.SetupContextForSelectedChannel(c, channel, relayInfo.OriginModelName)
			}
		} else {
			channel, channelErr = getChannel(c, relayInfo, retryParam)
		}
		if channelErr != nil {
			logger.LogError(c, channelErr.Error())
			if !hasManagedRouting(c) || relayInfo.LastError == nil {
				newAPIError = channelErr
			}
			break
		}
		service.TrackResolvedChannelExecutionAttempt(c, relayInfo.UsingGroup, relayInfo.OriginModelName, c.Request.URL.Path, channel, retryParam.GetRetry())
		service.AppendUsedChannel(c, channel.Id)
		if billingErr := service.PrepareTieredBillingForSelectedGroup(c, relayInfo); billingErr != nil {
			newAPIError = billingErr
			break
		}

		bodyStorage, bodyErr := common.GetBodyStorage(c)
		if bodyErr != nil {
			// Ensure consistent 413 for oversized bodies even when error occurs later (e.g., retry path)
			if common.IsRequestBodyTooLargeError(bodyErr) || errors.Is(bodyErr, common.ErrRequestBodyTooLarge) {
				newAPIError = types.NewErrorWithStatusCode(bodyErr, types.ErrorCodeReadRequestBodyFailed, http.StatusRequestEntityTooLarge, types.ErrOptionWithSkipRetry())
			} else {
				newAPIError = types.NewErrorWithStatusCode(bodyErr, types.ErrorCodeReadRequestBodyFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}
			break
		}
		c.Request.Body = io.NopCloser(bodyStorage)

		switch relayFormat {
		case types.RelayFormatOpenAIRealtime:
			newAPIError = relay.WssHelper(c, relayInfo)
		case types.RelayFormatClaude:
			newAPIError = relay.ClaudeHelper(c, relayInfo)
		case types.RelayFormatGemini:
			newAPIError = geminiRelayHandler(c, relayInfo)
		default:
			newAPIError = relayHandler(c, relayInfo)
		}

		if newAPIError == nil {
			service.MarkRequestPolicySuccess(c, relayInfo.StreamStatus)
			relayInfo.LastError = nil
			if isSuccessfulStreamResult(relayInfo.StreamStatus) {
				service.MarkChannelRouteSuccess(c)
				service.MarkTokenGroupRouteSuccess(c)
				service.MarkChannelExecutionSuccess(c)
			}
			return
		}
		if c.Request.Context().Err() != nil {
			if relayInfo.StreamStatus == nil {
				relayInfo.StreamStatus = relaycommon.NewStreamStatus()
				relayInfo.StreamStatus.SetEndReason(relaycommon.StreamEndReasonClientGone, c.Request.Context().Err())
			}
			return
		}

		newAPIError = service.NormalizeViolationFeeError(newAPIError)
		relayInfo.LastError = newAPIError
		service.TrackChannelExecutionFailure(c, channel.Id, channelExecutionErrorReason(newAPIError))
		if shouldRetrySameChannel(c, newAPIError, sameChannelRetriesUsed) {
			sameChannelRetriesUsed++
			retrySameChannel = channel
			service.TrackChannelExecutionSameChannelRetry(c, channel, sameChannelRetriesUsed)
			logger.LogInfo(c, fmt.Sprintf("渠道路由同渠道重试：渠道 #%d（%d/%d）", channel.Id, sameChannelRetriesUsed, common.ChannelRouteSameChannelRetries))
			recordChannelErrorLog(c, newAPIError, relayInfo, true)
			continue
		}

		decision := service.DecideRelayRetry(c, newAPIError, common.RetryTimes-retryParam.GetRetry())
		service.RecordPolicyFailure(c, channel.Id, newAPIError, decision)
		routeAdvanced := processChannelError(c, *types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey, common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()), newAPIError)
		sameChannelRetriesUsed = 0
		lastFailedChannelError = newAPIError
		willRetry := shouldAttemptNextChannel(c, newAPIError, common.RetryTimes-retryParam.GetRetry(), routeAdvanced)
		if willRetry {
			recordChannelErrorLog(c, newAPIError, relayInfo, true)
			retryParam.IncreaseRetry()
			continue
		}
		break
	}

	useChannel := c.GetStringSlice("use_channel")
	if len(useChannel) > 1 {
		mode := "重试"
		if service.IsChannelRouteEnabled() {
			mode = "渠道路由"
		}
		retryLogStr := fmt.Sprintf("%s：%s", mode, strings.Trim(strings.Join(strings.Fields(fmt.Sprint(useChannel)), "->"), "[]"))
		logger.LogInfo(c, retryLogStr)
	}
	if newAPIError != nil {
		finalReason := channelExecutionErrorReason(newAPIError)
		prepareRelayErrorResponse(c, newAPIError, requestId)
		service.MarkChannelExecutionFailed(c, finalReason)
		if lastFailedChannelError != nil {
			recordChannelErrorLog(c, newAPIError, relayInfo, false)
		}
	}
}

func writeRelayErrorResponse(c *gin.Context, ws *websocket.Conn, relayFormat types.RelayFormat, err *types.NewAPIError, requestId string) {
	if err == nil {
		return
	}
	preparation := prepareRelayErrorResponse(c, err, requestId)
	err = preparation.Err
	logger.LogError(c, fmt.Sprintf("relay error: %s", common.LocalLogPreview(preparation.LogMessage)))

	if relayFormat == types.RelayFormatOpenAIRealtime {
		helper.WssError(c, ws, err.ToOpenAIError())
		return
	}
	if c.Writer.Written() {
		if strings.HasPrefix(strings.ToLower(c.Writer.Header().Get("Content-Type")), "text/event-stream") {
			writeRelayStreamError(c, relayFormat, err)
		}
		return
	}

	if relayFormat == types.RelayFormatClaude {
		c.JSON(err.StatusCode, gin.H{
			"type":  "error",
			"error": err.ToClaudeError(),
		})
		return
	}
	c.JSON(err.StatusCode, gin.H{
		"error": err.ToOpenAIError(),
	})
}

func writeRelayStreamError(c *gin.Context, relayFormat types.RelayFormat, err *types.NewAPIError) {
	if c == nil || c.Writer == nil || c.Request == nil || c.Request.Context().Err() != nil {
		return
	}

	var event string
	var payload any
	switch relayFormat {
	case types.RelayFormatClaude:
		event = "error"
		payload = gin.H{"type": "error", "error": err.ToClaudeError()}
	case types.RelayFormatOpenAIResponses, types.RelayFormatOpenAIResponsesCompaction:
		event = "error"
		payload = gin.H{"type": "error", "error": err.ToOpenAIError()}
	default:
		payload = gin.H{"error": err.ToOpenAIError()}
	}

	data, marshalErr := common.Marshal(payload)
	if marshalErr != nil {
		logger.LogError(c, "failed to marshal stream error: "+marshalErr.Error())
		return
	}
	helper.ExtendWriteDeadline(c)
	if event != "" {
		_, _ = fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, data)
	} else {
		_, _ = fmt.Fprintf(c.Writer, "data: %s\n\n", data)
	}
	_ = helper.FlushWriter(c)
}

// CountClaudeTokens implements Anthropic's token-counting utility endpoint.
// It deliberately skips upstream generation and billing; callers use this
// endpoint to size prompts before creating a Message.
func CountClaudeTokens(c *gin.Context) {
	request, err := helper.GetAndValidateClaudeRequest(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"type": "error",
			"error": gin.H{
				"type":    "invalid_request_error",
				"message": common.MessageWithRequestId(err.Error(), c.GetString(common.RequestIdKey)),
			},
		})
		return
	}

	info := relaycommon.GenRelayInfoClaude(c, request)
	inputTokens, err := service.CountRequestToken(c, request.GetTokenCountMeta(), info)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"type": "error",
			"error": gin.H{
				"type":    "api_error",
				"message": common.MessageWithRequestId(err.Error(), c.GetString(common.RequestIdKey)),
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"input_tokens": inputTokens})
}

var upgrader = websocket.Upgrader{
	Subprotocols: []string{"realtime", "responses"}, // WS 握手支持的协议，如果有使用 Sec-WebSocket-Protocol，则必须在此声明对应的 Protocol
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许跨域
	},
}

func getChannel(c *gin.Context, info *relaycommon.RelayInfo, retryParam *service.RetryParam) (*model.Channel, *types.NewAPIError) {
	if info.ChannelMeta == nil {
		autoBan := c.GetBool("auto_ban")
		autoBanInt := 1
		if !autoBan {
			autoBanInt = 0
		}
		channel := &model.Channel{
			Id:      c.GetInt("channel_id"),
			Type:    c.GetInt("channel_type"),
			Name:    c.GetString("channel_name"),
			AutoBan: &autoBanInt,
		}
		service.RequestPolicy(c).BeginAttempt(channel, info.UsingGroup)
		return channel, nil
	}
	channel, selectGroup, err := service.CacheGetRandomSatisfiedChannel(retryParam)
	if err != nil {
		return nil, types.NewError(fmt.Errorf("获取分组 %s 下模型 %s 的可用渠道失败（retry）: %s", selectGroup, info.OriginModelName, err.Error()), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}
	if channel == nil {
		return nil, types.NewError(fmt.Errorf("分组 %s 下模型 %s 的可用渠道不存在（retry）", selectGroup, info.OriginModelName), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}

	info.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, info)

	service.RequestPolicy(c).BeginAttempt(channel, selectGroup)
	newAPIError := middleware.SetupContextForSelectedChannel(c, channel, info.OriginModelName)
	if newAPIError != nil {
		return nil, newAPIError
	}
	return channel, nil
}

const relayErrorResponsePreparationKey = "relay_error_response_preparation"

type relayErrorResponsePreparation struct {
	Err                *types.NewAPIError
	LogMessage         string
	OriginalStatusCode int
	OriginalMessage    string
	UserStatusCode     int
	UserMessage        string
	CustomErrorApplied bool
}

func isSuccessfulStreamResult(status *relaycommon.StreamStatus) bool {
	return status == nil || (status.IsNormalEnd() && !status.HasErrors() && (status.ResponseOutcome() == "" || status.ResponseOutcome() == "completed"))
}

func reloadChannelForRetry(channel *model.Channel) (*model.Channel, *types.NewAPIError) {
	if channel == nil || channel.Id <= 0 {
		return nil, types.NewError(errors.New("retry channel is nil"), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}
	reloaded, err := model.CacheGetChannel(channel.Id)
	if err != nil {
		return nil, types.NewError(fmt.Errorf("reload channel #%d for retry failed: %w", channel.Id, err), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}
	return reloaded, nil
}

func shouldRetry(c *gin.Context, openaiErr *types.NewAPIError, retryTimes int) bool {
	return retryTimes > 0 && !operation_setting.IsAlwaysSkipRetryError(openaiErr) && !helper.StreamOutputStarted(c) && service.ShouldRetryRelayError(c, openaiErr, retryTimes)
}

func shouldAttemptNextChannel(c *gin.Context, openaiErr *types.NewAPIError, retryTimes int, routeAdvanced bool) bool {
	if helper.StreamOutputStarted(c) {
		return false
	}
	if hasManagedRouting(c) {
		return routeAdvanced
	}
	return shouldRetry(c, openaiErr, retryTimes)
}

func hasManagedRouting(c *gin.Context) bool {
	return service.IsChannelRouteEnabled() || service.HasTokenGroupRoutes(c)
}

func shouldRetrySameChannel(c *gin.Context, err *types.NewAPIError, retriesUsed int) bool {
	return !helper.StreamOutputStarted(c) && service.ShouldRetrySameChannelRouteForContext(c, err, retriesUsed)
}

func channelExecutionErrorReason(err *types.NewAPIError) string {
	if err == nil {
		return ""
	}
	reason := err.ErrorWithStatusCode()
	internalErr := err.InternalError()
	if internalErr == nil || internalErr.Error() == err.Error() {
		return reason
	}
	internalReason := common.LocalLogPreview(internalErr.Error())
	if internalReason == "" || strings.Contains(reason, internalReason) {
		return reason
	}
	return fmt.Sprintf("%s; transport_error=%s", reason, internalReason)
}

func processChannelError(c *gin.Context, channelError types.ChannelError, err *types.NewAPIError, relayInfos ...*relaycommon.RelayInfo) bool {
	routeAdvanced := service.HandleChannelFailure(c, channelError, err)
	if len(relayInfos) > 0 {
		previousChannelID, hadChannelID := c.Get("channel_id")
		c.Set("channel_id", channelError.ChannelId)
		recordChannelErrorLog(c, err, relayInfos[0], false)
		if hadChannelID {
			c.Set("channel_id", previousChannelID)
		}
	}
	return routeAdvanced
}

func recordChannelErrorLog(c *gin.Context, err *types.NewAPIError, relayInfo *relaycommon.RelayInfo, adminOnly bool) {
	if constant.ErrorLogEnabled && types.IsRecordErrorLog(err) {
		// 保存错误日志到mysql中
		userId := c.GetInt("id")
		tokenName := c.GetString("token_name")
		modelName := c.GetString("original_model")
		tokenId := c.GetInt("token_id")
		userGroup := c.GetString("group")
		other := model.NewLogOther()
		if c.Request != nil && c.Request.URL != nil {
			other.SetPublic("request_path", c.Request.URL.Path)
		}
		other.SetPublic("error_type", err.GetErrorType())
		other.SetPublic("error_code", err.GetErrorCode())
		statusCode, logContent := relayErrorLogDetails(c, err)
		other.SetPublic("status_code", statusCode)
		service.AppendRelayLogAdminInfo(c, relayInfo, other)
		service.AppendChannelExecutionTraceErrorAdminInfoToLogOther(c, other)
		service.AppendStreamStatusForLog(relayInfo, other)
		if adminOnly {
			other.SetAdmin("retry_intermediate", true)
			model.MarkLogAdminOnly(other)
		}
		service.AppendTaskPluginContextAuditInfo(c, other)
		startTime := common.GetContextKeyTime(c, constant.ContextKeyRequestStartTime)
		if startTime.IsZero() {
			startTime = time.Now()
		}
		useTimeSeconds := int(time.Since(startTime).Seconds())
		actualResponseModel := ""
		if relayInfo != nil {
			actualResponseModel = relayInfo.ActualResponseModel()
		}
		model.RecordErrorLog(c, userId, c.GetInt("channel_id"), modelName, actualResponseModel, tokenName, logContent, tokenId, useTimeSeconds, common.GetContextKeyBool(c, constant.ContextKeyIsStream), userGroup, other)
	}

}

func prepareRelayErrorResponse(c *gin.Context, err *types.NewAPIError, requestId string) *relayErrorResponsePreparation {
	if c != nil {
		if value, exists := c.Get(relayErrorResponsePreparationKey); exists {
			if preparation, ok := value.(*relayErrorResponsePreparation); ok && preparation != nil {
				return preparation
			}
		}
	}
	logMessage := err.Error()
	originalMessage := logMessage
	if originalErr := err.InternalError(); originalErr != nil {
		originalMessage = originalErr.Error()
	}
	originalStatusCode := err.StatusCode
	customErrorApplied, messageReplaced := operation_setting.ApplyCustomErrorResponseWithResult(err)
	if messageReplaced {
		err.DisableResponseMasking()
	} else if originalErr := err.InternalError(); originalErr != nil {
		err.SetResponseMessage(originalErr.Error())
	}
	setRelayResponseRequestId(err, requestId)
	userMessage := err.Error()
	if !messageReplaced {
		userMessage = common.MaskSensitiveInfo(userMessage)
	}
	preparation := &relayErrorResponsePreparation{Err: err, LogMessage: logMessage, OriginalStatusCode: originalStatusCode, OriginalMessage: originalMessage, UserStatusCode: err.StatusCode, UserMessage: userMessage, CustomErrorApplied: customErrorApplied}
	if c != nil {
		c.Set(relayErrorResponsePreparationKey, preparation)
		service.RecordChannelExecutionFinalOutcome(c, preparation.OriginalStatusCode, preparation.OriginalMessage, preparation.UserStatusCode, preparation.UserMessage, preparation.CustomErrorApplied)
	}
	return preparation
}

func setRelayResponseRequestId(err *types.NewAPIError, requestId string) {
	if err == nil {
		return
	}
	message := common.MessageWithoutRequestId(err.Error())
	if requestId != "" {
		message = common.MessageWithRequestId(message, requestId)
	}
	// SetResponseMessage updates both the wrapped error and the protocol-specific
	// error payload used by OpenAI and Claude responses.
	err.SetResponseMessage(message)
}

func formatRelayErrorLogContent(err *types.NewAPIError) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if originalErr := err.InternalError(); originalErr != nil {
		message = originalErr.Error()
	}
	return formatRelayErrorStatusMessage(err.StatusCode, message)
}

func relayErrorLogDetails(c *gin.Context, err *types.NewAPIError) (int, string) {
	if c != nil {
		if value, exists := c.Get(relayErrorResponsePreparationKey); exists {
			if preparation, ok := value.(*relayErrorResponsePreparation); ok && preparation != nil && preparation.Err == err {
				return preparation.UserStatusCode, formatRelayErrorStatusMessage(
					preparation.UserStatusCode,
					preparation.UserMessage,
				)
			}
		}
	}
	return err.StatusCode, formatRelayErrorLogContent(err)
}

func formatRelayErrorStatusMessage(statusCode int, message string) string {
	message = common.MessageWithoutRequestId(message)
	if statusCode == 0 {
		return message
	}
	if message == "" {
		return fmt.Sprintf("status_code=%d", statusCode)
	}
	return fmt.Sprintf("status_code=%d, %s", statusCode, message)
}

func RelayMidjourney(c *gin.Context) {
	policy := service.RequestPolicy(c)
	defer func() {
		if policy.Attempts > 0 && !policy.Successful {
			service.RecordRequestPolicyTermination(c, types.NewErrorWithStatusCode(errors.New("Midjourney submission failed"), types.ErrorCodeBadResponseStatusCode, http.StatusBadGateway, types.ErrOptionWithSkipRetry()))
		}
	}()
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatMjProxy, nil, nil)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"description": fmt.Sprintf("failed to generate relay info: %s", err.Error()),
			"type":        "upstream_error",
			"code":        4,
		})
		return
	}

	var mjErr *taskdto.MidjourneyResponse
	switch relayInfo.RelayMode {
	case relayconstant.RelayModeMidjourneyNotify:
		mjErr = relay.RelayMidjourneyNotify(c)
	case relayconstant.RelayModeMidjourneyTaskFetch, relayconstant.RelayModeMidjourneyTaskFetchByCondition:
		mjErr = relay.RelayMidjourneyTask(c, relayInfo.RelayMode)
	case relayconstant.RelayModeMidjourneyTaskImageSeed:
		mjErr = relay.RelayMidjourneyTaskImageSeed(c)
	case relayconstant.RelayModeSwapFace:
		mjErr = relay.RelaySwapFace(c, relayInfo)
	default:
		mjErr = relay.RelayMidjourneySubmit(c, relayInfo)
	}
	log.Println(mjErr)
	if mjErr != nil {
		policy.Successful = false
		statusCode := http.StatusBadRequest
		if mjErr.Code == 30 {
			mjErr.Result = "当前分组负载已饱和，请稍后再试，或升级账户以提升服务质量。"
			statusCode = http.StatusTooManyRequests
		}
		c.JSON(statusCode, gin.H{
			"description": fmt.Sprintf("%s %s", mjErr.Description, mjErr.Result),
			"type":        "upstream_error",
			"code":        mjErr.Code,
		})
		channelId := c.GetInt("channel_id")
		logger.LogError(c, fmt.Sprintf("relay error (channel #%d, status code %d): %s", channelId, statusCode, fmt.Sprintf("%s %s", mjErr.Description, mjErr.Result)))
	}
}

func RelayNotImplemented(c *gin.Context) {
	err := types.OpenAIError{
		Message: "API not implemented",
		Type:    "new_api_error",
		Param:   "",
		Code:    "api_not_implemented",
	}
	c.JSON(http.StatusNotImplemented, gin.H{
		"error": err,
	})
}

func RelayNotFound(c *gin.Context) {
	// The web fallback may already have applied static-asset cache headers.
	// A missing API or asset can appear after an upgrade; never cache its 404.
	c.Header("Cache-Control", "no-store, no-cache, must-revalidate, private, max-age=0")
	c.Header("Pragma", "no-cache")
	c.Header("Expires", "0")
	err := types.OpenAIError{
		Message: fmt.Sprintf("Invalid URL (%s %s)", c.Request.Method, c.Request.URL.Path),
		Type:    "invalid_request_error",
		Param:   "",
		Code:    "",
	}
	c.JSON(http.StatusNotFound, gin.H{
		"error": err,
	})
}

// RelayTaskPluginEndpoint keeps unclaimed shared-endpoint traffic on its
// existing handler while claimed requests enter the generation-pinned
// host-owned protocol bridge.
func RelayTaskPluginEndpoint(c *gin.Context, fallback gin.HandlerFunc) {
	pinnedValue, exists := c.Get(pluginruntime.ContextKeyPinnedEndpoint)
	if !exists {
		fallback(c)
		return
	}
	pinned, ok := pinnedValue.(pluginruntime.PinnedEndpoint)
	if !ok || pinned.Plugin == nil || pinned.Generation == nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"message": "Task protocol request failed",
				"type":    "new_api_error",
				"code":    "task_protocol_error",
			},
		})
		return
	}
	switch pinned.Protocol {
	case "openai_responses":
		serveTaskPluginProtocol(c, pinned, defaultPluginProtocolBridgeDeps())
	case pluginruntime.ProtocolOpenAIImage:
		serveTaskPluginImageProtocol(c, pinned, defaultPluginProtocolBridgeDeps())
	default:
		fallback(c)
	}
}

func RelayTaskFetch(c *gin.Context) {
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &taskdto.TaskError{
			Code:       "gen_relay_info_failed",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return
	}
	if taskErr := relay.RelayTaskFetch(c, relayInfo.RelayMode); taskErr != nil {
		respondTaskError(c, taskErr)
	}
}

type taskSubmissionOutcome struct {
	Result    *relay.TaskSubmitResult
	Task      *model.Task
	RelayInfo *relaycommon.RelayInfo
}

func RelayTask(c *gin.Context) {
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		respondTaskSubmissionError(c, &taskdto.TaskError{
			Code:       "gen_relay_info_failed",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return
	}
	if action := c.GetString("task_action"); action != "" {
		relayInfo.Action = action
	}

	if taskErr := relay.ResolveOriginTask(c, relayInfo); taskErr != nil {
		respondTaskSubmissionError(c, taskErr)
		return
	}
	if taskErr := relay.ApplyOriginTaskAffinity(c, relayInfo); taskErr != nil {
		respondTaskSubmissionError(c, taskErr)
		return
	}

	outcome, taskErr := executeTaskSubmission(c, relayInfo)
	if taskErr != nil {
		respondTaskSubmissionError(c, taskErr)
		return
	}
	presentTaskSubmission(c, outcome)
}

// executeTaskSubmission owns the retry, billing, and persistence lifecycle.
// It deliberately performs no client response writes so JSON and protocol
// presenters share the same durable task barrier. Its cancellation semantics
// come from c.Request.Context: native task endpoints use the client context,
// while the Responses bridge supplies an independently bounded context.
func executeTaskSubmission(c *gin.Context, relayInfo *relaycommon.RelayInfo) (*taskSubmissionOutcome, *taskdto.TaskError) {
	return executeTaskSubmissionWith(c, relayInfo, relay.RelayTaskSubmit)
}

type taskSubmitAttempt func(*gin.Context, *relaycommon.RelayInfo) (*relay.TaskSubmitResult, *taskdto.TaskError)

func executeTaskSubmissionWith(
	c *gin.Context,
	relayInfo *relaycommon.RelayInfo,
	submit taskSubmitAttempt,
) (*taskSubmissionOutcome, *taskdto.TaskError) {
	policy := service.RequestPolicy(c)
	diagnostics := newTaskPluginSubmitDiagnostics(c)
	diagnostics.start(relayInfo)
	var result *relay.TaskSubmitResult
	var taskErr *taskdto.TaskError
	durable := false
	stage := "start"
	defer func() {
		if !durable && relayInfo.Billing != nil {
			diagnostics.refund(stage)
			relayInfo.Billing.Refund(c)
		}
	}()
	stage = "before_attempt"
	if requestErr := c.Request.Context().Err(); requestErr != nil {
		diagnostics.cancelled("before_attempt", 0)
		return nil, service.TaskErrorWrapperLocal(requestErr, "request_cancelled", http.StatusRequestTimeout)
	}

	retryParam := &service.RetryParam{
		Ctx:         c,
		TokenGroup:  relayInfo.TokenGroup,
		ModelName:   relayInfo.OriginModelName,
		RequestPath: c.Request.URL.Path,
		Retry:       common.GetPointer(0),
	}
	defer service.FinalizeChannelExecutionTrace(c)

	lockedChannel, channelLocked := relayInfo.LockedChannel.(*model.Channel)
	channelLocked = channelLocked && lockedChannel != nil
	var retrySameChannel *model.Channel
	sameChannelRetriesUsed := 0
	var lastFailedTaskChannelError *types.NewAPIError
	finalTaskErrorLogged := false
	for {
		stage = "select_channel"
		if requestErr := c.Request.Context().Err(); requestErr != nil {
			diagnostics.cancelled("before_attempt", retryParam.GetRetry()+1)
			taskErr = service.TaskErrorWrapperLocal(requestErr, "request_cancelled", http.StatusRequestTimeout)
			break
		}
		var channel *model.Channel

		if retrySameChannel != nil {
			var channelErr *types.NewAPIError
			channel, channelErr = reloadChannelForRetry(retrySameChannel)
			retrySameChannel = nil
			if channelErr != nil {
				taskErr = service.TaskErrorWrapperLocal(channelErr.Err, "reload_same_channel_retry_failed", http.StatusInternalServerError)
				break
			}
			if setupErr := middleware.SetupContextForSelectedChannel(c, channel, relayInfo.OriginModelName); setupErr != nil {
				taskErr = service.TaskErrorWrapperLocal(setupErr.Err, "setup_same_channel_retry_failed", http.StatusInternalServerError)
				break
			}
		} else if lockedCh, ok := relayInfo.LockedChannel.(*model.Channel); ok && lockedCh != nil {
			channel = lockedCh
			policy.BeginAttempt(channel, relayInfo.UsingGroup)
			if retryParam.GetRetry() > 0 {
				if setupErr := middleware.SetupContextForSelectedChannel(c, channel, relayInfo.OriginModelName); setupErr != nil {
					taskErr = service.TaskErrorWrapperLocal(setupErr.Err, "setup_locked_channel_failed", http.StatusInternalServerError)
					break
				}
			}
		} else {
			var channelErr *types.NewAPIError
			channel, channelErr = getChannel(c, relayInfo, retryParam)
			if channelErr != nil {
				logger.LogError(c, channelErr.Error())
				taskErr = service.TaskErrorWrapperLocal(channelErr.Err, "get_channel_failed", channelErr.StatusCode)
				break
			}
		}
		diagnostics.attempt(retryParam.GetRetry()+1, channel, relayInfo.LockedChannel != nil)

		service.AppendUsedChannel(c, channel.Id)
		bodyStorage, bodyErr := common.GetBodyStorage(c)
		if bodyErr != nil {
			stage = "read_body"
			if common.IsRequestBodyTooLargeError(bodyErr) || errors.Is(bodyErr, common.ErrRequestBodyTooLarge) {
				taskErr = service.TaskErrorWrapperLocal(bodyErr, "read_request_body_failed", http.StatusRequestEntityTooLarge)
			} else {
				taskErr = service.TaskErrorWrapperLocal(bodyErr, "read_request_body_failed", http.StatusBadRequest)
			}
			break
		}
		c.Request.Body = io.NopCloser(bodyStorage)

		stage = "submit"
		result, taskErr = submit(c, relayInfo)
		if requestErr := c.Request.Context().Err(); requestErr != nil {
			diagnostics.cancelled("after_submit", retryParam.GetRetry()+1)
			taskErr = service.TaskErrorWrapperLocal(requestErr, "request_cancelled", http.StatusRequestTimeout)
			break
		}
		if taskErr == nil {
			diagnostics.attemptSucceeded(retryParam.GetRetry()+1, result)
			break
		}

		taskAPIError := taskSubmissionAPIError(taskErr)
		relayInfo.LastError = taskAPIError
		decision := decideTaskRetry(c, taskErr, common.RetryTimes-retryParam.GetRetry())
		service.RecordPolicyFailure(c, channel.Id, taskAPIError, decision)
		routeAdvanced := false
		var routeError *types.NewAPIError
		if !taskErr.LocalError {
			routeError = types.NewOpenAIError(taskErr.Error, types.ErrorCodeBadResponseStatusCode, taskErr.StatusCode)
			service.TrackChannelExecutionFailure(c, channel.Id, routeError.ErrorWithStatusCode())
			if !channelLocked && shouldRetrySameChannel(c, routeError, sameChannelRetriesUsed) {
				sameChannelRetriesUsed++
				retrySameChannel = channel
				service.TrackChannelExecutionSameChannelRetry(c, channel, sameChannelRetriesUsed)
				logger.LogInfo(c, fmt.Sprintf("渠道路由同渠道重试：渠道 #%d（%d/%d）", channel.Id, sameChannelRetriesUsed, common.ChannelRouteSameChannelRetries))
				recordChannelErrorLog(c, routeError, relayInfo, true)
				continue
			}
			routeAdvanced = processChannelError(c,
				*types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey,
					common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()),
				taskAPIError)
		}

		sameChannelRetriesUsed = 0
		willRetry := decision.Action == "retry"
		if hasManagedRouting(c) {
			willRetry = !channelLocked && routeAdvanced
		}
		if routeError != nil {
			lastFailedTaskChannelError = routeError
			recordChannelErrorLog(c, routeError, relayInfo, willRetry)
			finalTaskErrorLogged = !willRetry
		}
		diagnostics.attemptFailed(retryParam.GetRetry()+1, channel, taskErr, willRetry)
		if !willRetry {
			break
		}
		retryParam.IncreaseRetry()
	}

	useChannel := c.GetStringSlice("use_channel")
	if len(useChannel) > 1 {
		mode := "重试"
		if service.IsChannelRouteEnabled() {
			mode = "渠道路由"
		}
		retryLogStr := fmt.Sprintf("%s：%s", mode, strings.Trim(strings.Join(strings.Fields(fmt.Sprint(useChannel)), "->"), "[]"))
		logger.LogInfo(c, retryLogStr)
	}
	if taskErr != nil && !finalTaskErrorLogged && lastFailedTaskChannelError != nil {
		recordChannelErrorLog(c, lastFailedTaskChannelError, relayInfo, false)
	}

	if taskErr != nil {
		service.MarkChannelExecutionFailed(c, taskErr.Message)
		diagnostics.failed(stage, "task_error", taskErr, false)
		return nil, taskErr
	}
	if result == nil {
		taskErr = service.TaskErrorWrapperLocal(errors.New("task submission returned no result"), "task_submit_failed", http.StatusInternalServerError)
		diagnostics.failed("submit", "missing_result", taskErr, false)
		return nil, taskErr
	}
	if requestErr := c.Request.Context().Err(); requestErr != nil {
		diagnostics.cancelled("before_reserve", retryParam.GetRetry()+1)
		return nil, service.TaskErrorWrapperLocal(requestErr, "request_cancelled", http.StatusRequestTimeout)
	}

	// Reserve any submit-time upward billing adjustment before persistence.
	// This keeps insertion failures fully refundable while ensuring settlement
	// after the barrier normally has a zero positive delta.
	if relayInfo.Billing != nil {
		stage = "reserve"
		diagnostics.reserve("reserve_start", result.Quota)
		if reserveErr := relayInfo.Billing.Reserve(result.Quota); reserveErr != nil {
			common.SysError("reserve adjusted task billing error: " + reserveErr.Error())
			taskErr = service.TaskErrorWrapperLocal(errors.New("insufficient quota for adjusted task cost"), string(types.ErrorCodeInsufficientUserQuota), http.StatusForbidden)
			diagnostics.failed("reserve", "insufficient_quota", taskErr, false)
			return nil, taskErr
		}
		diagnostics.reserve("reserve_complete", result.Quota)
	}
	if requestErr := c.Request.Context().Err(); requestErr != nil {
		diagnostics.cancelled("before_insert", retryParam.GetRetry()+1)
		return nil, service.TaskErrorWrapperLocal(requestErr, "request_cancelled", http.StatusRequestTimeout)
	}

	stage = "insert"
	task := model.InitTask(result.Platform, relayInfo)
	task.PrivateData.Execution = service.TaskExecutionSnapshotFromContext(c)
	task.PrivateData.UpstreamTaskID = result.UpstreamTaskID
	task.PrivateData.BillingSource = relayInfo.BillingSource
	task.PrivateData.SubscriptionId = relayInfo.SubscriptionId
	task.PrivateData.TokenId = relayInfo.TokenId
	task.PrivateData.NodeName = common.NodeName
	task.PrivateData.BillingContext = &model.TaskBillingContext{
		ModelPrice:      relayInfo.PriceData.ModelPrice,
		GroupRatio:      relayInfo.PriceData.GroupRatioInfo.GroupRatio,
		ModelRatio:      relayInfo.PriceData.ModelRatio,
		OtherRatios:     relayInfo.PriceData.OtherRatios(),
		OriginModelName: relayInfo.OriginModelName,
		BillingMode:     billing_setting.GetBillingMode(relayInfo.OriginModelName),
		PerCallBilling:  common.StringsContains(constant.TaskPricePatches, relayInfo.OriginModelName) || billing_setting.GetBillingMode(relayInfo.OriginModelName) == billing_setting.BillingModePerRequest || (billing_setting.GetBillingMode(relayInfo.OriginModelName) == billing_setting.BillingModeRatio && relayInfo.PriceData.UsePrice),
		TieredSnapshot:  relayInfo.TieredBillingSnapshot,
	}
	task.Quota = result.Quota
	task.Data = result.TaskData
	if len(result.PluginState) > 0 {
		task.PrivateData.PluginState = result.PluginState
	}
	task.Action = relayInfo.Action
	if immediate := result.Immediate; immediate != nil {
		task.Status = model.TaskStatus(immediate.Status)
		task.Progress = immediate.Progress
		if immediate.Status == model.TaskStatusSuccess || immediate.Status == model.TaskStatusFailure {
			task.FinishTime = time.Now().Unix()
		}
		if immediate.Status == model.TaskStatusFailure {
			task.FailReason = immediate.Reason
		}
		if immediate.Url != "" {
			task.PrivateData.ResultURL = immediate.Url
		} else if immediate.Status == model.TaskStatusSuccess {
			task.PrivateData.ResultURL = taskcommon.BuildProxyURL(task.TaskID)
		}
	}
	// A native submit route may declare retainResult: false. It applies only
	// to immediate terminal results: the client receives the complete response
	// once, the upstream snapshot is never persisted, and the task is not
	// retrievable afterwards. An asynchronous result on such a route keeps its
	// snapshot because polling and retrieval need it. The OpenAI Images
	// protocol delivers its images inline in the same HTTP response, so its
	// immediate results follow the same rule; an asynchronous image task is
	// expected there and is polled inside the request.
	var insertOmits []string
	immediateTerminal := result.Immediate != nil && (result.Immediate.Status == model.TaskStatusSuccess || result.Immediate.Status == model.TaskStatusFailure)
	if pinnedValue, exists := c.Get(pluginruntime.ContextKeyPinnedRoute); exists {
		pinned, ok := pinnedValue.(pluginruntime.PinnedRoute)
		if ok && pinned.Route.RetainResult != nil && !*pinned.Route.RetainResult {
			if immediateTerminal {
				task.PrivateData.ResultDiscarded = true
				insertOmits = append(insertOmits, "data")
			} else {
				logger.LogWarn(c, fmt.Sprintf("task plugin route %s %s declares retainResult: false but returned an asynchronous result; retaining task %s", pinned.Route.Method, pinned.Route.Path, task.TaskID))
			}
		}
	}
	if pinnedValue, exists := c.Get(pluginruntime.ContextKeyPinnedEndpoint); exists && immediateTerminal {
		if pinned, ok := pinnedValue.(pluginruntime.PinnedEndpoint); ok && pinned.Protocol == pluginruntime.ProtocolOpenAIImage {
			task.PrivateData.ResultDiscarded = true
			insertOmits = append(insertOmits, "data")
		}
	}
	diagnostics.insertStart(task)
	if insertErr := task.InsertWithContext(c.Request.Context(), insertOmits...); insertErr != nil {
		common.SysError("insert task error: " + insertErr.Error())
		taskErr = service.TaskErrorWrapperLocal(errors.New("failed to persist task"), "task_insert_failed", http.StatusInternalServerError)
		diagnostics.failed("insert", "database_error", taskErr, false)
		return nil, taskErr
	}
	durable = true
	service.MarkChannelRouteSuccess(c)
	service.MarkTokenGroupRouteSuccess(c)
	service.MarkChannelExecutionSuccess(c)
	stage = "settle"
	diagnostics.durable(task)
	diagnostics.settleStart(task, result.Quota)

	if settleErr := service.SettleBilling(c, relayInfo, result.Quota); settleErr != nil {
		common.SysError("settle task billing error: " + settleErr.Error())
		taskErr = service.TaskErrorWrapperLocal(errors.New("failed to settle task billing"), "task_billing_settlement_failed", http.StatusInternalServerError)
		diagnostics.failed("settle", "billing_error", taskErr, true)
		return nil, taskErr
	}
	if task.Status != model.TaskStatusFailure {
		service.MarkRequestPolicySuccess(c, nil)
	} else {
		policy.AddEvent(service.PolicyEvent{Decision: service.PolicyDecision{Action: "stop", Reason: "task_failed", Source: "upstream"}})
	}
	service.LogTaskConsumption(c, relayInfo, task)
	diagnostics.complete(task, result.Quota)

	return &taskSubmissionOutcome{Result: result, Task: task, RelayInfo: relayInfo}, nil
}

func presentTaskSubmission(c *gin.Context, outcome *taskSubmissionOutcome) {
	diagnostics := newTaskPluginSubmitDiagnostics(c)
	otherRatios := outcome.RelayInfo.PriceData.OtherRatios()
	if otherRatios == nil {
		otherRatios = map[string]float64{}
	}
	if ratiosJSON, err := common.Marshal(otherRatios); err == nil {
		c.Header("X-New-Api-Other-Ratios", string(ratiosJSON))
	}
	if pinnedValue, exists := c.Get(pluginruntime.ContextKeyPinnedRoute); exists {
		if pinned, ok := pinnedValue.(pluginruntime.PinnedRoute); ok && pinned.Plugin != nil && pinned.Route.Render != "" {
			view, err := service.BuildTaskPluginView(outcome.Task)
			requestValue, _ := c.Get(pluginruntime.ContextKeyRouteRequest)
			requestContext, _ := requestValue.(pluginruntime.RouteRequestContext)
			if err == nil {
				viewValue, valueErr := taskPluginProtocolJSONValue(view)
				if valueErr == nil {
					if body, callErr := pinned.Plugin.Engine.CallPath(c.Request.Context(), "native", []string{pinned.Route.Render}, requestContext.JSValue(), viewValue); callErr == nil {
						diagnostics.present(outcome.Task, "native_presenter")
						c.JSON(http.StatusOK, body)
						return
					} else {
						logger.LogError(c, "task plugin native submit presenter failed: "+callErr.Error())
					}
				} else {
					logger.LogError(c, "encode task plugin native submit view failed: "+valueErr.Error())
				}
			} else {
				logger.LogError(c, "build task plugin native submit view failed: "+err.Error())
			}
		}
	}
	if pinnedValue, exists := c.Get(pluginruntime.ContextKeyPinnedEndpoint); exists {
		if pinned, ok := pinnedValue.(pluginruntime.PinnedEndpoint); ok && pinned.Protocol == "openai_video" && pinned.Operation.Name == "create" {
			diagnostics.present(outcome.Task, "openai_video_create")
			c.JSON(http.StatusOK, outcome.Task.ToOpenAIVideo())
			return
		}
	}
	createdAt := outcome.Task.CreatedAt
	if createdAt == 0 {
		createdAt = outcome.Task.SubmitTime
	}
	diagnostics.present(outcome.Task, "host_fallback")
	c.JSON(http.StatusOK, map[string]any{
		"id":         outcome.Task.TaskID,
		"task_id":    outcome.Task.TaskID,
		"status":     "queued",
		"model":      outcome.RelayInfo.OriginModelName,
		"created_at": createdAt,
	})
}

func respondTaskSubmissionError(c *gin.Context, taskErr *taskdto.TaskError) {
	service.RecordRequestPolicyTermination(c, taskSubmissionAPIError(taskErr))
	newTaskPluginSubmitDiagnostics(c).presentError(taskErr)
	if middleware.RespondTaskPluginError(c, taskErr) {
		return
	}
	respondTaskError(c, taskErr)
}

// respondTaskError 统一输出 Task 错误响应（含 429 限流提示改写）
func respondTaskError(c *gin.Context, taskErr *taskdto.TaskError) {
	if taskErr.StatusCode == http.StatusTooManyRequests {
		taskErr.Message = "当前分组上游负载已饱和，请稍后再试"
	}
	c.JSON(taskErr.StatusCode, taskErr)
}

// taskSubmissionAPIError adapts a task error for the shared relay error paths.
// TaskError.Error is nil for many local rejections, so fall back to the message.
func taskSubmissionAPIError(taskErr *taskdto.TaskError) *types.NewAPIError {
	err := taskErr.Error
	if err == nil {
		err = errors.New(taskErr.Message)
	}
	return types.NewOpenAIError(err, types.ErrorCodeBadResponseStatusCode, taskErr.StatusCode)
}

// decideTaskRetry is the single retry decision for task submissions. The
// reason is recorded in the request policy decision events of the log details.
func decideTaskRetry(c *gin.Context, taskErr *taskdto.TaskError, retryTimes int) service.PolicyDecision {
	stop := service.PolicyDecision{Action: "stop", Source: "system"}
	retry := service.PolicyDecision{Action: "retry", Reason: "retry_status_matched", Source: "system"}
	switch {
	case taskErr == nil:
		stop.Reason = "request_completed"
	case taskErr.NoRetry:
		stop.Reason = "task_accepted"
	case service.ShouldSkipRetryAfterChannelAffinityFailure(c):
		stop.Reason, stop.Source = "strict_session", "session_rule"
		if source := service.RequestPolicy(c).SessionModeSource; source != "" {
			stop.Source = source
		}
	case retryTimes <= 0:
		stop.Reason, stop.Source = "attempt_budget_exhausted", "global"
	case service.GetChannelConstraints(c).SuppressesRetry():
		stop.Reason, stop.Source = "pinned_channel", "channel_constraint"
	case taskErr.StatusCode == http.StatusTooManyRequests, taskErr.StatusCode == 307:
		return retry
	case taskErr.StatusCode/100 == 5:
		// 超时不重试
		if operation_setting.IsAlwaysSkipRetryStatusCode(taskErr.StatusCode) {
			stop.Reason = "system_retry_exclusion"
			break
		}
		return retry
	case taskErr.StatusCode == http.StatusBadRequest, taskErr.StatusCode == 408:
		// azure处理超时不重试
		stop.Reason = "status_not_retryable"
	case taskErr.LocalError:
		stop.Reason = "local_rejection"
	case taskErr.StatusCode/100 == 2:
		stop.Reason = "system_retry_exclusion"
	default:
		return retry
	}
	return stop
}

func shouldRetryTaskRelay(c *gin.Context, channelId int, taskErr *taskdto.TaskError, retryTimes int) bool {
	if taskErr == nil || taskErr.NoRetry {
		return false
	}
	if service.ShouldSkipRetryAfterChannelAffinityFailure(c) {
		return false
	}
	if retryTimes <= 0 {
		return false
	}
	if service.GetChannelConstraints(c).SuppressesRetry() {
		return false
	}
	if taskErr.StatusCode == http.StatusTooManyRequests {
		return true
	}
	if taskErr.StatusCode == 307 {
		return true
	}
	if taskErr.StatusCode/100 == 5 {
		// 超时不重试
		if operation_setting.IsAlwaysSkipRetryStatusCode(taskErr.StatusCode) {
			return false
		}
		return true
	}
	if taskErr.StatusCode == http.StatusBadRequest {
		return false
	}
	if taskErr.StatusCode == 408 {
		// azure处理超时不重试
		return false
	}
	if taskErr.LocalError {
		return false
	}
	if taskErr.StatusCode/100 == 2 {
		return false
	}
	return true
}

func shouldAttemptNextTaskChannel(c *gin.Context, channelID int, taskErr *taskdto.TaskError, retryTimes int, routeAdvanced bool, channelRouteAllowed bool) bool {
	if hasManagedRouting(c) {
		return channelRouteAllowed && routeAdvanced
	}
	return shouldRetryTaskRelay(c, channelID, taskErr, retryTimes)
}
