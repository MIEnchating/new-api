package service

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const channelRouteTestModel = "gpt-channel-route-test"

func setupChannelRouteTest(t *testing.T) *gorm.DB {
	t.Helper()

	gin.SetMode(gin.TestMode)
	oldRedisEnabled := common.RedisEnabled
	oldMemoryCacheEnabled := common.MemoryCacheEnabled
	oldChannelRouteCooldownEnabled := common.ChannelRouteCooldownEnabled
	oldChannelRouteCooldownSeconds := common.ChannelRouteCooldownSeconds
	oldChannelRouteStickyEnabled := common.ChannelRouteStickyEnabled
	oldChannelRouteSameChannelRetries := common.ChannelRouteSameChannelRetries
	oldRetryTimes := common.RetryTimes
	oldDB := model.DB
	oldLogDB := model.LOG_DB
	common.RedisEnabled = false
	common.MemoryCacheEnabled = true
	common.ChannelRouteCooldownEnabled = true
	common.ChannelRouteCooldownSeconds = 60
	common.ChannelRouteStickyEnabled = false
	common.ChannelRouteSameChannelRetries = 0
	common.RetryTimes = 0
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	channelRouteCooldowns = sync.Map{}
	channelRouteAffinityStoreOnce = sync.Once{}
	channelRouteAffinityStore = nil
	channelExecutionTraceCacheOnce = sync.Once{}
	channelExecutionTraceCache = nil
	channelExecutionRecent = make(map[string]map[string]ChannelExecutionTrace)
	tokenGroupRouteCooldowns = sync.Map{}

	db, err := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.Log{}))

	t.Cleanup(func() {
		common.RedisEnabled = oldRedisEnabled
		common.MemoryCacheEnabled = oldMemoryCacheEnabled
		common.ChannelRouteCooldownEnabled = oldChannelRouteCooldownEnabled
		common.ChannelRouteCooldownSeconds = oldChannelRouteCooldownSeconds
		common.ChannelRouteStickyEnabled = oldChannelRouteStickyEnabled
		common.ChannelRouteSameChannelRetries = oldChannelRouteSameChannelRetries
		common.RetryTimes = oldRetryTimes
		channelRouteCooldowns = sync.Map{}
		channelRouteAffinityStoreOnce = sync.Once{}
		channelRouteAffinityStore = nil
		channelExecutionTraceCacheOnce = sync.Once{}
		channelExecutionTraceCache = nil
		channelExecutionRecent = make(map[string]map[string]ChannelExecutionTrace)
		tokenGroupRouteCooldowns = sync.Map{}
		model.DB = oldDB
		model.LOG_DB = oldLogDB
		if oldDB != nil {
			model.InitChannelCache()
		}
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	return db
}

func TestShouldRetrySameChannelRouteHonorsLimitAndDisable(t *testing.T) {
	setupChannelRouteTest(t)
	routeErr := newChannelRouteFailure()

	common.ChannelRouteSameChannelRetries = 2
	assert.True(t, ShouldRetrySameChannelRoute(routeErr, 0))
	assert.True(t, ShouldRetrySameChannelRoute(routeErr, 1))
	assert.False(t, ShouldRetrySameChannelRoute(routeErr, 2))

	common.ChannelRouteSameChannelRetries = 0
	assert.False(t, ShouldRetrySameChannelRoute(routeErr, 0))

	common.ChannelRouteSameChannelRetries = 2
	common.ChannelRouteCooldownEnabled = false
	assert.False(t, ShouldRetrySameChannelRoute(routeErr, 0))

	common.ChannelRouteCooldownEnabled = true
	nonRouteErr := types.NewErrorWithStatusCode(
		errors.New("invalid request"),
		types.ErrorCodeBadResponseStatusCode,
		http.StatusBadRequest,
	)
	assert.False(t, ShouldRetrySameChannelRoute(nonRouteErr, 0))
}

func seedChannelRouteChannel(t *testing.T, db *gorm.DB, id int, group string, priority int64) {
	t.Helper()

	weight := uint(0)
	channel := model.Channel{
		Id:       id,
		Type:     constant.ChannelTypeOpenAI,
		Key:      "sk-test",
		Status:   common.ChannelStatusEnabled,
		Name:     group,
		Group:    group,
		Models:   channelRouteTestModel,
		Priority: &priority,
		Weight:   &weight,
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group:     group,
		Model:     channelRouteTestModel,
		ChannelId: id,
		Enabled:   true,
		Priority:  &priority,
		Weight:    weight,
	}).Error)
}

