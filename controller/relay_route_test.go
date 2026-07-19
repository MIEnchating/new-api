package controller

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
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

func TestChannelAndTokenGroupRoutesAdvanceTogether(t *testing.T) {
	const (
		tokenID       = 71001
		primaryID     = 71002
		fallbackID    = 71003
		primaryGroup  = "relay-route-primary"
		fallbackGroup = "relay-route-fallback"
		modelName     = "relay-route-model"
		requestPath   = "/v1/chat/completions"
	)

	oldDB := model.DB
	oldLogDB := model.LOG_DB
	oldRedisEnabled := common.RedisEnabled
	oldMemoryCacheEnabled := common.MemoryCacheEnabled
	oldRouteEnabled := common.ChannelRouteCooldownEnabled
	oldRouteCooldown := common.ChannelRouteCooldownSeconds
	oldMainDatabaseType := common.MainDatabaseType()
	oldLogDatabaseType := common.LogDatabaseType()

	common.RedisEnabled = false
	common.MemoryCacheEnabled = true
	common.ChannelRouteCooldownEnabled = true
	common.ChannelRouteCooldownSeconds = 60
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)

	db, err := gorm.Open(sqlite.Open("file:relay_route_group_fallback?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))

	t.Cleanup(func() {
		service.ClearChannelRouteCooldown(primaryGroup, primaryID)
		service.ClearTokenGroupRouteCooldown(tokenID, primaryGroup, modelName, requestPath)
		service.ClearTokenGroupRouteCooldown(tokenID, fallbackGroup, modelName, requestPath)
		model.DB = oldDB
		model.LOG_DB = oldLogDB
		common.RedisEnabled = oldRedisEnabled
		common.MemoryCacheEnabled = oldMemoryCacheEnabled
		common.ChannelRouteCooldownEnabled = oldRouteEnabled
		common.ChannelRouteCooldownSeconds = oldRouteCooldown
		common.SetDatabaseTypes(oldMainDatabaseType, oldLogDatabaseType)
		if oldMemoryCacheEnabled && oldDB != nil {
			model.InitChannelCache()
		}
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	priority := int64(1)
	weight := uint(0)
	for _, candidate := range []struct {
		id    int
		group string
	}{
		{id: primaryID, group: primaryGroup},
		{id: fallbackID, group: fallbackGroup},
	} {
		require.NoError(t, db.Create(&model.Channel{
			Id:       candidate.id,
			Type:     constant.ChannelTypeOpenAI,
			Key:      "sk-test",
			Status:   common.ChannelStatusEnabled,
			Name:     candidate.group,
			Group:    candidate.group,
			Models:   modelName,
			Priority: &priority,
			Weight:   &weight,
		}).Error)
		require.NoError(t, db.Create(&model.Ability{
			Group:     candidate.group,
			Model:     modelName,
			ChannelId: candidate.id,
			Enabled:   true,
			Priority:  &priority,
			Weight:    weight,
		}).Error)
	}
	model.InitChannelCache()

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, requestPath, nil)
	common.SetContextKey(c, constant.ContextKeyTokenId, tokenID)
	common.SetContextKey(c, constant.ContextKeyTokenGroupRoutes, []model.TokenGroupRoute{
		{Group: primaryGroup, Priority: 2, CooldownSeconds: 60},
		{Group: fallbackGroup, Priority: 1, CooldownSeconds: 60},
	})
	retry := 0
	retryParam := &service.RetryParam{
		Ctx:         c,
		TokenGroup:  "default",
		ModelName:   modelName,
		RequestPath: requestPath,
		Retry:       &retry,
	}

	channel, group, err := service.CacheGetRandomSatisfiedChannel(retryParam)
	require.NoError(t, err)
	require.NotNil(t, channel)
	require.Equal(t, primaryID, channel.Id)
	require.Equal(t, primaryGroup, group)

	routeErr := types.NewErrorWithStatusCode(
		errors.New("upstream unavailable"),
		types.ErrorCodeChannelInvalidKey,
		http.StatusInternalServerError,
	)
	routeAdvanced := processChannelError(c, *types.NewChannelError(
		channel.Id,
		channel.Type,
		channel.Name,
		false,
		"",
		false,
	), routeErr)

	assert.True(t, routeAdvanced)
	assert.False(t, service.IsChannelRouteFrozen(primaryGroup, primaryID, common.GetTimestamp()))
	assert.True(t, service.IsTokenGroupRouteFrozen(tokenID, primaryGroup, modelName, requestPath, common.GetTimestamp()))
	assert.True(t, shouldAttemptNextChannel(c, routeErr, 0, routeAdvanced))
	assert.True(t, shouldAttemptNextTaskChannel(
		c,
		channel.Id,
		&dto.TaskError{StatusCode: http.StatusInternalServerError},
		0,
		routeAdvanced,
		true,
	))

	channel, group, err = service.CacheGetRandomSatisfiedChannel(retryParam)
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, fallbackID, channel.Id)
	assert.Equal(t, fallbackGroup, group)
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
