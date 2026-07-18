package controller

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestShouldAttemptNextChannelKeepsRouteAndRetryMutuallyExclusive(t *testing.T) {
	oldRouteEnabled := common.ChannelRouteCooldownEnabled
	oldCooldownSeconds := common.ChannelRouteCooldownSeconds
	t.Cleanup(func() {
		common.ChannelRouteCooldownEnabled = oldRouteEnabled
		common.ChannelRouteCooldownSeconds = oldCooldownSeconds
	})

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	err := types.NewErrorWithStatusCode(
		errors.New("channel unavailable"),
		types.ErrorCodeChannelInvalidKey,
		http.StatusInternalServerError,
	)

	common.ChannelRouteCooldownEnabled = false
	assert.True(t, shouldAttemptNextChannel(c, err, 1, false))
	assert.False(t, shouldAttemptNextChannel(c, err, 0, true))

	common.ChannelRouteCooldownEnabled = true
	common.ChannelRouteCooldownSeconds = 60
	assert.True(t, shouldAttemptNextChannel(c, err, 0, true))
	assert.False(t, shouldAttemptNextChannel(c, err, 10, false))
}

func TestShouldAttemptNextChannelStopsAfterStreamOutput(t *testing.T) {
	oldRouteEnabled := common.ChannelRouteCooldownEnabled
	t.Cleanup(func() { common.ChannelRouteCooldownEnabled = oldRouteEnabled })
	common.ChannelRouteCooldownEnabled = true

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	err := types.NewOpenAIError(errors.New("stream failed"), types.ErrorCodeReadResponseBodyFailed, http.StatusBadGateway)

	assert.True(t, shouldAttemptNextChannel(c, err, 0, true))
	require.NoError(t, helper.StringData(c, `{\"type\":\"response.output_text.delta\"}`))
	assert.False(t, shouldAttemptNextChannel(c, err, 10, true))
}

func TestSetRelayResponseRequestIdReplacesUpstreamRequestId(t *testing.T) {
	err := types.NewOpenAIError(
		errors.New("upstream failed (request id: upstream-request-id)"),
		types.ErrorCodeBadResponse,
		http.StatusBadGateway,
	)

	setRelayResponseRequestId(err, "local-request-id")

	assert.Equal(t, "upstream failed (request id: local-request-id)", err.Error())
	assert.Equal(t, "upstream failed (request id: local-request-id)", err.ToOpenAIError().Message)
}

func TestWriteRelayErrorResponseAppliesCustomRuleBeforeJSON(t *testing.T) {
	current := operation_setting.GetErrorResponseSetting()
	original := *current
	original.Rules = append([]operation_setting.CustomErrorResponseRule(nil), current.Rules...)
	t.Cleanup(func() { *current = original })
	*current = operation_setting.ErrorResponseSetting{
		Enabled: true,
		Rules: []operation_setting.CustomErrorResponseRule{
			{
				Enabled:            true,
				StatusCodes:        "500",
				ResponseStatusCode: http.StatusTooManyRequests,
				ResponseMessage:    "服务繁忙",
			},
		},
	}

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	apiErr := types.NewOpenAIError(errors.New("upstream failed"), types.ErrorCodeBadResponse, http.StatusInternalServerError)

	writeRelayErrorResponse(c, nil, types.RelayFormatOpenAIResponses, apiErr, "local-id")

	assert.Equal(t, http.StatusTooManyRequests, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "服务繁忙")
	assert.Contains(t, recorder.Body.String(), "local-id")
}

