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
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/samber/lo"

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
	//group := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	//originalModel := common.GetContextKeyString(c, constant.ContextKeyOriginalModel)

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
			writeRelayErrorResponse(c, ws, relayFormat, newAPIError, requestId)
		}
	}()

	request, err := helper.GetAndValidateRequest(c, relayFormat)
	if err != nil {
		// Map "request body too large" to 413 so clients can handle it correctly
		if common.IsRequestBodyTooLargeError(err) || errors.Is(err, common.ErrRequestBodyTooLarge) {
			newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, http.StatusRequestEntityTooLarge, types.ErrOptionWithSkipRetry())
		} else {
			newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest)
		}
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, relayFormat, request, ws)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeGenRelayInfoFailed)
		return
	}

	needSensitiveCheck := setting.ShouldCheckPromptSensitive()
	needCountToken := constant.CountToken
	// Avoid building huge CombineText (strings.Join) when token counting and sensitive check are both disabled.
	var meta *types.TokenCountMeta
	if needSensitiveCheck || needCountToken {
		meta = request.GetTokenCountMeta()
	} else {
		meta = fastTokenCountMetaForPricing(request)
	}

	if needSensitiveCheck && meta != nil {
		contains, words := service.CheckSensitiveText(meta.CombineText)
		if contains {
			logger.LogWarn(c, fmt.Sprintf("user sensitive words detected: %s", strings.Join(words, ", ")))
			newAPIError = types.NewError(err, types.ErrorCodeSensitiveWordsDetected)
			return
		}
	}

	tokens, err := service.EstimateRequestToken(c, meta, relayInfo)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeCountTokenFailed)
		return
	}

	relayInfo.SetEstimatePromptTokens(tokens)

	priceData, err := helper.ModelPriceHelper(c, relayInfo, tokens, meta)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest))
		return
	}

	// common.SetContextKey(c, constant.ContextKeyTokenCountMeta, meta)

	if priceData.FreeModel {
		logger.LogInfo(c, fmt.Sprintf("模型 %s 免费，跳过预扣费", relayInfo.OriginModelName))
	} else {
		newAPIError = service.PreConsumeBilling(c, priceData.QuotaToPreConsume, relayInfo)
		if newAPIError != nil {
			return
		}
	}

	defer func() {
		// Only return quota if downstream failed and quota was actually pre-consumed
		if newAPIError != nil {
			newAPIError = service.NormalizeViolationFeeError(newAPIError)
			if relayInfo.Billing != nil {
				relayInfo.Billing.Refund(c)
			}
			service.ChargeViolationFeeIfNeeded(c, relayInfo, newAPIError)
		}
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
	finalErrorLogged := false

	for {
		relayInfo.RetryIndex = retryParam.GetRetry()
		var channel *model.Channel
		var channelErr *types.NewAPIError
		if retrySameChannel != nil {
			channel = retrySameChannel
			retrySameChannel = nil
			channelErr = middleware.SetupContextForSelectedChannel(c, channel, relayInfo.OriginModelName)
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
		addUsedChannel(c, channel.Id)
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
			if relayInfo.StreamStatus != nil && relayInfo.StreamStatus.EndReason == relaycommon.StreamEndReasonClientGone {
				return
			}
			if c.Request.Context().Err() != nil &&
				(relayInfo.StreamStatus == nil || relayInfo.StreamStatus.EndReason != relaycommon.StreamEndReasonDone) {
				if relayInfo.StreamStatus == nil {
					relayInfo.StreamStatus = relaycommon.NewStreamStatus()
					relayInfo.StreamStatus.SetEndReason(relaycommon.StreamEndReasonClientGone, c.Request.Context().Err())
				}
				return
			}
			if !isSuccessfulStreamResult(relayInfo.StreamStatus) {
				streamErr := relayInfo.StreamStatus.FailureError()
				if streamErr == nil {
					streamErr = errors.New("upstream stream failed")
				}
				streamAPIError := types.NewOpenAIError(streamErr, types.ErrorCodeReadResponseBodyFailed, http.StatusBadGateway)
				relayInfo.LastError = streamAPIError
				service.TrackChannelExecutionFailure(c, channel.Id, channelExecutionErrorReason(streamAPIError))
				if shouldRetrySameChannel(c, streamAPIError, sameChannelRetriesUsed) {
					sameChannelRetriesUsed++
					retrySameChannel = channel
					service.TrackChannelExecutionSameChannelRetry(c, channel, sameChannelRetriesUsed)
					logger.LogInfo(c, fmt.Sprintf("渠道路由同渠道重试：渠道 #%d（%d/%d）", channel.Id, sameChannelRetriesUsed, common.ChannelRouteSameChannelRetries))
					recordChannelErrorLog(c, streamAPIError, relayInfo, true)
					continue
				}
				routeAdvanced := processChannelError(
					c,
					*types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey, common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()),
					streamAPIError,
				)
				newAPIError = streamAPIError
				lastFailedChannelError = streamAPIError
				willRetry := shouldAttemptNextChannel(c, streamAPIError, common.RetryTimes-retryParam.GetRetry(), routeAdvanced)
				recordChannelErrorLog(c, streamAPIError, relayInfo, willRetry)
				finalErrorLogged = !willRetry
				if willRetry {
					retryParam.IncreaseRetry()
					continue
				}
				return
			}
			relayInfo.LastError = nil
			service.MarkChannelRouteSuccess(c)
			service.MarkTokenGroupRouteSuccess(c)
			service.MarkChannelExecutionSuccess(c)
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

		routeAdvanced := processChannelError(c, *types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey, common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()), newAPIError)
		sameChannelRetriesUsed = 0
		lastFailedChannelError = newAPIError
		willRetry := shouldAttemptNextChannel(c, newAPIError, common.RetryTimes-retryParam.GetRetry(), routeAdvanced)
		recordChannelErrorLog(c, newAPIError, relayInfo, willRetry)
		finalErrorLogged = !willRetry

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
	if newAPIError != nil && !finalErrorLogged && lastFailedChannelError != nil {
		recordChannelErrorLog(c, newAPIError, relayInfo, false)
	}
	if newAPIError != nil {
		service.MarkChannelExecutionFailed(c, channelExecutionErrorReason(newAPIError))
		gopool.Go(func() {
			perfmetrics.RecordRelaySample(relayInfo, false, 0)
		})
	}
}

