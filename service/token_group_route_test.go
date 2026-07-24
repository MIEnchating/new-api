package service

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

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

const tokenRouteTestModel = "gpt-route-test"
const tokenRouteTestPath = "/v1/chat/completions"

func setupTokenGroupRouteTest(t *testing.T) *gorm.DB {
	t.Helper()

	gin.SetMode(gin.TestMode)
	oldRedisEnabled := common.RedisEnabled
	oldMemoryCacheEnabled := common.MemoryCacheEnabled
	common.RedisEnabled = false
	common.MemoryCacheEnabled = true
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	tokenGroupRouteCooldowns = syncMapForTokenRouteTest()
	tokenGroupRouteCooldownWrites.Store(0)
	tokenGroupRouteStickyStoreOnce = sync.Once{}
	tokenGroupRouteStickyStore = nil

	db, err := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))

	t.Cleanup(func() {
		common.RedisEnabled = oldRedisEnabled
		common.MemoryCacheEnabled = oldMemoryCacheEnabled
		tokenGroupRouteCooldowns = syncMapForTokenRouteTest()
		tokenGroupRouteCooldownWrites.Store(0)
		tokenGroupRouteStickyStoreOnce = sync.Once{}
		tokenGroupRouteStickyStore = nil
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	return db
}

func syncMapForTokenRouteTest() sync.Map {
	return sync.Map{}
}

func TestTokenGroupRouteAffinityMemoryStoreIsBounded(t *testing.T) {
	setupTokenGroupRouteTest(t)
	tokenGroupRouteStickyStoreOnce.Do(func() {
		tokenGroupRouteStickyStore = newTokenGroupStickyStore(2)
	})

	SetTokenGroupRouteStickyGroup(11, "model-a", tokenRouteTestPath, "group-a")
	SetTokenGroupRouteStickyGroup(11, "model-b", tokenRouteTestPath, "group-b")
	assert.Equal(t, "group-a", GetTokenGroupRouteStickyGroup(11, "model-a", tokenRouteTestPath))
	SetTokenGroupRouteStickyGroup(11, "model-c", tokenRouteTestPath, "group-c")

	assert.Equal(t, "group-a", GetTokenGroupRouteStickyGroup(11, "model-a", tokenRouteTestPath))
	assert.Empty(t, GetTokenGroupRouteStickyGroup(11, "model-b", tokenRouteTestPath))
	assert.Equal(t, "group-c", GetTokenGroupRouteStickyGroup(11, "model-c", tokenRouteTestPath))
}

func TestPruneExpiredTokenGroupRouteCooldownsKeepsActiveEntries(t *testing.T) {
	setupTokenGroupRouteTest(t)
	now := time.Now().Unix()
	expiredKey := tokenGroupRouteCooldownKey(11, "expired", tokenRouteTestModel, tokenRouteTestPath)
	activeKey := tokenGroupRouteCooldownKey(11, "active", tokenRouteTestModel, tokenRouteTestPath)
	tokenGroupRouteCooldowns.Store(expiredKey, tokenGroupRouteCooldownState{Until: now - 1})
	tokenGroupRouteCooldowns.Store(activeKey, tokenGroupRouteCooldownState{Until: now + 60})

	assert.Equal(t, 1, pruneExpiredTokenGroupRouteCooldowns(now))
	_, expiredExists := tokenGroupRouteCooldowns.Load(expiredKey)
	_, activeExists := tokenGroupRouteCooldowns.Load(activeKey)
	assert.False(t, expiredExists)
	assert.True(t, activeExists)
}

func seedTokenRouteChannel(t *testing.T, db *gorm.DB, id int, group string) {
	seedTokenRouteChannelForModel(t, db, id, group, tokenRouteTestModel)
}

func seedTokenRouteChannelForModel(t *testing.T, db *gorm.DB, id int, group string, modelName string) {
	t.Helper()

	priority := int64(0)
	weight := uint(0)
	channel := model.Channel{
		Id:       id,
		Type:     constant.ChannelTypeOpenAI,
		Key:      "sk-test",
		Status:   common.ChannelStatusEnabled,
		Name:     group,
		Group:    group,
		Models:   modelName,
		Priority: &priority,
		Weight:   &weight,
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group:     group,
		Model:     modelName,
		ChannelId: id,
		Enabled:   true,
		Priority:  &priority,
		Weight:    weight,
	}).Error)
}

