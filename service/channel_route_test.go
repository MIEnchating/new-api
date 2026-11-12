package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const channelRouteTestModel = "gpt-channel-route-test"

type rejectRedisCommandsHook struct {
	mu        sync.Mutex
	commands  []string
	pipelines [][]string
}

func (hook *rejectRedisCommandsHook) BeforeProcess(ctx context.Context, cmd redis.Cmder) (context.Context, error) {
	hook.mu.Lock()
	defer hook.mu.Unlock()
	hook.commands = append(hook.commands, cmd.Name())
	return ctx, errors.New("redis unavailable in test")
}

func (hook *rejectRedisCommandsHook) AfterProcess(context.Context, redis.Cmder) error {
	return nil
}

func (hook *rejectRedisCommandsHook) BeforeProcessPipeline(ctx context.Context, commands []redis.Cmder) (context.Context, error) {
	names := make([]string, 0, len(commands))
	for _, command := range commands {
		names = append(names, command.Name())
	}
	hook.mu.Lock()
	hook.pipelines = append(hook.pipelines, names)
	hook.mu.Unlock()
	return ctx, errors.New("redis unavailable in test")
}

func (hook *rejectRedisCommandsHook) AfterProcessPipeline(context.Context, []redis.Cmder) error {
	return nil
}

func setupChannelRouteTest(t *testing.T) *gorm.DB {
	t.Helper()

	gin.SetMode(gin.TestMode)
	oldRedisEnabled := common.RedisEnabled
	oldMemoryCacheEnabled := common.MemoryCacheEnabled
	oldChannelRouteCooldownEnabled := common.ChannelRouteCooldownEnabled
	oldChannelRouteCooldownSeconds := common.ChannelRouteCooldownSeconds
	oldChannelRouteSameChannelRetries := common.ChannelRouteSameChannelRetries
	oldChannelRouteGroupExclusionsEnabled := setting.ChannelRouteGroupExclusionsEnabled
	oldChannelRouteGroupExclusions := setting.ChannelRouteGroupExclusions2JSONString()
	oldChannelRouteCooldownExcludedGroups := setting.ChannelRouteCooldownExcludedGroups2JSONString()
	oldRetryTimes := common.RetryTimes
	oldDB := model.DB
	oldLogDB := model.LOG_DB
	common.RedisEnabled = false
	common.MemoryCacheEnabled = true
	common.ChannelRouteCooldownEnabled = true
	common.ChannelRouteCooldownSeconds = 60
	common.ChannelRouteSameChannelRetries = 0
	setting.ChannelRouteGroupExclusionsEnabled = true
	require.NoError(t, setting.UpdateChannelRouteGroupExclusionsByJSONString("{}"))
	require.NoError(t, setting.UpdateChannelRouteCooldownExcludedGroupsByJSONString("[]"))
	common.RetryTimes = 0
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	channelRouteCooldowns = sync.Map{}
	channelRouteCooldownWrites.Store(0)
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
		common.ChannelRouteSameChannelRetries = oldChannelRouteSameChannelRetries
		setting.ChannelRouteGroupExclusionsEnabled = oldChannelRouteGroupExclusionsEnabled
		require.NoError(t, setting.UpdateChannelRouteGroupExclusionsByJSONString(oldChannelRouteGroupExclusions))
		require.NoError(t, setting.UpdateChannelRouteCooldownExcludedGroupsByJSONString(oldChannelRouteCooldownExcludedGroups))
		common.RetryTimes = oldRetryTimes
		channelRouteCooldowns = sync.Map{}
		channelRouteCooldownWrites.Store(0)
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

	contextWindowErr := types.WithOpenAIError(types.OpenAIError{
		Message: "Your input exceeds the context window of this model. Please adjust your input and try again.",
		Type:    "upstream_error",
	}, http.StatusBadGateway)
	assert.False(t, ShouldRetrySameChannelRoute(contextWindowErr, 0))
	assert.False(t, ShouldSwitchChannelRoute(contextWindowErr))
	assert.False(t, ShouldSwitchTokenGroupRoute(contextWindowErr))
	assert.False(t, ShouldCooldownChannelRoute(contextWindowErr))
	assert.False(t, ShouldCooldownTokenGroupRoute(contextWindowErr))
}

