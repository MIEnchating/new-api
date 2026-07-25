package service

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
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
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/types"

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

type blockingTraceRedisHook struct {
	mu                sync.Mutex
	requestID         string
	snapshots         []ChannelExecutionTrace
	failuresRemaining int
	rejectCommands    bool
	firstStarted      chan struct{}
	releaseFirst      chan struct{}
}

func (hook *blockingTraceRedisHook) BeforeProcess(ctx context.Context, _ redis.Cmder) (context.Context, error) {
	hook.mu.Lock()
	reject := hook.rejectCommands
	hook.mu.Unlock()
	if reject {
		return ctx, errors.New("redis unavailable in test")
	}
	return ctx, nil
}

func (hook *blockingTraceRedisHook) AfterProcess(context.Context, redis.Cmder) error {
	return nil
}

func (hook *blockingTraceRedisHook) BeforeProcessPipeline(ctx context.Context, commands []redis.Cmder) (context.Context, error) {
	trace := ChannelExecutionTrace{}
	if len(commands) > 0 {
		args := commands[0].Args()
		if len(args) > 2 {
			var raw []byte
			switch value := args[2].(type) {
			case string:
				raw = []byte(value)
			case []byte:
				raw = value
			default:
				raw = []byte(fmt.Sprint(value))
			}
			_ = common.Unmarshal(raw, &trace)
		}
	}
	if hook.requestID != "" && trace.RequestID != hook.requestID {
		return ctx, nil
	}
	hook.mu.Lock()
	hook.snapshots = append(hook.snapshots, trace)
	index := len(hook.snapshots)
	shouldFail := hook.failuresRemaining > 0
	if shouldFail {
		hook.failuresRemaining--
	}
	hook.mu.Unlock()
	if index == 1 && hook.firstStarted != nil {
		close(hook.firstStarted)
		if hook.releaseFirst != nil {
			<-hook.releaseFirst
		}
	}
	if shouldFail {
		return ctx, errors.New("redis unavailable in test")
	}
	return ctx, nil
}

func (hook *blockingTraceRedisHook) AfterProcessPipeline(context.Context, []redis.Cmder) error {
	return nil
}

func (hook *blockingTraceRedisHook) snapshotStatuses() []string {
	hook.mu.Lock()
	defer hook.mu.Unlock()
	statuses := make([]string, 0, len(hook.snapshots))
	for _, snapshot := range hook.snapshots {
		statuses = append(statuses, snapshot.Status)
	}
	return statuses
}

func (hook *blockingTraceRedisHook) snapshotTraces() []ChannelExecutionTrace {
	hook.mu.Lock()
	defer hook.mu.Unlock()
	return append([]ChannelExecutionTrace(nil), hook.snapshots...)
}

func (hook *blockingTraceRedisHook) pipelineCount() int {
	hook.mu.Lock()
	defer hook.mu.Unlock()
	return len(hook.snapshots)
}

func readTraceRedisCommand(reader *bufio.Reader) (string, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	if len(line) < 3 || line[0] != '*' {
		return "", fmt.Errorf("unexpected RESP array: %q", line)
	}
	count, err := strconv.Atoi(strings.TrimSpace(line[1:]))
	if err != nil {
		return "", err
	}
	command := ""
	for index := 0; index < count; index++ {
		lengthLine, readErr := reader.ReadString('\n')
		if readErr != nil {
			return "", readErr
		}
		if len(lengthLine) < 3 || lengthLine[0] != '$' {
			return "", fmt.Errorf("unexpected RESP bulk string: %q", lengthLine)
		}
		length, parseErr := strconv.Atoi(strings.TrimSpace(lengthLine[1:]))
		if parseErr != nil {
			return "", parseErr
		}
		value := make([]byte, length+2)
		if _, readErr = io.ReadFull(reader, value); readErr != nil {
			return "", readErr
		}
		if index == 0 {
			command = strings.ToLower(string(value[:length]))
		}
	}
	return command, nil
}