func newChannelRouteContext() *gin.Context {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	return ctx
}

func newChannelRouteRetryParam(ctx *gin.Context, group string) *RetryParam {
	return &RetryParam{
		Ctx:         ctx,
		TokenGroup:  group,
		ModelName:   channelRouteTestModel,
		RequestPath: "/v1/chat/completions",
		Retry:       common.GetPointer(0),
	}
}

func newChannelRouteFailure() *types.NewAPIError {
	return types.NewErrorWithStatusCode(
		errors.New("upstream unavailable"),
		types.ErrorCodeChannelInvalidKey,
		http.StatusInternalServerError,
	)
}

func TestChannelRouteCooldownSkipsFailedChannelAndReturnsAfterClear(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "default", 2)
	seedChannelRouteChannel(t, db, 2, "default", 1)
	model.InitChannelCache()

	ctx := newChannelRouteContext()
	channel, group, err := CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(ctx, "default"))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "default", group)
	assert.Equal(t, 1, channel.Id)

	routeErr := newChannelRouteFailure()
	assert.True(t, MarkChannelRouteFailure(ctx, routeErr))
	assert.True(t, IsChannelRouteFrozen("default", 1, common.GetTimestamp()))

	nextCtx := newChannelRouteContext()
	channel, group, err = CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(nextCtx, "default"))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "default", group)
	assert.Equal(t, 2, channel.Id)

	ClearChannelRouteCooldown("default", 1)
	recoveredCtx := newChannelRouteContext()
	channel, group, err = CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(recoveredCtx, "default"))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "default", group)
	assert.Equal(t, 1, channel.Id)
}

func TestChannelRouteDoesNotFreezeOnlyAvailableChannel(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "default", 1)
	model.InitChannelCache()

	ctx := newChannelRouteContext()
	channel, group, err := CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(ctx, "default"))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "default", group)
	assert.Equal(t, 1, channel.Id)

	assert.False(t, MarkChannelRouteFailure(ctx, newChannelRouteFailure()))
	assert.False(t, IsChannelRouteFrozen("default", 1, common.GetTimestamp()))
}

func TestChannelRouteTriesEveryPriorityWithoutRetryBudget(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "default", 3)
	seedChannelRouteChannel(t, db, 2, "default", 2)
	seedChannelRouteChannel(t, db, 3, "default", 1)
	model.InitChannelCache()

	ctx := newChannelRouteContext()
	param := newChannelRouteRetryParam(ctx, "default")
	routeErr := newChannelRouteFailure()

	channel, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, 1, channel.Id)
	assert.True(t, MarkChannelRouteFailure(ctx, routeErr))

	param.SetRetry(1)
	channel, _, err = CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, 2, channel.Id)
	assert.True(t, MarkChannelRouteFailure(ctx, routeErr))

	param.SetRetry(2)
	channel, _, err = CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, 3, channel.Id)
	assert.False(t, MarkChannelRouteFailure(ctx, routeErr))
	assert.False(t, IsChannelRouteFrozen("default", 3, common.GetTimestamp()))

	param.SetRetry(3)
	channel, _, err = CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, 3, channel.Id)
}

func TestChannelRouteTriesDistinctChannelsAtSamePriority(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "default", 1)
	seedChannelRouteChannel(t, db, 2, "default", 1)
	model.InitChannelCache()

	ctx := newChannelRouteContext()
	param := newChannelRouteRetryParam(ctx, "default")
	first, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.True(t, MarkChannelRouteFailure(ctx, newChannelRouteFailure()))

	param.SetRetry(1)
	second, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, second)
	assert.NotEqual(t, first.Id, second.Id)
}