func TestShouldRetrySameChannelRouteHonorsGroupExclusions(t *testing.T) {
	setupChannelRouteTest(t)
	common.ChannelRouteSameChannelRetries = 2
	require.NoError(t, setting.UpdateChannelRouteGroupExclusionsByJSONString(`{
		"no-retry":"same_channel_retry",
		"no-next":"next_channel",
		"excluded":"all",
		"disabled":{"mode":"same_channel_retry","enabled":false}
	}`))
	routeErr := newChannelRouteFailure()

	assert.False(t, ShouldRetrySameChannelRouteForGroup(routeErr, 0, "no-retry"))
	assert.True(t, ShouldRetrySameChannelRouteForGroup(routeErr, 0, "no-next"))
	assert.False(t, ShouldRetrySameChannelRouteForGroup(routeErr, 0, "excluded"))
	assert.True(t, ShouldRetrySameChannelRouteForGroup(routeErr, 0, "disabled"))
	assert.True(t, ShouldRetrySameChannelRouteForGroup(routeErr, 0, "default"))

	setting.ChannelRouteGroupExclusionsEnabled = false
	assert.True(t, ShouldRetrySameChannelRouteForGroup(routeErr, 0, "no-retry"))
}

func TestChannelRouteCooldownExcludedGroupStillSwitchesWithoutCooling(t *testing.T) {
	db := setupChannelRouteTest(t)
	require.NoError(t, setting.UpdateChannelRouteCooldownExcludedGroupsByJSONString(`["no-cooldown"]`))
	seedChannelRouteChannel(t, db, 42, "no-cooldown", 2)
	seedChannelRouteChannel(t, db, 43, "no-cooldown", 1)
	model.InitChannelCache()

	now := common.GetTimestamp()
	assert.Zero(t, FreezeChannelRoute("no-cooldown", 42, 60))
	assert.Zero(t, GetChannelRouteCooldownUntil("no-cooldown", 42, now))

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	TrackChannelRouteSelection(c, "no-cooldown", channelRouteTestModel, "/v1/chat/completions", 42)
	assert.True(t, MarkChannelRouteFailure(c, newChannelRouteFailure()))
	assert.Zero(t, GetChannelRouteCooldownUntilInMemory("no-cooldown", 42, now))
}

func TestNextChannelRouteExclusionHonorsGlobalAndRuleSwitches(t *testing.T) {
	setupChannelRouteTest(t)
	require.NoError(t, setting.UpdateChannelRouteGroupExclusionsByJSONString(`{
		"active":{"mode":"next_channel","enabled":true},
		"disabled":{"mode":"next_channel","enabled":false}
	}`))

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	common.SetContextKey(c, constant.ContextKeyChannelRouteGroup, "active")
	assert.True(t, IsNextChannelRouteExcluded(c))

	common.SetContextKey(c, constant.ContextKeyChannelRouteGroup, "disabled")
	assert.False(t, IsNextChannelRouteExcluded(c))

	setting.ChannelRouteGroupExclusionsEnabled = false
	common.SetContextKey(c, constant.ContextKeyChannelRouteGroup, "active")
	assert.False(t, IsNextChannelRouteExcluded(c))
}

func TestPruneExpiredChannelRouteCooldownsKeepsActiveEntries(t *testing.T) {
	setupChannelRouteTest(t)
	now := time.Now().Unix()
	expiredKey := channelRouteMemoryKey("expired", 1)
	activeKey := channelRouteMemoryKey("active", 2)
	channelRouteCooldowns.Store(expiredKey, now-1)
	channelRouteCooldowns.Store(activeKey, now+60)

	assert.Equal(t, 1, pruneExpiredChannelRouteCooldowns(now))
	_, expiredExists := channelRouteCooldowns.Load(expiredKey)
	_, activeExists := channelRouteCooldowns.Load(activeKey)
	assert.False(t, expiredExists)
	assert.True(t, activeExists)
}