func serveTraceRedisConnection(connection net.Conn) {
	defer connection.Close()
	reader := bufio.NewReader(connection)
	for {
		command, err := readTraceRedisCommand(reader)
		if err != nil {
			return
		}
		response := ":1\r\n"
		if command == "set" || command == "auth" || command == "select" {
			response = "+OK\r\n"
		}
		if _, err = io.WriteString(connection, response); err != nil {
			return
		}
	}
}

func newTraceRedisTestClient(t *testing.T, hook redis.Hook) *redis.Client {
	t.Helper()
	client := redis.NewClient(&redis.Options{
		Addr:       "trace-redis-test",
		MaxRetries: -1,
		Dialer: func(context.Context, string, string) (net.Conn, error) {
			clientConnection, serverConnection := net.Pipe()
			go serveTraceRedisConnection(serverConnection)
			return clientConnection, nil
		},
	})
	if hook != nil {
		client.AddHook(hook)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client
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

func (hook *rejectRedisCommandsHook) pipelineCount() int {
	hook.mu.Lock()
	defer hook.mu.Unlock()
	return len(hook.pipelines)
}

func setupChannelRouteTest(t *testing.T) *gorm.DB {
	t.Helper()

	gin.SetMode(gin.TestMode)
	oldRedisEnabled := common.RedisEnabled
	oldMemoryCacheEnabled := common.MemoryCacheEnabled
	oldChannelRouteCooldownEnabled := common.ChannelRouteCooldownEnabled
	oldChannelRouteCooldownSeconds := common.ChannelRouteCooldownSeconds
	oldChannelRouteStickyEnabled := common.ChannelRouteStickyEnabled
	oldChannelRouteSameChannelRetries := common.ChannelRouteSameChannelRetries
	oldChannelRouteGroupExclusionsEnabled := setting.ChannelRouteGroupExclusionsEnabled
	oldChannelRouteGroupExclusions := setting.ChannelRouteGroupExclusions2JSONString()
	oldRetryTimes := common.RetryTimes
	oldDB := model.DB
	oldLogDB := model.LOG_DB
	common.RedisEnabled = false
	common.MemoryCacheEnabled = true
	common.ChannelRouteCooldownEnabled = true
	common.ChannelRouteCooldownSeconds = 60
	common.ChannelRouteStickyEnabled = false
	common.ChannelRouteSameChannelRetries = 0
	setting.ChannelRouteGroupExclusionsEnabled = true
	require.NoError(t, setting.UpdateChannelRouteGroupExclusionsByJSONString("{}"))
	common.RetryTimes = 0
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	channelRouteCooldowns = sync.Map{}
	channelRouteCooldownWrites.Store(0)
	channelRouteAffinityStoreOnce = sync.Once{}
	channelRouteAffinityStore = nil
	channelExecutionTraceCacheOnce = sync.Once{}
	channelExecutionTraceCache = nil
	channelExecutionRecent = make(map[string]map[string]ChannelExecutionTrace)
	channelExecutionFallback = make(map[string]ChannelExecutionTrace)
	channelExecutionFallbackOrder = make([]string, 0, channelExecutionFallbackSize)
	channelExecutionRecentWrites = 0
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
		setting.ChannelRouteGroupExclusionsEnabled = oldChannelRouteGroupExclusionsEnabled
		require.NoError(t, setting.UpdateChannelRouteGroupExclusionsByJSONString(oldChannelRouteGroupExclusions))
		common.RetryTimes = oldRetryTimes
		channelRouteCooldowns = sync.Map{}
		channelRouteCooldownWrites.Store(0)
		channelRouteAffinityStoreOnce = sync.Once{}
		channelRouteAffinityStore = nil
		channelExecutionTraceCacheOnce = sync.Once{}
		channelExecutionTraceCache = nil
		channelExecutionRecent = make(map[string]map[string]ChannelExecutionTrace)
		channelExecutionFallback = make(map[string]ChannelExecutionTrace)
		channelExecutionFallbackOrder = make([]string, 0, channelExecutionFallbackSize)
		channelExecutionRecentWrites = 0
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

func TestLoadChannelRouteCooldownSnapshotSkipsCandidateQueryWithoutMemoryCache(t *testing.T) {
	setupChannelRouteTest(t)
	common.MemoryCacheEnabled = false

	cooldowns, batched, err := loadChannelRouteCooldownSnapshot(
		"default",
		channelRouteTestModel,
		"/v1/chat/completions",
		common.GetTimestamp(),
	)

	require.NoError(t, err)
	assert.False(t, batched)
	assert.Nil(t, cooldowns)
}

func TestBuildChannelExecutionPlanMarksBatchedCooldowns(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "default", 2)
	seedChannelRouteChannel(t, db, 2, "default", 1)
	model.InitChannelCache()
	until := FreezeChannelRoute("default", 1, 60)

	plan, err := BuildChannelExecutionPlan("default", channelRouteTestModel, "/v1/chat/completions", "route")

	require.NoError(t, err)
	require.Len(t, plan.Pools, 2)
	require.Len(t, plan.Pools[0].Candidates, 1)
	assert.Equal(t, 1, plan.Pools[0].Candidates[0].ChannelID)
	assert.Equal(t, "cooling", plan.Pools[0].Candidates[0].State)
	assert.Equal(t, until, plan.Pools[0].Candidates[0].CooldownUntil)
	assert.Equal(t, "candidate", plan.Pools[1].Candidates[0].State)
}

func TestChannelExecutionTracePublishesFirstEventWithoutEmptySnapshot(t *testing.T) {
	setupChannelRouteTest(t)
	ctx := newChannelRouteContext()
	ctx.Set(common.RequestIdKey, "first-event-publish")

	state := ensureChannelExecutionTrace(ctx, "default", channelRouteTestModel, "/v1/chat/completions")
	require.NotNil(t, state)
	_, found, err := GetChannelExecutionTrace("first-event-publish")
	require.NoError(t, err)
	assert.False(t, found)

	appendChannelExecutionEvent(ctx, "default", channelRouteTestModel, "/v1/chat/completions", ChannelExecutionEvent{
		ChannelID: 1,
		State:     "active",
	})
	trace, found, err := GetChannelExecutionTrace("first-event-publish")
	require.NoError(t, err)
	require.True(t, found)
	require.Len(t, trace.Events, 1)
	assert.Equal(t, "active", trace.Events[0].State)
}

func TestGroupAffinityPrecedesSelectionAndResolvedAttemptIsDeduplicated(t *testing.T) {
	setupChannelRouteTest(t)
	ctx := newChannelRouteContext()
	ctx.Set(common.RequestIdKey, "group-affinity-order")
	priority := int64(1000)
	channel := &model.Channel{Id: 92, Name: "us-sub2-plus", Priority: &priority}

	TrackChannelExecutionAffinityHit(ctx, "codex", channelRouteTestModel, "/v1/responses", channel.Id, "route_affinity")
	TrackChannelExecutionSelection(ctx, "codex", channelRouteTestModel, "/v1/responses", channel, 0)
	TrackChannelExecutionGroupAffinityHit(ctx, "codex", channelRouteTestModel, "/v1/responses", channel.Id)
	TrackResolvedChannelExecutionAttempt(ctx, "codex", channelRouteTestModel, "/v1/responses", channel, 0)

	state, exists := channelExecutionTraceStateFromContext(ctx)
	require.True(t, exists)
	state.mu.Lock()
	events := append([]ChannelExecutionEvent(nil), state.trace.Events...)
	state.mu.Unlock()

	require.Len(t, events, 3)
	assert.Equal(t, "group_affinity", events[0].Reason)
	assert.Zero(t, events[0].ChannelID)
	assert.Equal(t, "route_affinity", events[1].Reason)
	assert.Equal(t, "active", events[2].State)
	assert.Equal(t, channel.Id, events[2].ChannelID)
}

func TestChannelExecutionIndexOnlyRefreshesForNewKeysAndTerminalState(t *testing.T) {
	now := time.Now().UnixMilli()
	trace := ChannelExecutionTrace{
		RequestID: "index-refresh",
		Status:    "running",
		Group:     "default",
		UpdatedAt: now,
		Events: []ChannelExecutionEvent{
			{ChannelID: 1, Group: "default", State: "active"},
		},
	}
	state := &channelExecutionTraceState{indexedKeys: make(map[string]struct{})}

	firstKeys, refreshAll := channelExecutionIndexKeysForPublish(state, trace)
	require.True(t, refreshAll)
	require.Len(t, firstKeys, 2)
	for _, key := range firstKeys {
		state.indexedKeys[key] = struct{}{}
	}
	state.lastIndexRefreshTime = now

	repeatedKeys, refreshAll := channelExecutionIndexKeysForPublish(state, trace)
	assert.False(t, refreshAll)
	assert.Empty(t, repeatedKeys)

	trace.Events = append(trace.Events, ChannelExecutionEvent{ChannelID: 2, Group: "default", State: "active"})
	trace.UpdatedAt++
	newKeys, refreshAll := channelExecutionIndexKeysForPublish(state, trace)
	assert.False(t, refreshAll)
	require.Len(t, newKeys, 1)
	assert.Contains(t, newKeys[0], ":2:")

	trace.Status = "success"
	terminalKeys, refreshAll := channelExecutionIndexKeysForPublish(state, trace)
	assert.True(t, refreshAll)
	require.Len(t, terminalKeys, 3)
}

func TestPublishChannelExecutionTraceRedisUsesSinglePipeline(t *testing.T) {
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

	trace := ChannelExecutionTrace{
		RequestID: "pipeline-publish",
		Status:    "running",
		Group:     "default",
		UpdatedAt: time.Now().UnixMilli(),
		Events: []ChannelExecutionEvent{
			{ChannelID: 1, Group: "default", State: "active"},
		},
	}
	err := publishChannelExecutionTraceRedis(trace, channelExecutionTraceIndexKeys(trace))

	require.Error(t, err)
	require.Len(t, hook.pipelines, 1)
	assert.Equal(t, []string{"set", "zadd", "zremrangebyscore", "expire", "zadd", "zremrangebyscore", "expire"}, hook.pipelines[0])
}

func TestChannelExecutionTraceDebouncesRunningRedisPublishes(t *testing.T) {
	setupChannelRouteTest(t)
	oldRDB := common.RDB
	hook := &blockingTraceRedisHook{requestID: "debounced-running-publish"}
	client := newTraceRedisTestClient(t, hook)
	common.RDB = client
	common.RedisEnabled = true
	t.Cleanup(func() {
		common.RDB = oldRDB
	})

	ctx := newChannelRouteContext()
	ctx.Set(common.RequestIdKey, "debounced-running-publish")
	for index := 0; index < 5; index++ {
		appendChannelExecutionEvent(ctx, "default", channelRouteTestModel, "/v1/chat/completions", ChannelExecutionEvent{
			ChannelID: index + 1,
			State:     "active",
		})
	}

	assert.Equal(t, 0, hook.pipelineCount())
	require.Eventually(t, func() bool {
		return hook.pipelineCount() == 1
	}, time.Second, 10*time.Millisecond)

	MarkChannelExecutionSuccess(ctx)
	assert.Equal(t, 2, hook.pipelineCount())
	state, exists := channelExecutionTraceStateFromContext(ctx)
	require.True(t, exists)
	state.mu.Lock()
	assert.Equal(t, "success", state.trace.Status)
	require.Len(t, state.trace.Events, 6)
	assert.Equal(t, "success", state.trace.Events[5].State)
	assert.Equal(t, state.revision, state.publishedRevision)
	state.mu.Unlock()
}

func TestChannelExecutionTraceTerminalPublishCannotBeOverwrittenByRunningSnapshot(t *testing.T) {
	setupChannelRouteTest(t)
	oldRDB := common.RDB
	hook := &blockingTraceRedisHook{
		requestID:    "terminal-publish-order",
		firstStarted: make(chan struct{}),
		releaseFirst: make(chan struct{}),
	}
	client := newTraceRedisTestClient(t, hook)
	common.RDB = client
	common.RedisEnabled = true
	t.Cleanup(func() {
		common.RDB = oldRDB
	})

	ctx := newChannelRouteContext()
	ctx.Set(common.RequestIdKey, "terminal-publish-order")
	appendChannelExecutionEvent(ctx, "default", channelRouteTestModel, "/v1/chat/completions", ChannelExecutionEvent{
		ChannelID: 1,
		State:     "active",
	})
	select {
	case <-hook.firstStarted:
	case <-time.After(time.Second):
		t.Fatal("running trace publish did not start")
	}

	terminalDone := make(chan struct{})
	go func() {
		MarkChannelExecutionSuccess(ctx)
		close(terminalDone)
	}()
	select {
	case <-terminalDone:
		t.Fatal("terminal publish bypassed the in-flight running publish")
	case <-time.After(25 * time.Millisecond):
	}
	close(hook.releaseFirst)
	select {
	case <-terminalDone:
	case <-time.After(time.Second):
		t.Fatal("terminal publish did not complete")
	}

	assert.Equal(t, []string{"running", "success"}, hook.snapshotStatuses())
}

func TestChannelExecutionTraceTerminalPublishRetriesAfterRedisRecovery(t *testing.T) {
	setupChannelRouteTest(t)
	oldRDB := common.RDB
	hook := &blockingTraceRedisHook{requestID: "terminal-publish-recovery", failuresRemaining: 1, rejectCommands: true}
	client := newTraceRedisTestClient(t, hook)
	common.RDB = client
	common.RedisEnabled = true
	t.Cleanup(func() { common.RDB = oldRDB })

	ctx := newChannelRouteContext()
	ctx.Set(common.RequestIdKey, "terminal-publish-recovery")
	state := ensureChannelExecutionTrace(ctx, "default", channelRouteTestModel, "/v1/chat/completions")
	require.NotNil(t, state)

	MarkChannelExecutionSuccess(ctx)
	require.Equal(t, 1, hook.pipelineCount())
	fallbackTrace, found, err := GetChannelExecutionTrace("terminal-publish-recovery")
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, "success", fallbackTrace.Status)
	recent, err := ListChannelExecutionTraces(0, "default", 20)
	require.NoError(t, err)
	require.Len(t, recent, 1)
	assert.Equal(t, "terminal-publish-recovery", recent[0].RequestID)
	require.Eventually(t, func() bool {
		state.mu.Lock()
		defer state.mu.Unlock()
		return hook.pipelineCount() == 2 && state.publishedRevision == state.revision && !state.publishQueued
	}, time.Second, 10*time.Millisecond)
	assert.Equal(t, []string{"success", "success"}, hook.snapshotStatuses())

	time.Sleep(2 * channelExecutionPublishRetryBase)
	assert.Equal(t, 2, hook.pipelineCount(), "successful recovery must not publish the terminal snapshot again")
}

func TestChannelExecutionTraceReadsPersistedFallbackWhenRedisFails(t *testing.T) {
	db := setupChannelRouteTest(t)
	oldRDB := common.RDB
	hook := &blockingTraceRedisHook{rejectCommands: true}
	client := newTraceRedisTestClient(t, hook)
	common.RDB = client
	common.RedisEnabled = true
	t.Cleanup(func() { common.RDB = oldRDB })

	requestID := "persisted-redis-fallback"
	trace := ChannelExecutionTrace{
		RequestID: requestID,
		Status:    "failed",
		Group:     "default",
		UpdatedAt: time.Now().UnixMilli(),
		Events: []ChannelExecutionEvent{
			{Group: "default", ChannelID: 7, State: "failed"},
		},
	}
	other, err := common.Marshal(map[string]interface{}{
		"admin_info": map[string]interface{}{"channel_execution_trace": trace},
	})
	require.NoError(t, err)
	require.NoError(t, db.Create(&model.Log{
		CreatedAt: common.GetTimestamp(),
		Type:      model.LogTypeError,
		RequestId: requestID,
		Group:     "default",
		ChannelId: 7,
		Other:     string(other),
	}).Error)

	loaded, found, err := GetChannelExecutionTrace(requestID)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, requestID, loaded.RequestID)
	assert.Equal(t, "failed", loaded.Status)

	recent, err := ListChannelExecutionTraces(7, "default", 20)
	require.NoError(t, err)
	require.Len(t, recent, 1)
	assert.Equal(t, requestID, recent[0].RequestID)
}

