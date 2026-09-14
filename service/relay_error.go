package service

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

func ShouldRetryRelayError(c *gin.Context, openaiErr *types.NewAPIError, retryTimes int) bool {
	if openaiErr == nil || retryTimes <= 0 {
		return false
	}
	if ShouldSkipRetryAfterChannelAffinityFailure(c) || GetChannelConstraints(c).SuppressesRetry() {
		return false
	}
	if _, pinned := c.Get("specific_channel_id"); pinned {
		return false
	}
	if types.IsSkipRetryError(openaiErr) || operation_setting.IsAlwaysSkipRetryError(openaiErr) {
		return false
	}
	if types.IsChannelError(openaiErr) {
		return true
	}
	code := openaiErr.StatusCode
	if code >= 200 && code < 300 {
		return false
	}
	if types.IsStreamEventError(openaiErr) || code < 100 || code > 599 {
		return true
	}
	return operation_setting.ShouldRetryByStatusCode(code)
}

// HandleChannelFailure advances managed routes and applies channel cooldown or
// disable policy. Callers decide whether the resulting log is an intermediate
// retry or the final user-visible failure.
func HandleChannelFailure(c *gin.Context, channelError types.ChannelError, err *types.NewAPIError) bool {
	if err == nil {
		return false
	}
	logger.LogError(c, fmt.Sprintf("channel error (channel #%d, status code: %d): %s", channelError.ChannelId, err.StatusCode, common.LocalLogPreview(err.MaskSensitiveErrorWithStatusCode())))
	if types.IsStreamEventError(err) &&
		(types.IsSkipRetryError(err) || operation_setting.IsAlwaysSkipRetryError(err)) {
		return false
	}
	nextChannelExcluded := IsNextChannelRouteExcluded(c)
	if IsChannelRouteEnabled() || HasTokenGroupRoutes(c) {
		ClearChannelAffinityForRetryableFailure(c, channelError.ChannelId, err)
	}
	channelRouteAdvanced := false
	if !nextChannelExcluded {
		channelRouteAdvanced = MarkChannelRouteFailure(c, err)
	} else {
		logger.LogInfo(c, fmt.Sprintf("渠道路由分组已排除跨渠道切换：分组 %s", common.GetContextKeyString(c, constant.ContextKeyChannelRouteGroup)))
	}
	tokenGroupRouteAdvanced := false
	if !channelRouteAdvanced && !nextChannelExcluded {
		tokenGroupRouteAdvanced = MarkTokenGroupRouteFailure(c, err)
	}
	if !channelRouteAdvanced && ShouldDisableChannelForContext(c, err) && channelError.AutoBan {
		reason := err.MaskSensitiveErrorWithStatusCode()
		gopool.Go(func() {
			DisableChannel(channelError, reason)
		})
	}
	return channelRouteAdvanced || tokenGroupRouteAdvanced
}

func ProcessChannelError(c *gin.Context, channelError types.ChannelError, err *types.NewAPIError, relayInfo *relaycommon.RelayInfo) {
	HandleChannelFailure(c, channelError, err)
	RecordRelayErrorLog(c, channelError.ChannelId, err, relayInfo, false)
}

func RecordRelayErrorLog(c *gin.Context, channelID int, err *types.NewAPIError, relayInfo *relaycommon.RelayInfo, adminOnly bool) {
	if err == nil || !constant.ErrorLogEnabled || !types.IsRecordErrorLog(err) {
		return
	}
	other := model.NewLogOther()
	if c.Request != nil && c.Request.URL != nil {
		other.SetPublic("request_path", c.Request.URL.Path)
	}
	other.SetPublic("error_type", err.GetErrorType())
	other.SetPublic("error_code", err.GetErrorCode())
	other.SetPublic("status_code", err.StatusCode)
	AppendRelayLogAdminInfo(c, relayInfo, other)
	AppendChannelExecutionTraceErrorAdminInfoToLogOther(c, other)
	AppendStreamStatusForLog(relayInfo, other)
	AppendTaskPluginContextAuditInfo(c, other)
	if adminOnly {
		other.SetAdmin("retry_intermediate", true)
		model.MarkLogAdminOnly(other)
	}
	startTime := common.GetContextKeyTime(c, constant.ContextKeyRequestStartTime)
	if startTime.IsZero() {
		startTime = time.Now()
	}
	actualResponseModel := ""
	if relayInfo != nil {
		actualResponseModel = relayInfo.ActualResponseModel()
	}
	model.RecordErrorLog(c, c.GetInt("id"), channelID, c.GetString("original_model"), actualResponseModel,
		c.GetString("token_name"), err.MaskSensitiveErrorWithStatusCode(), c.GetInt("token_id"),
		int(time.Since(startTime).Seconds()), common.GetContextKeyBool(c, constant.ContextKeyIsStream), c.GetString("group"), other)
}