func TestGetChannelRouteCooldownsUntilUsesMemoryFallback(t *testing.T) {
	setupChannelRouteTest(t)
	now := common.GetTimestamp()
	channelRouteCooldowns.Store(channelRouteMemoryKey("default", 1), now+60)
	channelRouteCooldowns.Store(channelRouteMemoryKey("default", 2), now-1)

	cooldowns := getChannelRouteCooldownsUntil("default", []int{1, 2, 1, 0}, now)

	require.Len(t, cooldowns, 2)
	assert.Equal(t, now+60, cooldowns[1])
	assert.Zero(t, cooldowns[2])
}

func TestGetChannelRouteCooldownsUntilUsesSingleRedisMGet(t *testing.T) {
	setupChannelRouteTest(t)
	oldRDB := common.RDB
	client := redis.NewClient(&redis.Options{Addr: "unused:0"})
	hook := &rejectRedisCommandsHook{}
	client.AddHook(hook)
	common.RDB = client
	common.RedisEnabled = true
	t.Cleanup(func() {
		common.RDB = oldRDB
		_ = client.Close()
	})

	now := common.GetTimestamp()
	channelRouteCooldowns.Store(channelRouteMemoryKey("default", 1), now+60)
	cooldowns := getChannelRouteCooldownsUntil("default", []int{1, 2, 3}, now)

	assert.Equal(t, []string{"mget"}, hook.commands)
	assert.Equal(t, now+60, cooldowns[1])
	assert.Zero(t, cooldowns[2])
	assert.Zero(t, cooldowns[3])
}

func TestChannelRouteSelectionReusesDatabaseCandidateSnapshotForTrace(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "default", 2)
	seedChannelRouteChannel(t, db, 2, "default", 1)
	common.MemoryCacheEnabled = false

	queryCount := 0
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register(
		"test:count_channel_route_candidate_queries",
		func(*gorm.DB) { queryCount++ },
	))

	ctx := newChannelRouteContext()
	channel, err := selectSatisfiedChannel(newChannelRouteRetryParam(ctx, "default"), "default", 0)

	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, 1, channel.Id)
	assert.Equal(t, 2, queryCount, "candidate abilities and channels should each be loaded once")
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

func setupChannelRouteAffinityRule(t *testing.T) operation_setting.ChannelAffinityRule {
	t.Helper()
	setting := operation_setting.GetChannelAffinitySetting()
	original := *setting
	original.Rules = append([]operation_setting.ChannelAffinityRule(nil), setting.Rules...)
	rule := operation_setting.ChannelAffinityRule{
		Name:       "managed-route-test-" + strings.ReplaceAll(t.Name(), "/", "-"),
		ModelRegex: []string{"^" + channelRouteTestModel + "$"},
		PathRegex:  []string{"^/v1/chat/completions$"},
		KeySources: []operation_setting.ChannelAffinityKeySource{
			{Type: "request_header", Key: "X-Route-Affinity"},
		},
		TTLSeconds:         60,
		SkipRetryOnFailure: true,
		IncludeUsingGroup:  true,
		IncludeModelName:   true,
		IncludeRuleName:    true,
	}
	setting.Enabled = true
	setting.SwitchOnSuccess = true
	setting.KeepOnChannelDisabled = false
	setting.Rules = []operation_setting.ChannelAffinityRule{rule}
	t.Cleanup(func() {
		*setting = original
	})
	return rule
}

func setChannelRouteAffinityTestRequest(ctx *gin.Context, value string) {
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Route-Affinity", value)
}