func TestChannelExecutionTracePersistedCompactSummaryKeepsGroupStatuses(t *testing.T) {
	db := setupChannelRouteTest(t)
	requestID := "persisted-compact-statuses"
	wantStatuses := []ChannelExecutionRouteGroupStatus{
		{Group: "premium", Status: "success"},
		{Group: "fallback", Status: "pending"},
	}
	other, err := common.Marshal(map[string]interface{}{
		"admin_info": map[string]interface{}{
			"channel_execution_trace": ChannelExecutionTraceSummary{
				Compact:            true,
				Mode:               "route",
				Status:             "success",
				Group:              "premium",
				RouteGroups:        []string{"premium", "fallback"},
				RouteGroupStatuses: wantStatuses,
				ChannelIDs:         []int{7},
			},
		},
	})
	require.NoError(t, err)
	require.NoError(t, db.Create(&model.Log{
		CreatedAt: common.GetTimestamp(),
		Type:      model.LogTypeConsume,
		RequestId: requestID,
		Group:     "premium",
		ChannelId: 7,
		Other:     string(other),
	}).Error)

	trace, found, err := GetChannelExecutionTrace(requestID)
	require.NoError(t, err)
	require.True(t, found)
	assert.True(t, trace.Compact)
	assert.Equal(t, wantStatuses, trace.RouteGroupStatuses)
}