func TestChannelRouteStickyKeepsLastSuccessfulFallback(t *testing.T) {
	db := setupChannelRouteTest(t)
	common.ChannelRouteStickyEnabled = true
	seedChannelRouteChannel(t, db, 1, "default", 2)
	seedChannelRouteChannel(t, db, 2, "default", 1)
	model.InitChannelCache()

	firstCtx := newChannelRouteContext()
	first, _, err := CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(firstCtx, "default"))
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, 1, first.Id)
	assert.True(t, MarkChannelRouteFailure(firstCtx, newChannelRouteFailure()))

	fallbackCtx := newChannelRouteContext()
	fallback, _, err := CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(fallbackCtx, "default"))
	require.NoError(t, err)
	require.NotNil(t, fallback)
	assert.Equal(t, 2, fallback.Id)
	fallbackAdminInfo := map[string]interface{}{}
	AppendChannelRouteStickyAdminInfo(fallbackCtx, fallbackAdminInfo)
	assert.NotContains(t, fallbackAdminInfo, "channel_route_sticky")
	MarkChannelRouteSuccess(fallbackCtx)
	assert.Equal(t, 2, GetChannelRouteStickyChannel("default", channelRouteTestModel, "/v1/chat/completions"))

	ClearChannelRouteCooldown("default", 1)
	stickyCtx := newChannelRouteContext()
	sticky, _, err := CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(stickyCtx, "default"))
	require.NoError(t, err)
	require.NotNil(t, sticky)
	assert.Equal(t, 2, sticky.Id)
	stickyAdminInfo := map[string]interface{}{}
	AppendChannelRouteStickyAdminInfo(stickyCtx, stickyAdminInfo)
	require.Contains(t, stickyAdminInfo, "channel_route_sticky")
	stickyLogInfo := stickyAdminInfo["channel_route_sticky"].(map[string]interface{})
	assert.Equal(t, "default", stickyLogInfo["group"])
	assert.Equal(t, channelRouteTestModel, stickyLogInfo["model"])
	assert.Equal(t, "/v1/chat/completions", stickyLogInfo["request_path"])
	assert.Equal(t, 2, stickyLogInfo["channel_id"])
	assert.True(t, MarkChannelRouteFailure(stickyCtx, newChannelRouteFailure()))
	assert.Zero(t, GetChannelRouteStickyChannel("default", channelRouteTestModel, "/v1/chat/completions"))

	recoveredCtx := newChannelRouteContext()
	recovered, _, err := CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(recoveredCtx, "default"))
	require.NoError(t, err)
	require.NotNil(t, recovered)
	assert.Equal(t, 1, recovered.Id)
}

func TestClearChannelRouteAffinityByChannelOnlyClearsMatchingChannel(t *testing.T) {
	setupChannelRouteTest(t)

	SetChannelRouteStickyChannel("default", "model-a", "/v1/responses", 1)
	SetChannelRouteStickyChannel("default", "model-b", "/v1/responses", 1)
	SetChannelRouteStickyChannel("default", "model-c", "/v1/responses", 2)

	deleted, err := ClearChannelRouteAffinityByChannel(1)
	require.NoError(t, err)
	assert.Equal(t, 2, deleted)
	assert.Zero(t, GetChannelRouteStickyChannel("default", "model-a", "/v1/responses"))
	assert.Zero(t, GetChannelRouteStickyChannel("default", "model-b", "/v1/responses"))
	assert.Equal(t, 2, GetChannelRouteStickyChannel("default", "model-c", "/v1/responses"))
}

func TestClearAllChannelRouteAffinityClearsEveryChannel(t *testing.T) {
	setupChannelRouteTest(t)

	SetChannelRouteStickyChannel("default", "model-a", "/v1/responses", 1)
	SetChannelRouteStickyChannel("default", "model-b", "/v1/responses", 2)

	deleted, err := ClearAllChannelRouteAffinity()
	require.NoError(t, err)
	assert.Equal(t, 2, deleted)
	assert.Zero(t, GetChannelRouteStickyChannel("default", "model-a", "/v1/responses"))
	assert.Zero(t, GetChannelRouteStickyChannel("default", "model-b", "/v1/responses"))
}

func TestChannelRouteAffinityStatsUseSharedStore(t *testing.T) {
	setupChannelRouteTest(t)
	common.ChannelRouteStickyEnabled = true

	SetChannelRouteStickyChannel("default", "model-a", "/v1/responses", 1)
	SetChannelRouteStickyChannel("default", "model-b", "/v1/responses", 2)

	stats := GetChannelRouteAffinityStats()
	assert.True(t, stats.Enabled)
	assert.Equal(t, 2, stats.Total)
	assert.Equal(t, 100_000, stats.CacheCapacity)
	assert.Equal(t, "lru", stats.CacheAlgo)
}