func writeRelayErrorResponse(c *gin.Context, ws *websocket.Conn, relayFormat types.RelayFormat, err *types.NewAPIError, requestId string) {
	if err == nil {
		return
	}
	logger.LogError(c, fmt.Sprintf("relay error: %s", common.LocalLogPreview(err.Error())))
	_, messageReplaced := operation_setting.ApplyCustomErrorResponseWithResult(err)
	if messageReplaced {
		err.DisableResponseMasking()
	} else {
		err.ExposeOriginalErrorForResponse()
	}
	setRelayResponseRequestId(err, requestId)

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

var upgrader = websocket.Upgrader{
	Subprotocols: []string{"realtime"}, // WS 握手支持的协议，如果有使用 Sec-WebSocket-Protocol，则必须在此声明对应的 Protocol TODO add other protocol
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许跨域
	},
}

func addUsedChannel(c *gin.Context, channelId int) {
	useChannel := c.GetStringSlice("use_channel")
	useChannel = append(useChannel, fmt.Sprintf("%d", channelId))
	c.Set("use_channel", useChannel)
}

func isStreamTimeoutFailure(status *relaycommon.StreamStatus) bool {
	return status != nil && status.EndReason == relaycommon.StreamEndReasonTimeout
}

func isSuccessfulStreamResult(status *relaycommon.StreamStatus) bool {
	return status == nil || (status.IsNormalEnd() && !status.HasErrors())
}