func TestWriteRelayErrorResponseUsesSSEAfterHeadersCommitted(t *testing.T) {
	current := operation_setting.GetErrorResponseSetting()
	original := *current
	original.Rules = append([]operation_setting.CustomErrorResponseRule(nil), current.Rules...)
	t.Cleanup(func() { *current = original })
	*current = operation_setting.ErrorResponseSetting{
		Enabled: true,
		Rules: []operation_setting.CustomErrorResponseRule{
			{
				Enabled:            true,
				StatusCodes:        "502",
				ResponseStatusCode: http.StatusTooManyRequests,
				ResponseMessage:    "流式服务繁忙",
			},
		},
	}

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Header("Content-Type", "text/event-stream")
	c.Status(http.StatusOK)
	_, _ = c.Writer.Write([]byte(": PING\n\n"))
	apiErr := types.NewOpenAIError(errors.New("upstream stream failed"), types.ErrorCodeBadResponse, http.StatusBadGateway)

	writeRelayErrorResponse(c, nil, types.RelayFormatOpenAIResponses, apiErr, "local-id")

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "event: error")
	assert.Contains(t, recorder.Body.String(), "流式服务繁忙")
	assert.NotContains(t, recorder.Body.String(), "}{")
}

func TestFormatRelayErrorLogContentStripsUpstreamRequestId(t *testing.T) {
	err := types.NewOpenAIError(
		errors.New("upstream failed (request_id: upstream-request-id)"),
		types.ErrorCodeBadResponse,
		http.StatusBadGateway,
	)

	assert.Equal(t, "status_code=502, upstream failed", formatRelayErrorLogContent(err))
}

func TestShouldAttemptNextTaskChannelDoesNotRouteLockedChannel(t *testing.T) {
	oldRouteEnabled := common.ChannelRouteCooldownEnabled
	oldCooldownSeconds := common.ChannelRouteCooldownSeconds
	t.Cleanup(func() {
		common.ChannelRouteCooldownEnabled = oldRouteEnabled
		common.ChannelRouteCooldownSeconds = oldCooldownSeconds
	})
	common.ChannelRouteCooldownEnabled = true
	common.ChannelRouteCooldownSeconds = 60

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	taskErr := &dto.TaskError{StatusCode: http.StatusInternalServerError}

	assert.True(t, shouldAttemptNextTaskChannel(c, 1, taskErr, 0, true, true))
	assert.False(t, shouldAttemptNextTaskChannel(c, 1, taskErr, 10, true, false))
	assert.False(t, shouldAttemptNextTaskChannel(c, 1, taskErr, 10, false, true))
}

func TestIsStreamTimeoutFailure(t *testing.T) {
	tests := []struct {
		reason relaycommon.StreamEndReason
		want   bool
	}{
		{relaycommon.StreamEndReasonTimeout, true},
		{relaycommon.StreamEndReasonHandlerStop, false},
		{relaycommon.StreamEndReasonClientGone, false},
		{relaycommon.StreamEndReasonDone, false},
	}
	for _, test := range tests {
		t.Run(string(test.reason), func(t *testing.T) {
			status := relaycommon.NewStreamStatus()
			status.SetEndReason(test.reason, nil)
			assert.Equal(t, test.want, isStreamTimeoutFailure(status))
		})
	}
}

func TestIsSuccessfulStreamResult(t *testing.T) {
	assert.True(t, isSuccessfulStreamResult(nil))

	done := relaycommon.NewStreamStatus()
	done.SetEndReason(relaycommon.StreamEndReasonDone, nil)
	assert.True(t, isSuccessfulStreamResult(done))

	eof := relaycommon.NewStreamStatus()
	eof.SetEndReason(relaycommon.StreamEndReasonEOF, nil)
	assert.True(t, isSuccessfulStreamResult(eof))

	handlerStop := relaycommon.NewStreamStatus()
	handlerStop.SetEndReason(relaycommon.StreamEndReasonHandlerStop, errors.New("downstream write failed"))
	handlerStop.RecordError("downstream write failed")
	assert.False(t, isSuccessfulStreamResult(handlerStop))

	doneWithErrors := relaycommon.NewStreamStatus()
	doneWithErrors.SetEndReason(relaycommon.StreamEndReasonDone, nil)
	doneWithErrors.RecordError("invalid intermediate event")
	assert.False(t, isSuccessfulStreamResult(doneWithErrors))

	clientGone := relaycommon.NewStreamStatus()
	clientGone.SetEndReason(relaycommon.StreamEndReasonClientGone, context.Canceled)
	assert.False(t, isSuccessfulStreamResult(clientGone))
}