func seedChannelRouteAffinityForTest(
	t *testing.T,
	rule operation_setting.ChannelAffinityRule,
	group string,
	value string,
	channelID int,
) string {
	t.Helper()
	key := buildChannelAffinityCacheKeySuffix(rule, channelRouteTestModel, group, value)
	cache := getChannelAffinityCache()
	require.NoError(t, cache.SetWithTTL(key, channelID, time.Minute))
	t.Cleanup(func() {
		_, _ = cache.DeleteMany([]string{key})
	})
	return key
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

func TestChannelRouteCanDisableCooldownWhileStillFailingOver(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "default", 2)
	seedChannelRouteChannel(t, db, 2, "default", 1)
	model.InitChannelCache()
	common.ChannelRouteCooldownSeconds = 0

	ctx := newChannelRouteContext()
	param := newChannelRouteRetryParam(ctx, "default")
	first, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, 1, first.Id)

	ctx.Set("use_channel", []string{"1"})
	assert.True(t, MarkChannelRouteFailure(ctx, newChannelRouteFailure()))
	assert.False(t, IsChannelRouteFrozen("default", 1, common.GetTimestamp()))

	param.SetRetry(1)
	second, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, second)
	assert.Equal(t, 2, second.Id)

	nextCtx := newChannelRouteContext()
	next, _, err := CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(nextCtx, "default"))
	require.NoError(t, err)
	require.NotNil(t, next)
	assert.Equal(t, 1, next.Id)
}

func TestContextLimitDoesNotRetrySwitchOrCooldownChannel(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "default", 2)
	seedChannelRouteChannel(t, db, 2, "default", 1)
	model.InitChannelCache()
	common.ChannelRouteSameChannelRetries = 2

	ctx := newChannelRouteContext()
	param := newChannelRouteRetryParam(ctx, "default")
	first, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, first)
	require.Equal(t, 1, first.Id)
	ctx.Set("use_channel", []string{"1"})

	contextLimitErr := types.WithOpenAIError(types.OpenAIError{
		Message: "Your input exceeds the context window of this model.",
		Code:    "context_length_exceeded",
	}, http.StatusBadGateway)
	require.False(t, ShouldRetrySameChannelRoute(contextLimitErr, 0))
	require.False(t, MarkChannelRouteFailure(ctx, contextLimitErr))
	require.False(t, IsChannelRouteFrozen("default", 1, common.GetTimestamp()))
}

func TestContextLimitDoesNotStartChannelFailover(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "default", 2)
	seedChannelRouteChannel(t, db, 2, "default", 1)
	model.InitChannelCache()

	ctx := newChannelRouteContext()
	param := newChannelRouteRetryParam(ctx, "default")
	first, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, first)
	require.Equal(t, 1, first.Id)
	ctx.Set("use_channel", []string{"1"})

	contextLimitErr := types.WithOpenAIError(types.OpenAIError{
		Message: "context length exceeded",
		Code:    "context_length_exceeded",
	}, http.StatusBadGateway)
	require.False(t, MarkChannelRouteFailure(ctx, contextLimitErr))
}

func TestChannelRouteCooldownZeroExhaustsPrimaryGroupBeforeCoolingAndFallback(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "primary", 1)
	seedChannelRouteChannel(t, db, 2, "primary", 1)
	seedChannelRouteChannel(t, db, 3, "fallback", 1)
	model.InitChannelCache()
	common.ChannelRouteCooldownSeconds = 0

	routes := []model.TokenGroupRoute{
		{Group: "primary", Priority: 2, CooldownSeconds: 60},
		{Group: "fallback", Priority: 1, CooldownSeconds: 60},
	}
	ctx := newTokenRouteContext(routes)
	param := newChannelRouteRetryParam(ctx, "default")
	routeErr := newChannelRouteFailure()

	first, group, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, "primary", group)
	ctx.Set("use_channel", []string{strconv.Itoa(first.Id)})
	assert.True(t, MarkChannelRouteFailure(ctx, routeErr))
	assert.False(t, IsChannelRouteFrozen("primary", first.Id, common.GetTimestamp()))

	second, group, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, second)
	assert.Equal(t, "primary", group)
	assert.NotEqual(t, first.Id, second.Id)
	ctx.Set("use_channel", []string{strconv.Itoa(first.Id), strconv.Itoa(second.Id)})
	assert.False(t, MarkChannelRouteFailure(ctx, routeErr))
	assert.True(t, MarkTokenGroupRouteFailure(ctx, routeErr))
	assert.True(t, IsTokenGroupRouteFrozen(11, "primary", channelRouteTestModel, "/v1/chat/completions", common.GetTimestamp()))

	fallback, group, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, fallback)
	assert.Equal(t, "fallback", group)
	assert.Equal(t, 3, fallback.Id)
}

