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
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
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