func fastTokenCountMetaForPricing(request dto.Request) *types.TokenCountMeta {
	if request == nil {
		return &types.TokenCountMeta{}
	}
	meta := &types.TokenCountMeta{
		TokenType: types.TokenTypeTokenizer,
	}
	switch r := request.(type) {
	case *dto.GeneralOpenAIRequest:
		maxCompletionTokens := lo.FromPtrOr(r.MaxCompletionTokens, uint(0))
		maxTokens := lo.FromPtrOr(r.MaxTokens, uint(0))
		if maxCompletionTokens > maxTokens {
			meta.MaxTokens = int(maxCompletionTokens)
		} else {
			meta.MaxTokens = int(maxTokens)
		}
	case *dto.OpenAIResponsesRequest:
		meta.MaxTokens = int(lo.FromPtrOr(r.MaxOutputTokens, uint(0)))
	case *dto.ClaudeRequest:
		meta.MaxTokens = int(lo.FromPtr(r.MaxTokens))
	case *dto.ImageRequest:
		// Pricing for image requests depends on ImagePriceRatio; safe to compute even when CountToken is disabled.
		return r.GetTokenCountMeta()
	default:
		// Best-effort: leave CombineText empty to avoid large allocations.
	}
	return meta
}

func getChannel(c *gin.Context, info *relaycommon.RelayInfo, retryParam *service.RetryParam) (*model.Channel, *types.NewAPIError) {
	if info.ChannelMeta == nil {
		autoBan := c.GetBool("auto_ban")
		autoBanInt := 1
		if !autoBan {
			autoBanInt = 0
		}
		return &model.Channel{
			Id:      c.GetInt("channel_id"),
			Type:    c.GetInt("channel_type"),
			Name:    c.GetString("channel_name"),
			AutoBan: &autoBanInt,
		}, nil
	}
	channel, selectGroup, err := service.CacheGetRandomSatisfiedChannel(retryParam)

	info.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, info)

	if err != nil {
		return nil, types.NewError(fmt.Errorf("获取分组 %s 下模型 %s 的可用渠道失败（retry）: %s", selectGroup, info.OriginModelName, err.Error()), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}
	if channel == nil {
		return nil, types.NewError(fmt.Errorf("分组 %s 下模型 %s 的可用渠道不存在（retry）", selectGroup, info.OriginModelName), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}

	newAPIError := middleware.SetupContextForSelectedChannel(c, channel, info.OriginModelName)
	if newAPIError != nil {
		return nil, newAPIError
	}
	return channel, nil
}

func shouldRetry(c *gin.Context, openaiErr *types.NewAPIError, retryTimes int) bool {
	if openaiErr == nil {
		return false
	}
	if helper.StreamOutputStarted(c) {
		return false
	}
	if service.ShouldSkipRetryAfterChannelAffinityFailure(c) {
		return false
	}
	if retryTimes <= 0 {
		return false
	}
	if types.IsChannelError(openaiErr) {
		return true
	}
	if types.IsSkipRetryError(openaiErr) {
		return false
	}
	if _, ok := c.Get("specific_channel_id"); ok {
		return false
	}
	code := openaiErr.StatusCode
	if code >= 200 && code < 300 {
		return false
	}
	if operation_setting.IsAlwaysSkipRetryError(openaiErr) {
		return false
	}
	if code < 100 || code > 599 {
		return true
	}
	return operation_setting.ShouldRetryByStatusCode(code)
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

func processChannelError(c *gin.Context, channelError types.ChannelError, err *types.NewAPIError) bool {
	logger.LogError(c, fmt.Sprintf("channel error (channel #%d, status code: %d): %s", channelError.ChannelId, err.StatusCode, common.LocalLogPreview(err.Error())))
	nextChannelExcluded := service.IsNextChannelRouteExcluded(c)
	if hasManagedRouting(c) {
		service.ClearChannelAffinityForRetryableFailure(c, channelError.ChannelId, err)
	}
	channelRouteFrozen := false
	if !nextChannelExcluded {
		channelRouteFrozen = service.MarkChannelRouteFailure(c, err)
	} else {
		logger.LogInfo(c, fmt.Sprintf("渠道路由分组已排除跨渠道切换：分组 %s", common.GetContextKeyString(c, constant.ContextKeyChannelRouteGroup)))
	}
	tokenGroupRouteFrozen := false
	if !channelRouteFrozen && !nextChannelExcluded {
		tokenGroupRouteFrozen = service.MarkTokenGroupRouteFailure(c, err)
	}
	// 不要使用context获取渠道信息，异步处理时可能会出现渠道信息不一致的情况
	// do not use context to get channel info, there may be inconsistent channel info when processing asynchronously
	if !channelRouteFrozen && service.ShouldDisableChannel(err) && channelError.AutoBan {
		gopool.Go(func() {
			service.DisableChannel(channelError, err.ErrorWithStatusCode())
		})
	}
	return channelRouteFrozen || tokenGroupRouteFrozen
}

func recordChannelErrorLog(c *gin.Context, err *types.NewAPIError, relayInfo *relaycommon.RelayInfo, adminOnly bool) {
	if constant.ErrorLogEnabled && types.IsRecordErrorLog(err) {
		// 保存错误日志到mysql中
		userId := c.GetInt("id")
		tokenName := c.GetString("token_name")
		modelName := c.GetString("original_model")
		tokenId := c.GetInt("token_id")
		userGroup := c.GetString("group")
		channelId := c.GetInt("channel_id")
		other := make(map[string]interface{})
		if c.Request != nil && c.Request.URL != nil {
			other["request_path"] = c.Request.URL.Path
		}
		other["error_type"] = err.GetErrorType()
		other["error_code"] = err.GetErrorCode()
		other["status_code"] = err.StatusCode
		other["channel_id"] = channelId
		other["channel_name"] = c.GetString("channel_name")
		other["channel_type"] = c.GetInt("channel_type")
		service.AppendStreamStatus(relayInfo, other)
		adminInfo := make(map[string]interface{})
		adminInfo["use_channel"] = c.GetStringSlice("use_channel")
		isMultiKey := common.GetContextKeyBool(c, constant.ContextKeyChannelIsMultiKey)
		if isMultiKey {
			adminInfo["is_multi_key"] = true
			adminInfo["multi_key_index"] = common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex)
		}
		service.AppendChannelAffinityAdminInfo(c, adminInfo)
		service.AppendChannelExecutionTraceErrorAdminInfo(c, adminInfo)
		if adminOnly {
			adminInfo["retry_intermediate"] = true
			model.MarkLogAdminOnly(other)
		}
		other["admin_info"] = adminInfo
		startTime := common.GetContextKeyTime(c, constant.ContextKeyRequestStartTime)
		if startTime.IsZero() {
			startTime = time.Now()
		}
		useTimeSeconds := int(time.Since(startTime).Seconds())
		model.RecordErrorLog(c, userId, channelId, modelName, tokenName, formatRelayErrorLogContent(err), tokenId, useTimeSeconds, common.GetContextKeyBool(c, constant.ContextKeyIsStream), userGroup, other)
	}
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
	message = common.MessageWithoutRequestId(message)
	if err.StatusCode == 0 {
		return message
	}
	if message == "" {
		return fmt.Sprintf("status_code=%d", err.StatusCode)
	}
	return fmt.Sprintf("status_code=%d, %s", err.StatusCode, message)
}

func RelayMidjourney(c *gin.Context) {
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatMjProxy, nil, nil)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"description": fmt.Sprintf("failed to generate relay info: %s", err.Error()),
			"type":        "upstream_error",
			"code":        4,
		})
		return
	}

	var mjErr *dto.MidjourneyResponse
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
	//err = relayMidjourneySubmit(c, relayMode)
	log.Println(mjErr)
	if mjErr != nil {
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

func RelayTaskFetch(c *gin.Context) {
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
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

func RelayTask(c *gin.Context) {
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
			Code:       "gen_relay_info_failed",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	if taskErr := relay.ResolveOriginTask(c, relayInfo); taskErr != nil {
		respondTaskError(c, taskErr)
		return
	}

	var result *relay.TaskSubmitResult
	var taskErr *dto.TaskError
	defer func() {
		if taskErr != nil && relayInfo.Billing != nil {
			relayInfo.Billing.Refund(c)
		}
	}()

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
		var channel *model.Channel

		if retrySameChannel != nil {
			channel = retrySameChannel
			retrySameChannel = nil
			if setupErr := middleware.SetupContextForSelectedChannel(c, channel, relayInfo.OriginModelName); setupErr != nil {
				taskErr = service.TaskErrorWrapperLocal(setupErr.Err, "setup_same_channel_retry_failed", http.StatusInternalServerError)
				break
			}
		} else if channelLocked {
			channel = lockedChannel
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
				if !hasManagedRouting(c) || taskErr == nil {
					taskErr = service.TaskErrorWrapperLocal(channelErr.Err, "get_channel_failed", http.StatusInternalServerError)
				}
				break
			}
		}

		service.TrackResolvedChannelExecutionAttempt(c, relayInfo.UsingGroup, relayInfo.OriginModelName, c.Request.URL.Path, channel, retryParam.GetRetry())
		addUsedChannel(c, channel.Id)
		bodyStorage, bodyErr := common.GetBodyStorage(c)
		if bodyErr != nil {
			if common.IsRequestBodyTooLargeError(bodyErr) || errors.Is(bodyErr, common.ErrRequestBodyTooLarge) {
				taskErr = service.TaskErrorWrapperLocal(bodyErr, "read_request_body_failed", http.StatusRequestEntityTooLarge)
			} else {
				taskErr = service.TaskErrorWrapperLocal(bodyErr, "read_request_body_failed", http.StatusBadRequest)
			}
			break
		}
		c.Request.Body = io.NopCloser(bodyStorage)

		result, taskErr = relay.RelayTaskSubmit(c, relayInfo)
		if taskErr == nil {
			break
		}

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
				routeError)
		}
		sameChannelRetriesUsed = 0
		willRetry := shouldAttemptNextTaskChannel(c, channel.Id, taskErr, common.RetryTimes-retryParam.GetRetry(), routeAdvanced, !channelLocked)
		if routeError != nil {
			lastFailedTaskChannelError = routeError
			recordChannelErrorLog(c, routeError, relayInfo, willRetry)
			finalTaskErrorLogged = !willRetry
		}

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

	// ── 成功：结算 + 日志 + 插入任务 ──
	if taskErr == nil {
		service.MarkChannelRouteSuccess(c)
		service.MarkTokenGroupRouteSuccess(c)
		service.MarkChannelExecutionSuccess(c)
		if settleErr := service.SettleBilling(c, relayInfo, result.Quota); settleErr != nil {
			common.SysError("settle task billing error: " + settleErr.Error())
		}
		service.LogTaskConsumption(c, relayInfo)

		task := model.InitTask(result.Platform, relayInfo)
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
			PerCallBilling:  common.StringsContains(constant.TaskPricePatches, relayInfo.OriginModelName) || relayInfo.PriceData.UsePrice,
		}
		task.Quota = result.Quota
		task.Data = result.TaskData
		task.Action = relayInfo.Action
		if insertErr := task.Insert(); insertErr != nil {
			common.SysError("insert task error: " + insertErr.Error())
		}
	}

	if taskErr != nil {
		service.MarkChannelExecutionFailed(c, taskErr.Message)
		respondTaskError(c, taskErr)
	}
}

// respondTaskError 统一输出 Task 错误响应（含 429 限流提示改写）
func respondTaskError(c *gin.Context, taskErr *dto.TaskError) {
	if taskErr.StatusCode == http.StatusTooManyRequests {
		taskErr.Message = "当前分组上游负载已饱和，请稍后再试"
	}
	c.JSON(taskErr.StatusCode, taskErr)
}

func shouldRetryTaskRelay(c *gin.Context, channelId int, taskErr *dto.TaskError, retryTimes int) bool {
	if taskErr == nil {
		return false
	}
	if service.ShouldSkipRetryAfterChannelAffinityFailure(c) {
		return false
	}
	if retryTimes <= 0 {
		return false
	}
	if _, ok := c.Get("specific_channel_id"); ok {
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

func shouldAttemptNextTaskChannel(c *gin.Context, channelID int, taskErr *dto.TaskError, retryTimes int, routeAdvanced bool, channelRouteAllowed bool) bool {
	if hasManagedRouting(c) {
		return channelRouteAllowed && routeAdvanced
	}
	return shouldRetryTaskRelay(c, channelID, taskErr, retryTimes)
}