func newTokenRouteContext(routes []model.TokenGroupRoute) *gin.Context {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	common.SetContextKey(ctx, constant.ContextKeyTokenId, 11)
	common.SetContextKey(ctx, constant.ContextKeyTokenGroupRoutes, routes)
	return ctx
}

func newStickyTokenRouteContext(routes []model.TokenGroupRoute) *gin.Context {
	ctx := newTokenRouteContext(routes)
	common.SetContextKey(ctx, constant.ContextKeyTokenGroupRouteSticky, true)
	return ctx
}

func newTokenRouteRetryParam(ctx *gin.Context) *RetryParam {
	return newTokenRouteRetryParamForModel(ctx, tokenRouteTestModel)
}

func newTokenRouteRetryParamForModel(ctx *gin.Context, modelName string) *RetryParam {
	return &RetryParam{
		Ctx:         ctx,
		TokenGroup:  "default",
		ModelName:   modelName,
		RequestPath: tokenRouteTestPath,
		Retry:       common.GetPointer(0),
	}
}

func TestTokenGroupRouteScopesCooldownAndStickyByModel(t *testing.T) {
	db := setupTokenGroupRouteTest(t)
	const modelA = "model-a"
	const modelB = "model-b"
	seedTokenRouteChannelForModel(t, db, 1, "premium", modelA)
	seedTokenRouteChannelForModel(t, db, 2, "premium", modelB)
	seedTokenRouteChannelForModel(t, db, 3, "fallback", modelA)
	seedTokenRouteChannelForModel(t, db, 4, "fallback", modelB)
	model.InitChannelCache()

	routes := []model.TokenGroupRoute{
		{Group: "premium", Priority: 2, CooldownSeconds: 60},
		{Group: "fallback", Priority: 1, CooldownSeconds: 60},
	}

	modelACtx := newStickyTokenRouteContext(routes)
	channel, group, err := CacheGetRandomSatisfiedChannel(newTokenRouteRetryParamForModel(modelACtx, modelA))
	require.NoError(t, err)
	require.NotNil(t, channel)
	require.Equal(t, "premium", group)

	routeErr := types.NewErrorWithStatusCode(
		errors.New("upstream unavailable"),
		types.ErrorCodeChannelInvalidKey,
		http.StatusInternalServerError,
	)
	MarkTokenGroupRouteFailure(modelACtx, routeErr)
	assert.True(t, IsTokenGroupRouteFrozen(11, "premium", modelA, tokenRouteTestPath, common.GetTimestamp()))
	assert.False(t, IsTokenGroupRouteFrozen(11, "premium", modelB, tokenRouteTestPath, common.GetTimestamp()))
	assert.False(t, IsTokenGroupRouteFrozen(11, "premium", modelA, "/v1/responses", common.GetTimestamp()))

	modelBCtx := newStickyTokenRouteContext(routes)
	channel, group, err = CacheGetRandomSatisfiedChannel(newTokenRouteRetryParamForModel(modelBCtx, modelB))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "premium", group)
	assert.Equal(t, 2, channel.Id)
	MarkTokenGroupRouteSuccess(modelBCtx)

	modelAFallbackCtx := newStickyTokenRouteContext(routes)
	channel, group, err = CacheGetRandomSatisfiedChannel(newTokenRouteRetryParamForModel(modelAFallbackCtx, modelA))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "fallback", group)
	assert.Equal(t, 3, channel.Id)
	MarkTokenGroupRouteSuccess(modelAFallbackCtx)

	assert.Equal(t, "fallback", GetTokenGroupRouteStickyGroup(11, modelA, tokenRouteTestPath))
	assert.Equal(t, "premium", GetTokenGroupRouteStickyGroup(11, modelB, tokenRouteTestPath))

	statuses := ListTokenGroupRouteCooldowns(11, common.GetTimestamp())
	require.Len(t, statuses, 1)
	assert.Equal(t, "premium", statuses[0].Group)
	assert.Equal(t, modelA, statuses[0].ModelName)
	FreezeTokenGroupRoute(12, "premium", modelB, tokenRouteTestPath, 60)
	assert.Len(t, ListTokenGroupRouteCooldowns(11, common.GetTimestamp()), 1)

	ClearTokenGroupRouteState(11)
	assert.Empty(t, GetTokenGroupRouteStickyGroup(11, modelA, tokenRouteTestPath))
	assert.Empty(t, GetTokenGroupRouteStickyGroup(11, modelB, tokenRouteTestPath))
	assert.Empty(t, ListTokenGroupRouteCooldowns(11, common.GetTimestamp()))
}