func TestChannelRouteSameChannelRetriesThenFailsOverAtSamePriority(t *testing.T) {
	db := setupChannelRouteTest(t)
	rule := setupChannelRouteAffinityRule(t)
	seedChannelRouteChannel(t, db, 1, "default", 1)
	seedChannelRouteChannel(t, db, 2, "default", 1)
	model.InitChannelCache()
	common.ChannelRouteCooldownSeconds = 0
	common.ChannelRouteSameChannelRetries = 2

	value := fmt.Sprintf("same-channel-retries-%d", time.Now().UnixNano())
	key := seedChannelRouteAffinityForTest(t, rule, "default", value, 1)
	ctx := newChannelRouteContext()
	setChannelRouteAffinityTestRequest(ctx, value)
	param := newChannelRouteRetryParam(ctx, "default")
	first, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, first)
	require.Equal(t, 1, first.Id)

	routeErr := newChannelRouteFailure()
	usedChannels := []string{"1"}
	for retriesUsed := 0; retriesUsed < common.ChannelRouteSameChannelRetries; retriesUsed++ {
		assert.True(t, ShouldRetrySameChannelRoute(routeErr, retriesUsed))
		usedChannels = append(usedChannels, "1")
	}
	ctx.Set("use_channel", usedChannels)
	assert.False(t, ShouldRetrySameChannelRoute(routeErr, common.ChannelRouteSameChannelRetries))
	assert.True(t, ClearChannelAffinityForRetryableFailure(ctx, first.Id, routeErr))
	_, found, err := getChannelAffinityCache().Get(key)
	require.NoError(t, err)
	assert.False(t, found)
	assert.True(t, MarkChannelRouteFailure(ctx, routeErr))

	param.SetRetry(1)
	fallback, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, fallback)
	assert.Equal(t, 2, fallback.Id)
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

func TestChannelRouteUsesRequestAffinityAfterConcreteGroup(t *testing.T) {
	db := setupChannelRouteTest(t)
	rule := setupChannelRouteAffinityRule(t)
	seedChannelRouteChannel(t, db, 1, "default", 2)
	seedChannelRouteChannel(t, db, 2, "default", 1)
	model.InitChannelCache()

	value := fmt.Sprintf("route-hit-%d", time.Now().UnixNano())
	seedChannelRouteAffinityForTest(t, rule, "default", value, 2)
	ctx := newChannelRouteContext()
	setChannelRouteAffinityTestRequest(ctx, value)

	channel, group, err := CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(ctx, "default"))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "default", group)
	assert.Equal(t, 2, channel.Id)
}
func TestTokenGroupRouteUsesRequestAffinityInFirstConcreteGroup(t *testing.T) {
	db := setupChannelRouteTest(t)
	common.ChannelRouteCooldownEnabled = false
	rule := setupChannelRouteAffinityRule(t)
	seedChannelRouteChannel(t, db, 1, "primary", 2)
	seedChannelRouteChannel(t, db, 2, "primary", 1)
	model.InitChannelCache()

	value := fmt.Sprintf("group-hit-%d", time.Now().UnixNano())
	seedChannelRouteAffinityForTest(t, rule, "primary", value, 2)
	ctx := newTokenRouteContext([]model.TokenGroupRoute{{Group: "primary", Priority: 1, CooldownSeconds: 60}})
	setChannelRouteAffinityTestRequest(ctx, value)
	param := newChannelRouteRetryParam(ctx, "default")

	channel, group, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "primary", group)
	assert.Equal(t, 2, channel.Id)
}