func TestChannelRouteAffinityKeepsExistingRedisKeyFormat(t *testing.T) {
	setupChannelRouteTest(t)

	group := "default"
	modelName := "gpt-5"
	requestPath := "/v1/responses"
	expected := "channel_route_sticky:" + common.GenerateHMAC(
		channelRouteStickyScope(group, modelName, requestPath),
	)

	assert.Equal(
		t,
		expected,
		getChannelRouteAffinityStore().FullKey(
			channelRouteStickyKey(group, modelName, requestPath),
		),
	)
}

func TestChannelRouteCooldownKeepsTokenGroupBeforeFallingBackGroup(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "premium", 2)
	seedChannelRouteChannel(t, db, 2, "premium", 1)
	seedChannelRouteChannel(t, db, 3, "fallback", 1)
	model.InitChannelCache()

	FreezeChannelRoute("premium", 1, 60)
	ctx := newTokenRouteContext([]model.TokenGroupRoute{
		{Group: "premium", Priority: 2, CooldownSeconds: 60},
		{Group: "fallback", Priority: 1, CooldownSeconds: 60},
	})

	channel, group, err := CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(ctx, "default"))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "premium", group)
	assert.Equal(t, 2, channel.Id)
}

func TestChannelExecutionPlanAndTraceFollowActualRoute(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "default", 2)
	seedChannelRouteChannel(t, db, 2, "default", 1)
	model.InitChannelCache()

	plan, err := BuildChannelExecutionPlan("default", channelRouteTestModel, "/v1/chat/completions", "route")
	require.NoError(t, err)
	require.Len(t, plan.Pools, 2)
	assert.Equal(t, int64(2), plan.Pools[0].Priority)
	assert.Equal(t, 1, plan.Pools[0].Candidates[0].ChannelID)
	assert.Equal(t, 2, plan.Pools[1].Candidates[0].ChannelID)

	ctx := newChannelRouteContext()
	ctx.Set(common.RequestIdKey, "request-trace-test")
	param := newChannelRouteRetryParam(ctx, "default")
	first, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, 1, first.Id)
	state, traceExists := channelExecutionTraceStateFromContext(ctx)
	require.True(t, traceExists)
	require.NotEmpty(t, state.trace.Events)
	assert.Equal(t, "active", state.trace.Events[0].State)

	TrackChannelExecutionFailure(ctx, first.Id, "upstream failed")
	assert.True(t, MarkChannelRouteFailure(ctx, newChannelRouteFailure()))
	second, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, second)
	assert.Equal(t, 2, second.Id)
	MarkChannelExecutionSuccess(ctx)

	trace, found, err := GetChannelExecutionTrace("request-trace-test")
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, "success", trace.Status)
	require.GreaterOrEqual(t, len(trace.Events), 6)
	assert.Equal(t, "active", trace.Events[0].State)
	assert.Equal(t, []int{2}, trace.Events[0].NextIDs)
	assert.Equal(t, "failed", trace.Events[1].State)
	assert.Equal(t, "cooling", trace.Events[2].State)
	assert.Equal(t, "skipped", trace.Events[3].State)
	assert.Equal(t, "active", trace.Events[4].State)
	assert.Equal(t, "success", trace.Events[len(trace.Events)-1].State)
	recent, err := ListChannelExecutionTraces(1, "default", 20)
	require.NoError(t, err)
	require.Len(t, recent, 1)
	assert.Equal(t, "request-trace-test", recent[0].RequestID)
	recent, err = ListChannelExecutionTraces(0, "default", 20)
	require.NoError(t, err)
	require.Len(t, recent, 1)
	assert.Equal(t, "request-trace-test", recent[0].RequestID)
	recent, err = ListChannelExecutionTraces(1, "other", 20)
	require.NoError(t, err)
	assert.Empty(t, recent)

	adminInfo := map[string]interface{}{}
	AppendChannelExecutionTraceAdminInfo(ctx, adminInfo)
	summary, exists := adminInfo["channel_execution_trace"].(ChannelExecutionTraceSummary)
	require.True(t, exists)
	assert.True(t, summary.Compact)
	assert.Equal(t, "route", summary.Mode)
	assert.Equal(t, "success", summary.Status)
	assert.Equal(t, []int{1, 2}, summary.ChannelIDs)
	assert.False(t, summary.AffinityHit)

	affinityCtx := newChannelRouteContext()
	affinityCtx.Set(common.RequestIdKey, "request-trace-affinity")
	TrackChannelExecutionAffinityHit(affinityCtx, "default", channelRouteTestModel, "/v1/chat/completions", first.Id, "route_affinity")
	TrackChannelExecutionSelection(affinityCtx, "default", channelRouteTestModel, "/v1/chat/completions", first, 0)
	MarkChannelExecutionSuccess(affinityCtx)
	affinityAdminInfo := map[string]interface{}{}
	AppendChannelExecutionTraceAdminInfo(affinityCtx, affinityAdminInfo)
	affinitySummary, exists := affinityAdminInfo["channel_execution_trace"].(ChannelExecutionTraceSummary)
	require.True(t, exists)
	assert.Equal(t, []int{1}, affinitySummary.ChannelIDs)
	assert.True(t, affinitySummary.AffinityHit)

	failedCtx := newChannelRouteContext()
	failedCtx.Set(common.RequestIdKey, "request-trace-failed")
	TrackChannelExecutionSelection(failedCtx, "default", channelRouteTestModel, "/v1/chat/completions", first, 0)
	TrackChannelExecutionFailure(failedCtx, first.Id, "upstream failed")
	errorAdminInfo := map[string]interface{}{}
	AppendChannelExecutionTraceErrorAdminInfo(failedCtx, errorAdminInfo)
	errorTrace, exists := errorAdminInfo["channel_execution_trace"].(ChannelExecutionTrace)
	require.True(t, exists)
	assert.Equal(t, "failed", errorTrace.Status)
	runningState, exists := channelExecutionTraceStateFromContext(failedCtx)
	require.True(t, exists)
	assert.Equal(t, "running", runningState.trace.Status)

	MarkChannelExecutionFailed(failedCtx, "upstream failed")
	failedAdminInfo := map[string]interface{}{}
	AppendChannelExecutionTraceAdminInfo(failedCtx, failedAdminInfo)
	fullTrace, exists := failedAdminInfo["channel_execution_trace"].(ChannelExecutionTrace)
	require.True(t, exists)
	assert.Equal(t, "failed", fullTrace.Status)
	require.NotEmpty(t, fullTrace.Events)
	assert.Equal(t, "finished", fullTrace.Events[len(fullTrace.Events)-1].State)
}