func TestTokenGroupRouteRoutesDisjointModelsWithoutCoolingUnsupportedGroup(t *testing.T) {
	db := setupTokenGroupRouteTest(t)
	const modelA = "model-a"
	const modelB = "model-b"
	seedTokenRouteChannelForModel(t, db, 1, "group-a", modelA)
	seedTokenRouteChannelForModel(t, db, 2, "group-b", modelB)
	model.InitChannelCache()

	routes := []model.TokenGroupRoute{
		{Group: "group-a", Priority: 2, CooldownSeconds: 60},
		{Group: "group-b", Priority: 1, CooldownSeconds: 60},
	}
	ctx := newTokenRouteContext(routes)
	channel, group, err := CacheGetRandomSatisfiedChannel(newTokenRouteRetryParamForModel(ctx, modelB))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "group-b", group)
	assert.Equal(t, 2, channel.Id)
	assert.False(t, IsTokenGroupRouteFrozen(11, "group-a", modelB, tokenRouteTestPath, common.GetTimestamp()))
	assert.Empty(t, ListTokenGroupRouteCooldowns(11, common.GetTimestamp()))
}

func TestTokenGroupRouteSelectsHighestPriorityAvailableGroup(t *testing.T) {
	db := setupTokenGroupRouteTest(t)
	seedTokenRouteChannel(t, db, 1, "fallback")
	seedTokenRouteChannel(t, db, 2, "premium")
	model.InitChannelCache()

	routes := []model.TokenGroupRoute{
		{Group: "premium", Priority: 2, CooldownSeconds: 60},
		{Group: "fallback", Priority: 1, CooldownSeconds: 60},
	}
	ctx := newTokenRouteContext(routes)

	channel, group, err := CacheGetRandomSatisfiedChannel(newTokenRouteRetryParam(ctx))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "premium", group)
	assert.Equal(t, 2, channel.Id)
}