func TestChannelAffinityOnlySelectsFirstChannelAcrossGroupFallback(t *testing.T) {
	db := setupChannelRouteTest(t)
	rule := setupChannelRouteAffinityRule(t)
	seedChannelRouteChannel(t, db, 171, "codex-limited", 1)
	seedChannelRouteChannel(t, db, 116, "codex-special", 1)
	seedChannelRouteChannel(t, db, 117, "codex-special", 2)
	model.InitChannelCache()

	value := fmt.Sprintf("group-fallback-%d", time.Now().UnixNano())
	specialKey := seedChannelRouteAffinityForTest(t, rule, "codex-special", value, 116)
	routes := []model.TokenGroupRoute{
		{Group: "codex-limited", Priority: 2, CooldownSeconds: 60},
		{Group: "codex-special", Priority: 1, CooldownSeconds: 60},
	}
	ctx := newTokenRouteContext(routes)
	setChannelRouteAffinityTestRequest(ctx, value)
	param := newChannelRouteRetryParam(ctx, "default")

	first, group, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, "codex-limited", group)
	assert.Equal(t, 171, first.Id)
	ctx.Set("use_channel", []string{strconv.Itoa(first.Id)})
	assert.False(t, MarkChannelRouteFailure(ctx, newChannelRouteFailure()))
	assert.True(t, MarkTokenGroupRouteFailure(ctx, newChannelRouteFailure()))

	param.SetRetry(1)
	fallback, group, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, fallback)
	assert.Equal(t, "codex-special", group)
	assert.Equal(t, 117, fallback.Id)

	operation_setting.GetChannelAffinitySetting().SwitchOnSuccess = false
	common.SetContextKey(ctx, constant.ContextKeyChannelId, fallback.Id)
	RecordChannelAffinity(ctx, first.Id)
	stored, found, err := getChannelAffinityCache().Get(specialKey)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, fallback.Id, stored)
}

func TestRetryableAffinityFailureClearsAndSuccessfulCandidateRebinds(t *testing.T) {
	db := setupChannelRouteTest(t)
	rule := setupChannelRouteAffinityRule(t)
	seedChannelRouteChannel(t, db, 1, "default", 1)
	seedChannelRouteChannel(t, db, 2, "default", 2)
	model.InitChannelCache()

	value := fmt.Sprintf("retryable-failure-%d", time.Now().UnixNano())
	key := seedChannelRouteAffinityForTest(t, rule, "default", value, 1)
	ctx := newChannelRouteContext()
	setChannelRouteAffinityTestRequest(ctx, value)
	param := newChannelRouteRetryParam(ctx, "default")

	first, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, first)
	require.Equal(t, 1, first.Id)
	assert.True(t, ShouldSkipRetryAfterChannelAffinityFailure(ctx))

	routeErr := newChannelRouteFailure()
	assert.True(t, ClearChannelAffinityForRetryableFailure(ctx, first.Id, routeErr))
	assert.False(t, ShouldSkipRetryAfterChannelAffinityFailure(ctx))
	_, found, err := getChannelAffinityCache().Get(key)
	require.NoError(t, err)
	assert.False(t, found)

	ctx.Set("use_channel", []string{strconv.Itoa(first.Id)})
	assert.True(t, MarkChannelRouteFailure(ctx, routeErr))
	param.SetRetry(1)
	fallback, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, fallback)
	assert.Equal(t, 2, fallback.Id)

	operation_setting.GetChannelAffinitySetting().SwitchOnSuccess = false
	common.SetContextKey(ctx, constant.ContextKeyChannelId, fallback.Id)
	RecordChannelAffinity(ctx, first.Id)
	stored, found, err := getChannelAffinityCache().Get(key)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, fallback.Id, stored)
}

func TestNonRetryableAffinityFailureKeepsMapping(t *testing.T) {
	db := setupChannelRouteTest(t)
	rule := setupChannelRouteAffinityRule(t)
	seedChannelRouteChannel(t, db, 1, "default", 1)
	model.InitChannelCache()

	value := fmt.Sprintf("request-error-%d", time.Now().UnixNano())
	key := seedChannelRouteAffinityForTest(t, rule, "default", value, 1)
	ctx := newChannelRouteContext()
	setChannelRouteAffinityTestRequest(ctx, value)
	channel, _, err := CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(ctx, "default"))
	require.NoError(t, err)
	require.NotNil(t, channel)

	requestErr := types.NewErrorWithStatusCode(
		errors.New("invalid request"),
		types.ErrorCodeInvalidRequest,
		http.StatusBadRequest,
		types.ErrOptionWithSkipRetry(),
	)
	assert.False(t, ClearChannelAffinityForRetryableFailure(ctx, channel.Id, requestErr))
	stored, found, err := getChannelAffinityCache().Get(key)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, channel.Id, stored)
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