func TestListChannelExecutionTracesFallsBackToPersistedSummary(t *testing.T) {
	db := setupChannelRouteTest(t)
	now := common.GetTimestamp()
	requestID := "persisted-trace-test"
	other := map[string]interface{}{
		"request_path": "/v1/responses",
		"admin_info": map[string]interface{}{
			"channel_execution_trace": ChannelExecutionTraceSummary{
				Compact:     true,
				Mode:        "route",
				Status:      "success",
				ChannelIDs:  []int{108, 163},
				AffinityHit: true,
			},
		},
	}
	require.NoError(t, db.Create(&model.Log{
		CreatedAt: now,
		Type:      model.LogTypeConsume,
		RequestId: requestID,
		ModelName: "gpt-persisted-trace",
		Group:     "persisted-group",
		ChannelId: 163,
		Other:     common.MapToJsonStr(other),
	}).Error)

	traces, err := ListChannelExecutionTraces(0, "persisted-group", 20)
	require.NoError(t, err)
	require.Len(t, traces, 1)
	assert.Equal(t, requestID, traces[0].RequestID)
	assert.True(t, traces[0].Compact)
	assert.Equal(t, []int{108, 163}, traces[0].ChannelIDs)
	assert.True(t, traces[0].AffinityHit)
	assert.Equal(t, "/v1/responses", traces[0].RequestPath)
	assert.Equal(t, "gpt-persisted-trace", traces[0].Model)

	filtered, err := ListChannelExecutionTraces(108, "persisted-group", 20)
	require.NoError(t, err)
	require.Len(t, filtered, 1)
	assert.Equal(t, requestID, filtered[0].RequestID)

	filtered, err = ListChannelExecutionTraces(999, "persisted-group", 20)
	require.NoError(t, err)
	assert.Empty(t, filtered)
}