func TestTokenGroupRouteSkipsFrozenGroupAndReturnsAfterCooldownCleared(t *testing.T) {
	db := setupTokenGroupRouteTest(t)
	seedTokenRouteChannel(t, db, 1, "fallback")
	seedTokenRouteChannel(t, db, 2, "premium")
	model.InitChannelCache()

	routes := []model.TokenGroupRoute{
		{Group: "premium", Priority: 2, CooldownSeconds: 60},
		{Group: "fallback", Priority: 1, CooldownSeconds: 60},
	}
	FreezeTokenGroupRoute(11, "premium", tokenRouteTestModel, tokenRouteTestPath, 60)

	ctx := newTokenRouteContext(routes)
	channel, group, err := CacheGetRandomSatisfiedChannel(newTokenRouteRetryParam(ctx))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "fallback", group)
	assert.Equal(t, 1, channel.Id)
	traceState, traceExists := channelExecutionTraceStateFromContext(ctx)
	require.True(t, traceExists)
	require.NotEmpty(t, traceState.trace.Events)
	assert.Equal(t, "fallback", traceState.trace.Group)
	assert.Equal(t, []string{"premium", "fallback"}, traceState.trace.RouteGroups)
	require.Len(t, traceState.trace.RouteGroupStatuses, 2)
	assert.Equal(t, []ChannelExecutionRouteGroupStatus{
		{Group: "premium", Status: "skipped", CooldownUntil: traceState.trace.RouteGroupStatuses[0].CooldownUntil},
		{Group: "fallback", Status: "active"},
	}, traceState.trace.RouteGroupStatuses)
	assert.Equal(t, "skipped", traceState.trace.Events[0].State)
	assert.Equal(t, "premium", traceState.trace.Events[0].Group)
	assert.Equal(t, "active", traceState.trace.Events[len(traceState.trace.Events)-1].State)
	assert.Equal(t, "fallback", traceState.trace.Events[len(traceState.trace.Events)-1].Group)

	MarkChannelExecutionSuccess(ctx)
	adminInfo := map[string]interface{}{}
	AppendChannelExecutionTraceAdminInfo(ctx, adminInfo)
	persistedTrace, exists := adminInfo["channel_execution_trace"].(ChannelExecutionTrace)
	require.True(t, exists)
	assert.Equal(t, "fallback", persistedTrace.Group)
	assert.Equal(t, []string{"premium", "fallback"}, persistedTrace.RouteGroups)
	assert.Equal(t, []ChannelExecutionRouteGroupStatus{
		{Group: "premium", Status: "skipped", CooldownUntil: persistedTrace.RouteGroupStatuses[0].CooldownUntil},
		{Group: "fallback", Status: "success"},
	}, persistedTrace.RouteGroupStatuses)
	require.NotEmpty(t, persistedTrace.Events)
	assert.Equal(t, "success", persistedTrace.Events[len(persistedTrace.Events)-1].State)

	ClearTokenGroupRouteCooldown(11, "premium", tokenRouteTestModel, tokenRouteTestPath)
	nextCtx := newTokenRouteContext(routes)
	channel, group, err = CacheGetRandomSatisfiedChannel(newTokenRouteRetryParam(nextCtx))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "premium", group)
	assert.Equal(t, 2, channel.Id)
}

func TestTokenGroupRouteSkipsGroupWithoutAvailableChannelWithoutCooldown(t *testing.T) {
	db := setupTokenGroupRouteTest(t)
	seedTokenRouteChannel(t, db, 1, "fallback")
	model.InitChannelCache()

	routes := []model.TokenGroupRoute{
		{Group: "premium", Priority: 2, CooldownSeconds: 60},
		{Group: "fallback", Priority: 1, CooldownSeconds: 60},
	}
	ctx := newTokenRouteContext(routes)

	channel, group, err := CacheGetRandomSatisfiedChannel(newTokenRouteRetryParam(ctx))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "fallback", group)
	assert.False(t, IsTokenGroupRouteFrozen(11, "premium", tokenRouteTestModel, tokenRouteTestPath, common.GetTimestamp()))
}

func TestTokenGroupRouteFailureFreezesCurrentGroupAndAdvancesRetry(t *testing.T) {
	db := setupTokenGroupRouteTest(t)
	seedTokenRouteChannel(t, db, 1, "fallback")
	seedTokenRouteChannel(t, db, 2, "premium")
	model.InitChannelCache()

	routes := []model.TokenGroupRoute{
		{Group: "premium", Priority: 2, CooldownSeconds: 60},
		{Group: "fallback", Priority: 1, CooldownSeconds: 60},
	}
	ctx := newTokenRouteContext(routes)

	channel, group, err := CacheGetRandomSatisfiedChannel(newTokenRouteRetryParam(ctx))
	require.NoError(t, err)
	require.NotNil(t, channel)
	require.Equal(t, "premium", group)

	routeErr := types.NewErrorWithStatusCode(
		errors.New("upstream unavailable"),
		types.ErrorCodeChannelInvalidKey,
		http.StatusInternalServerError,
	)
	MarkTokenGroupRouteFailure(ctx, routeErr)

	assert.True(t, IsTokenGroupRouteFrozen(11, "premium", tokenRouteTestModel, tokenRouteTestPath, common.GetTimestamp()))
	channel, group, err = CacheGetRandomSatisfiedChannel(newTokenRouteRetryParam(ctx))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "fallback", group)
	assert.Equal(t, 1, channel.Id)
}