func TestChannelExecutionTraceFallbackIsBoundedWithoutRecentIndexAmplification(t *testing.T) {
	setupChannelRouteTest(t)
	now := time.Now().UnixMilli()
	for index := 0; index <= channelExecutionFallbackSize; index++ {
		rememberChannelExecutionTraceFallback(ChannelExecutionTrace{
			RequestID: fmt.Sprintf("bounded-fallback-%d", index),
			Status:    "failed",
			Group:     "default",
			UpdatedAt: now + int64(index),
		})
	}

	channelExecutionRecentMu.Lock()
	defer channelExecutionRecentMu.Unlock()
	assert.Len(t, channelExecutionFallback, channelExecutionFallbackSize)
	assert.Len(t, channelExecutionFallbackOrder, channelExecutionFallbackSize)
	assert.NotContains(t, channelExecutionFallback, "bounded-fallback-0")
	assert.Contains(t, channelExecutionFallback, fmt.Sprintf("bounded-fallback-%d", channelExecutionFallbackSize))
	assert.Empty(t, channelExecutionRecent)
}

func TestChannelExecutionTraceRevisionPublishesSameMillisecondUpdate(t *testing.T) {
	setupChannelRouteTest(t)
	oldRDB := common.RDB
	hook := &blockingTraceRedisHook{
		requestID:    "same-millisecond-revision",
		firstStarted: make(chan struct{}),
		releaseFirst: make(chan struct{}),
	}
	client := newTraceRedisTestClient(t, hook)
	common.RDB = client
	common.RedisEnabled = true
	t.Cleanup(func() { common.RDB = oldRDB })

	ctx := newChannelRouteContext()
	ctx.Set(common.RequestIdKey, "same-millisecond-revision")
	appendChannelExecutionEvent(ctx, "default", channelRouteTestModel, "/v1/chat/completions", ChannelExecutionEvent{
		ChannelID: 1,
		State:     "active",
	})
	select {
	case <-hook.firstStarted:
	case <-time.After(time.Second):
		t.Fatal("first running snapshot did not start")
	}

	state, exists := channelExecutionTraceStateFromContext(ctx)
	require.True(t, exists)
	state.mu.Lock()
	firstTimestamp := state.trace.UpdatedAt
	state.mu.Unlock()
	appendChannelExecutionEvent(ctx, "default", channelRouteTestModel, "/v1/chat/completions", ChannelExecutionEvent{
		ChannelID: 2,
		State:     "active",
	})
	state.mu.Lock()
	state.trace.UpdatedAt = firstTimestamp
	state.trace.Events[len(state.trace.Events)-1].Timestamp = firstTimestamp
	state.mu.Unlock()
	close(hook.releaseFirst)

	require.Eventually(t, func() bool {
		state.mu.Lock()
		defer state.mu.Unlock()
		return hook.pipelineCount() == 2 && state.publishedRevision == state.revision && !state.publishQueued
	}, time.Second, 10*time.Millisecond)
	snapshots := hook.snapshotTraces()
	require.Len(t, snapshots, 2)
	assert.Equal(t, firstTimestamp, snapshots[0].UpdatedAt)
	assert.Equal(t, firstTimestamp, snapshots[1].UpdatedAt)
	require.Len(t, snapshots[0].Events, 1)
	require.Len(t, snapshots[1].Events, 2)
}