func TestTokenGroupRouteStickyRecordsSuccessfulFallback(t *testing.T) {
	db := setupTokenGroupRouteTest(t)
	seedTokenRouteChannel(t, db, 1, "fallback")
	seedTokenRouteChannel(t, db, 2, "premium")
	model.InitChannelCache()

	routes := []model.TokenGroupRoute{
		{Group: "premium", Priority: 2, CooldownSeconds: 60},
		{Group: "fallback", Priority: 1, CooldownSeconds: 60},
	}
	FreezeTokenGroupRoute(11, "premium", tokenRouteTestModel, tokenRouteTestPath, 60)

	ctx := newStickyTokenRouteContext(routes)
	channel, group, err := CacheGetRandomSatisfiedChannel(newTokenRouteRetryParam(ctx))
	require.NoError(t, err)
	require.NotNil(t, channel)
	require.Equal(t, "fallback", group)

	MarkTokenGroupRouteSuccess(ctx)
	assert.Equal(t, "fallback", GetTokenGroupRouteStickyGroup(11, tokenRouteTestModel, tokenRouteTestPath))

	ClearTokenGroupRouteCooldown(11, "premium", tokenRouteTestModel, tokenRouteTestPath)
	nextCtx := newStickyTokenRouteContext(routes)
	channel, group, err = CacheGetRandomSatisfiedChannel(newTokenRouteRetryParam(nextCtx))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "fallback", group)
	assert.Equal(t, 1, channel.Id)

	MarkChannelExecutionSuccess(nextCtx)
	traceState, exists := channelExecutionTraceStateFromContext(nextCtx)
	require.True(t, exists)
	require.NotEmpty(t, traceState.trace.Events)
	successEvent := traceState.trace.Events[len(traceState.trace.Events)-1]
	assert.Equal(t, "success", successEvent.State)
	assert.Equal(t, channel.Id, successEvent.ChannelID)
}

func TestTokenGroupRouteStickyClearsOnFailure(t *testing.T) {
	db := setupTokenGroupRouteTest(t)
	seedTokenRouteChannel(t, db, 1, "fallback")
	seedTokenRouteChannel(t, db, 2, "premium")
	model.InitChannelCache()

	routes := []model.TokenGroupRoute{
		{Group: "premium", Priority: 2, CooldownSeconds: 60},
		{Group: "fallback", Priority: 1, CooldownSeconds: 60},
	}
	SetTokenGroupRouteStickyGroup(11, tokenRouteTestModel, tokenRouteTestPath, "fallback")

	ctx := newStickyTokenRouteContext(routes)
	channel, group, err := CacheGetRandomSatisfiedChannel(newTokenRouteRetryParam(ctx))
	require.NoError(t, err)
	require.NotNil(t, channel)
	require.Equal(t, "fallback", group)

	routeErr := types.NewErrorWithStatusCode(
		errors.New("upstream unavailable"),
		types.ErrorCodeChannelInvalidKey,
		http.StatusInternalServerError,
	)
	MarkTokenGroupRouteFailure(ctx, routeErr)

	assert.Empty(t, GetTokenGroupRouteStickyGroup(11, tokenRouteTestModel, tokenRouteTestPath))
	assert.True(t, IsTokenGroupRouteFrozen(11, "fallback", tokenRouteTestModel, tokenRouteTestPath, common.GetTimestamp()))

	channel, group, err = CacheGetRandomSatisfiedChannel(newTokenRouteRetryParam(ctx))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "premium", group)
	assert.Equal(t, 2, channel.Id)
	assert.False(t, common.GetContextKeyBool(ctx, constant.ContextKeyTokenGroupRouteStickyHit))
}