func TestChannelExecutionTraceErrorSnapshotIsImmediateWithRedis(t *testing.T) {
	setupChannelRouteTest(t)
	oldRDB := common.RDB
	hook := &blockingTraceRedisHook{requestID: "immediate-error-snapshot"}
	client := newTraceRedisTestClient(t, hook)
	common.RDB = client
	common.RedisEnabled = true
	t.Cleanup(func() { common.RDB = oldRDB })

	ctx := newChannelRouteContext()
	ctx.Set(common.RequestIdKey, "immediate-error-snapshot")
	appendChannelExecutionEvent(ctx, "", channelRouteTestModel, "/v1/chat/completions", ChannelExecutionEvent{
		Group:     "premium",
		ChannelID: 1,
		State:     "failed",
	})
	state, exists := channelExecutionTraceStateFromContext(ctx)
	require.True(t, exists)
	state.mu.Lock()
	state.trace.RouteGroups = []string{"premium", "fallback"}
	state.mu.Unlock()

	adminInfo := map[string]interface{}{}
	AppendChannelExecutionTraceErrorAdminInfo(ctx, adminInfo)
	errorTrace, exists := adminInfo["channel_execution_trace"].(ChannelExecutionTrace)
	require.True(t, exists)
	assert.Equal(t, "failed", errorTrace.Status)
	assert.Equal(t, []ChannelExecutionRouteGroupStatus{
		{Group: "premium", Status: "failed"},
		{Group: "fallback", Status: "pending"},
	}, errorTrace.RouteGroupStatuses)
	assert.Equal(t, 0, hook.pipelineCount(), "error snapshot must not wait for the Redis debounce")

	require.Eventually(t, func() bool {
		state.mu.Lock()
		defer state.mu.Unlock()
		return hook.pipelineCount() == 1 && state.publishedRevision == state.revision && !state.publishQueued
	}, time.Second, 10*time.Millisecond)
}

func TestPruneChannelExecutionRecentRemovesColdExpiredAndEmptyKeys(t *testing.T) {
	setupChannelRouteTest(t)
	cutoff := time.Now().Add(-channelExecutionTraceTTL).UnixMilli()
	channelExecutionRecent["expired"] = map[string]ChannelExecutionTrace{
		"old-request": {RequestID: "old-request", UpdatedAt: cutoff - 1},
	}
	channelExecutionRecent["empty"] = map[string]ChannelExecutionTrace{}
	channelExecutionRecent["active"] = map[string]ChannelExecutionTrace{
		"active-request": {RequestID: "active-request", UpdatedAt: cutoff},
	}

	deletedKeys, deletedTraces := pruneChannelExecutionRecent(cutoff)

	assert.Equal(t, 2, deletedKeys)
	assert.Equal(t, 1, deletedTraces)
	assert.NotContains(t, channelExecutionRecent, "expired")
	assert.NotContains(t, channelExecutionRecent, "empty")
	require.Contains(t, channelExecutionRecent, "active")
	assert.Contains(t, channelExecutionRecent["active"], "active-request")
}

func TestIndexChannelExecutionTracePeriodicallyPrunesColdKeys(t *testing.T) {
	setupChannelRouteTest(t)
	now := time.Now().UnixMilli()
	channelExecutionRecent["cold-key"] = map[string]ChannelExecutionTrace{
		"old-request": {RequestID: "old-request", UpdatedAt: now - channelExecutionTraceTTL.Milliseconds() - 1},
	}
	channelExecutionRecentWrites = channelExecutionRecentPruneEvery - 1

	indexChannelExecutionTrace(ChannelExecutionTrace{
		RequestID: "new-request",
		Group:     "default",
		UpdatedAt: now,
		Events: []ChannelExecutionEvent{
			{Group: "default", ChannelID: 1},
		},
	})

	assert.NotContains(t, channelExecutionRecent, "cold-key")
	assert.Contains(t, channelExecutionRecent[channelExecutionRecentKey(1, "default")], "new-request")
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
	seedChannelRouteChannel(t, db, 1, "default", 1)
	seedChannelRouteChannel(t, db, 2, "default", 1)
	model.InitChannelCache()
	common.ChannelRouteCooldownSeconds = 0
	common.ChannelRouteStickyEnabled = true
	common.ChannelRouteSameChannelRetries = 2
	SetChannelRouteStickyChannel("default", channelRouteTestModel, "/v1/chat/completions", 1)

	ctx := newChannelRouteContext()
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
	assert.True(t, MarkChannelRouteFailure(ctx, routeErr))
	assert.Zero(t, GetChannelRouteStickyChannel("default", channelRouteTestModel, "/v1/chat/completions"))

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
	persistedTrace, exists := adminInfo["channel_execution_trace"].(ChannelExecutionTrace)
	require.True(t, exists)
	assert.False(t, persistedTrace.Compact)
	assert.Equal(t, "route", persistedTrace.Mode)
	assert.Equal(t, "success", persistedTrace.Status)
	assert.Equal(t, "default", persistedTrace.Group)
	require.NotEmpty(t, persistedTrace.Events)
	assert.Equal(t, "success", persistedTrace.Events[len(persistedTrace.Events)-1].State)

	affinityCtx := newChannelRouteContext()
	affinityCtx.Set(common.RequestIdKey, "request-trace-affinity")
	TrackChannelExecutionAffinityHit(affinityCtx, "default", channelRouteTestModel, "/v1/chat/completions", first.Id, "route_affinity")
	TrackChannelExecutionSelection(affinityCtx, "default", channelRouteTestModel, "/v1/chat/completions", first, 0)
	MarkChannelExecutionSuccess(affinityCtx)
	affinityAdminInfo := map[string]interface{}{}
	AppendChannelExecutionTraceAdminInfo(affinityCtx, affinityAdminInfo)
	affinitySummary, exists := affinityAdminInfo["channel_execution_trace"].(ChannelExecutionTraceSummary)
	require.True(t, exists)
	assert.True(t, affinitySummary.Compact)
	assert.Equal(t, []int{1}, affinitySummary.ChannelIDs)
	assert.Equal(t, first.Name, affinitySummary.ChannelName)
	require.NotNil(t, affinitySummary.Priority)
	assert.Equal(t, first.GetPriority(), *affinitySummary.Priority)
	assert.True(t, affinitySummary.AffinityHit)
	assert.Positive(t, affinitySummary.StartedAt)
	assert.GreaterOrEqual(t, affinitySummary.UpdatedAt, affinitySummary.StartedAt)

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
				Group:       "persisted-group",
				RouteGroups: []string{"persisted-group", "fallback"},
				RouteGroupStatuses: []ChannelExecutionRouteGroupStatus{
					{Group: "persisted-group", Status: "success"},
					{Group: "fallback", Status: "pending"},
				},
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
	assert.Equal(t, "persisted-group", traces[0].Group)
	assert.Equal(t, []int{108, 163}, traces[0].ChannelIDs)
	assert.Equal(t, []ChannelExecutionRouteGroupStatus{
		{Group: "persisted-group", Status: "success"},
		{Group: "fallback", Status: "pending"},
	}, traces[0].RouteGroupStatuses)
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
