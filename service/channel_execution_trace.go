package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/cachex"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/samber/hot"
)

const (
	channelExecutionTraceContextKey  = "channel_execution_trace"
	channelExecutionTraceNamespace   = "channel_execution_trace:v1"
	channelExecutionRecentNamespace  = "channel_execution_recent:v1"
	channelExecutionTraceTTL         = 30 * time.Minute
	channelExecutionIndexRefreshTTL  = channelExecutionTraceTTL / 2
	channelExecutionRecentPruneEvery = 256
)

type ChannelExecutionCandidate struct {
	ChannelID     int    `json:"channel_id"`
	ChannelName   string `json:"channel_name"`
	Priority      int64  `json:"priority"`
	Weight        int    `json:"weight"`
	State         string `json:"state"`
	CooldownUntil int64  `json:"cooldown_until,omitempty"`
}

type ChannelExecutionCandidatePool struct {
	Priority   int64                       `json:"priority"`
	Candidates []ChannelExecutionCandidate `json:"candidates"`
}

type ChannelExecutionPlan struct {
	Mode        string                          `json:"mode"`
	Group       string                          `json:"group"`
	Model       string                          `json:"model"`
	RequestPath string                          `json:"request_path"`
	MaxAttempts int                             `json:"max_attempts"`
	Pools       []ChannelExecutionCandidatePool `json:"pools"`
}

type ChannelExecutionEvent struct {
	Sequence      int    `json:"sequence"`
	Timestamp     int64  `json:"timestamp"`
	Group         string `json:"group,omitempty"`
	ChannelID     int    `json:"channel_id,omitempty"`
	ChannelName   string `json:"channel_name,omitempty"`
	Priority      int64  `json:"priority,omitempty"`
	State         string `json:"state"`
	Reason        string `json:"reason,omitempty"`
	RetryIndex    int    `json:"retry_index,omitempty"`
	NextIDs       []int  `json:"next_ids,omitempty"`
	CooldownUntil int64  `json:"cooldown_until,omitempty"`
}

type ChannelExecutionRouteGroupStatus struct {
	Group         string `json:"group"`
	Status        string `json:"status"`
	CooldownUntil int64  `json:"cooldown_until,omitempty"`
}

type ChannelExecutionTrace struct {
	RequestID          string                             `json:"request_id"`
	Mode               string                             `json:"mode"`
	Group              string                             `json:"group"`
	RouteGroups        []string                           `json:"route_groups,omitempty"`
	RouteGroupStatuses []ChannelExecutionRouteGroupStatus `json:"route_group_statuses,omitempty"`
	Model              string                             `json:"model"`
	RequestPath        string                             `json:"request_path"`
	Status             string                             `json:"status"`
	StartedAt          int64                              `json:"started_at"`
	UpdatedAt          int64                              `json:"updated_at"`
	Events             []ChannelExecutionEvent            `json:"events"`
	Compact            bool                               `json:"compact,omitempty"`
	ChannelIDs         []int                              `json:"channel_ids,omitempty"`
	AffinityHit        bool                               `json:"affinity_hit,omitempty"`
}

type ChannelExecutionTraceSummary struct {
	Compact            bool                               `json:"compact"`
	Mode               string                             `json:"mode"`
	Status             string                             `json:"status"`
	Group              string                             `json:"group,omitempty"`
	RouteGroups        []string                           `json:"route_groups,omitempty"`
	RouteGroupStatuses []ChannelExecutionRouteGroupStatus `json:"route_group_statuses,omitempty"`
	ChannelIDs         []int                              `json:"channel_ids,omitempty"`
	AffinityHit        bool                               `json:"affinity_hit,omitempty"`
}

type channelExecutionTraceState struct {
	mu                   sync.Mutex
	trace                ChannelExecutionTrace
	indexedKeys          map[string]struct{}
	lastIndexRefreshTime int64
}

var channelExecutionTraceCacheOnce sync.Once
var channelExecutionTraceCache *cachex.HybridCache[ChannelExecutionTrace]
var channelExecutionRecentMu sync.Mutex
var channelExecutionRecent = make(map[string]map[string]ChannelExecutionTrace)
var channelExecutionRecentWrites uint64

func getChannelExecutionTraceCache() *cachex.HybridCache[ChannelExecutionTrace] {
	channelExecutionTraceCacheOnce.Do(func() {
		channelExecutionTraceCache = cachex.NewHybridCache[ChannelExecutionTrace](cachex.HybridCacheConfig[ChannelExecutionTrace]{
			Namespace: cachex.Namespace(channelExecutionTraceNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.JSONCodec[ChannelExecutionTrace]{},
			Memory: func() *hot.HotCache[string, ChannelExecutionTrace] {
				return hot.NewHotCache[string, ChannelExecutionTrace](hot.LRU, 10_000).
					WithTTL(channelExecutionTraceTTL).
					WithJanitor().
					Build()
			},
		})
	})
	return channelExecutionTraceCache
}

func ChannelExecutionMode() string {
	if IsChannelRouteEnabled() {
		return "route"
	}
	return "retry"
}

func BuildChannelExecutionPlan(group string, modelName string, requestPath string, mode string) (ChannelExecutionPlan, error) {
	return buildChannelExecutionPlan(group, modelName, requestPath, mode, nil)
}

func buildChannelExecutionPlan(group string, modelName string, requestPath string, mode string, cooldownSnapshot map[int]int64) (ChannelExecutionPlan, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode != "route" && mode != "retry" {
		mode = ChannelExecutionMode()
	}
	candidates, err := model.ListSatisfiedChannelCandidates(group, modelName, requestPath)
	if err != nil {
		return ChannelExecutionPlan{}, err
	}

	poolsByPriority := make(map[int64][]ChannelExecutionCandidate)
	priorities := make([]int64, 0)
	now := common.GetTimestamp()
	cooldowns := cooldownSnapshot
	if mode == "route" {
		channelIDs := make([]int, 0, len(candidates))
		for _, candidate := range candidates {
			if cooldowns == nil {
				channelIDs = append(channelIDs, candidate.ChannelID)
				continue
			}
			if _, exists := cooldowns[candidate.ChannelID]; !exists {
				channelIDs = append(channelIDs, candidate.ChannelID)
			}
		}
		if len(channelIDs) > 0 {
			loaded := getChannelRouteCooldownsUntil(group, channelIDs, now)
			if cooldowns == nil {
				cooldowns = loaded
			} else {
				for channelID, until := range loaded {
					cooldowns[channelID] = until
				}
			}
		}
	}
	for _, candidate := range candidates {
		state := "candidate"
		cooldownUntil := int64(0)
		if mode == "route" {
			cooldownUntil = cooldowns[candidate.ChannelID]
			if cooldownUntil > now {
				state = "cooling"
			}
		}
		if _, exists := poolsByPriority[candidate.Priority]; !exists {
			priorities = append(priorities, candidate.Priority)
		}
		poolsByPriority[candidate.Priority] = append(poolsByPriority[candidate.Priority], ChannelExecutionCandidate{
			ChannelID:     candidate.ChannelID,
			ChannelName:   candidate.ChannelName,
			Priority:      candidate.Priority,
			Weight:        candidate.Weight,
			State:         state,
			CooldownUntil: cooldownUntil,
		})
	}
	sort.Slice(priorities, func(i, j int) bool { return priorities[i] > priorities[j] })

	maxPools := len(priorities)
	maxAttempts := maxPools
	if mode == "retry" {
		maxAttempts = common.RetryTimes + 1
		if maxPools > maxAttempts {
			maxPools = maxAttempts
		}
	}
	pools := make([]ChannelExecutionCandidatePool, 0, maxPools)
	for _, priority := range priorities[:maxPools] {
		poolCandidates := poolsByPriority[priority]
		sort.SliceStable(poolCandidates, func(i, j int) bool {
			if poolCandidates[i].Weight != poolCandidates[j].Weight {
				return poolCandidates[i].Weight > poolCandidates[j].Weight
			}
			return poolCandidates[i].ChannelID < poolCandidates[j].ChannelID
		})
		pools = append(pools, ChannelExecutionCandidatePool{Priority: priority, Candidates: poolCandidates})
	}

	return ChannelExecutionPlan{
		Mode:        mode,
		Group:       group,
		Model:       modelName,
		RequestPath: requestPath,
		MaxAttempts: maxAttempts,
		Pools:       pools,
	}, nil
}

func ensureChannelExecutionTrace(c *gin.Context, group string, modelName string, requestPath string) *channelExecutionTraceState {
	if c == nil {
		return nil
	}
	if value, exists := c.Get(channelExecutionTraceContextKey); exists {
		if state, ok := value.(*channelExecutionTraceState); ok {
			return state
		}
	}
	now := time.Now().UnixMilli()
	routeGroups := make([]string, 0)
	for _, route := range getTokenGroupRoutes(c) {
		routeGroups = append(routeGroups, route.Group)
	}
	state := &channelExecutionTraceState{
		indexedKeys: make(map[string]struct{}),
		trace: ChannelExecutionTrace{
			RequestID:   c.GetString(common.RequestIdKey),
			Mode:        ChannelExecutionMode(),
			Group:       group,
			RouteGroups: routeGroups,
			Model:       modelName,
			RequestPath: requestPath,
			Status:      "running",
			StartedAt:   now,
			UpdatedAt:   now,
			Events:      make([]ChannelExecutionEvent, 0, 8),
		},
	}
	c.Set(channelExecutionTraceContextKey, state)
	return state
}

func publishChannelExecutionTrace(state *channelExecutionTraceState) {
	if state == nil {
		return
	}
	updateChannelExecutionRouteGroupStatuses(&state.trace)
	snapshot := state.trace
	snapshot.Events = append([]ChannelExecutionEvent(nil), state.trace.Events...)
	if snapshot.RequestID == "" {
		return
	}
	if common.RedisEnabled && common.RDB != nil {
		if state.indexedKeys == nil {
			state.indexedKeys = make(map[string]struct{})
		}
		keysToIndex, refreshAll := channelExecutionIndexKeysForPublish(state, snapshot)
		if err := publishChannelExecutionTraceRedis(snapshot, keysToIndex); err != nil {
			common.SysLog("failed to publish channel execution trace: " + err.Error())
			return
		}
		for _, key := range keysToIndex {
			state.indexedKeys[key] = struct{}{}
		}
		if refreshAll {
			state.lastIndexRefreshTime = snapshot.UpdatedAt
		}
		return
	}
	if err := getChannelExecutionTraceCache().SetWithTTL(snapshot.RequestID, snapshot, channelExecutionTraceTTL); err != nil {
		common.SysLog("failed to cache channel execution trace: " + err.Error())
	}
	indexChannelExecutionTrace(snapshot)
}

func channelExecutionIndexKeysForPublish(state *channelExecutionTraceState, trace ChannelExecutionTrace) ([]string, bool) {
	allKeys := channelExecutionTraceIndexKeys(trace)
	refreshAll := len(allKeys) > 0 && (trace.Status != "running" ||
		state.lastIndexRefreshTime == 0 ||
		trace.UpdatedAt-state.lastIndexRefreshTime >= channelExecutionIndexRefreshTTL.Milliseconds())
	if refreshAll {
		return allKeys, true
	}
	keys := make([]string, 0, len(allKeys))
	for _, key := range allKeys {
		if _, exists := state.indexedKeys[key]; !exists {
			keys = append(keys, key)
		}
	}
	return keys, false
}

func publishChannelExecutionTraceRedis(trace ChannelExecutionTrace, indexKeys []string) error {
	raw, err := json.Marshal(trace)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	pipe := common.RDB.Pipeline()
	pipe.Set(ctx, getChannelExecutionTraceCache().FullKey(trace.RequestID), raw, channelExecutionTraceTTL)
	queueChannelExecutionTraceIndex(ctx, pipe, trace, indexKeys)
	_, err = pipe.Exec(ctx)
	return err
}

func updateChannelExecutionRouteGroupStatuses(trace *ChannelExecutionTrace) {
	if trace == nil || len(trace.RouteGroups) == 0 {
		return
	}
	statuses := make([]ChannelExecutionRouteGroupStatus, len(trace.RouteGroups))
	indexByGroup := make(map[string]int, len(trace.RouteGroups))
	for index, group := range trace.RouteGroups {
		statuses[index] = ChannelExecutionRouteGroupStatus{Group: group, Status: "pending"}
		indexByGroup[group] = index
	}
	for _, event := range trace.Events {
		if event.Group == "" {
			continue
		}
		index, exists := indexByGroup[event.Group]
		if !exists {
			continue
		}
		status := ""
		switch event.State {
		case "active", "affinity_hit":
			status = "active"
		case "success":
			status = "success"
		case "failed":
			status = "failed"
		case "cooling":
			status = "cooling"
		case "skipped":
			status = "skipped"
		case "finished":
			status = "failed"
		}
		if status != "" {
			statuses[index].Status = status
			if event.CooldownUntil > 0 {
				statuses[index].CooldownUntil = event.CooldownUntil
			}
		}
	}
	trace.RouteGroupStatuses = statuses
}

func channelExecutionRecentKey(channelID int, group string) string {
	if channelID <= 0 || strings.TrimSpace(group) == "" {
		return ""
	}
	return fmt.Sprintf("%s:%d:%s", channelExecutionRecentNamespace, channelID, common.GenerateHMAC(group))
}

func channelExecutionRecentGroupKey(group string) string {
	if strings.TrimSpace(group) == "" {
		return ""
	}
	return fmt.Sprintf("%s:group:%s", channelExecutionRecentNamespace, common.GenerateHMAC(group))
}

func channelExecutionTraceIndexKeys(trace ChannelExecutionTrace) []string {
	keys := make([]string, 0)
	seen := make(map[string]struct{})
	for _, event := range trace.Events {
		group := event.Group
		if group == "" {
			group = trace.Group
		}
		key := channelExecutionRecentKey(event.ChannelID, group)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; !exists {
			seen[key] = struct{}{}
			keys = append(keys, key)
		}
		groupKey := channelExecutionRecentGroupKey(group)
		if _, exists := seen[groupKey]; !exists && groupKey != "" {
			seen[groupKey] = struct{}{}
			keys = append(keys, groupKey)
		}
	}
	return keys
}

func indexChannelExecutionTrace(trace ChannelExecutionTrace) {
	keys := channelExecutionTraceIndexKeys(trace)
	if len(keys) == 0 || trace.RequestID == "" {
		return
	}
	if common.RedisEnabled && common.RDB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		pipe := common.RDB.Pipeline()
		queueChannelExecutionTraceIndex(ctx, pipe, trace, keys)
		if _, err := pipe.Exec(ctx); err != nil {
			common.SysLog("failed to index channel execution trace: " + err.Error())
		}
		return
	}

	cutoff := time.Now().Add(-channelExecutionTraceTTL).UnixMilli()
	channelExecutionRecentMu.Lock()
	defer channelExecutionRecentMu.Unlock()
	channelExecutionRecentWrites++
	for _, key := range keys {
		entries := channelExecutionRecent[key]
		if entries == nil {
			entries = make(map[string]ChannelExecutionTrace)
			channelExecutionRecent[key] = entries
		}
		entries[trace.RequestID] = trace
		for requestID, entry := range entries {
			if entry.UpdatedAt < cutoff {
				delete(entries, requestID)
			}
		}
		if len(entries) == 0 {
			delete(channelExecutionRecent, key)
		}
	}
	if channelExecutionRecentWrites%channelExecutionRecentPruneEvery == 0 {
		pruneChannelExecutionRecentLocked(cutoff)
	}
}

func queueChannelExecutionTraceIndex(ctx context.Context, pipe redis.Pipeliner, trace ChannelExecutionTrace, keys []string) {
	cutoff := time.Now().Add(-channelExecutionTraceTTL).UnixMilli()
	for _, key := range keys {
		pipe.ZAdd(ctx, key, &redis.Z{Score: float64(trace.UpdatedAt), Member: trace.RequestID})
		pipe.ZRemRangeByScore(ctx, key, "-inf", strconv.FormatInt(cutoff-1, 10))
		pipe.Expire(ctx, key, channelExecutionTraceTTL)
	}
}

func pruneChannelExecutionRecentLocked(cutoff int64) (int, int) {
	deletedKeys := 0
	deletedTraces := 0
	for key, entries := range channelExecutionRecent {
		for requestID, trace := range entries {
			if trace.UpdatedAt < cutoff {
				delete(entries, requestID)
				deletedTraces++
			}
		}
		if len(entries) == 0 {
			delete(channelExecutionRecent, key)
			deletedKeys++
		}
	}
	return deletedKeys, deletedTraces
}

func pruneChannelExecutionRecent(cutoff int64) (int, int) {
	channelExecutionRecentMu.Lock()
	defer channelExecutionRecentMu.Unlock()
	return pruneChannelExecutionRecentLocked(cutoff)
}

func traceTouchesChannelGroup(trace ChannelExecutionTrace, channelID int, group string) bool {
	if trace.Compact {
		if trace.Group != group {
			return false
		}
		for _, candidateID := range trace.ChannelIDs {
			if candidateID == channelID {
				return true
			}
		}
		return false
	}
	for _, event := range trace.Events {
		eventGroup := event.Group
		if eventGroup == "" {
			eventGroup = trace.Group
		}
		if event.ChannelID == channelID && eventGroup == group {
			return true
		}
	}
	return false
}

func traceTouchesGroup(trace ChannelExecutionTrace, group string) bool {
	if trace.Compact {
		return trace.Group == group
	}
	for _, event := range trace.Events {
		eventGroup := event.Group
		if eventGroup == "" {
			eventGroup = trace.Group
		}
		if eventGroup == group {
			return true
		}
	}
	return false
}

func listPersistedChannelExecutionTraces(channelID int, group string, limit int, cutoff int64) ([]ChannelExecutionTrace, error) {
	if model.LOG_DB == nil {
		return nil, nil
	}
	queryLimit := limit * 10
	if queryLimit < 50 {
		queryLimit = 50
	}
	if queryLimit > 500 {
		queryLimit = 500
	}
	logs := make([]model.Log, 0, queryLimit)
	err := model.LOG_DB.
		Select("id", "created_at", "type", "request_id", "model_name", "group", "channel_id", "other").
		Where("created_at >= ? AND type IN ?", cutoff/1000, []int{model.LogTypeConsume, model.LogTypeError}).
		Where(&model.Log{Group: group}).
		Order("id DESC").
		Limit(queryLimit).
		Find(&logs).Error
	if err != nil {
		return nil, err
	}

	traces := make([]ChannelExecutionTrace, 0, limit)
	seen := make(map[string]struct{})
	for _, logEntry := range logs {
		var other struct {
			RequestPath string `json:"request_path"`
			AdminInfo   struct {
				ChannelExecutionTrace json.RawMessage `json:"channel_execution_trace"`
			} `json:"admin_info"`
		}
		if err := json.Unmarshal([]byte(logEntry.Other), &other); err != nil || len(other.AdminInfo.ChannelExecutionTrace) == 0 {
			continue
		}
		var trace ChannelExecutionTrace
		if err := json.Unmarshal(other.AdminInfo.ChannelExecutionTrace, &trace); err != nil {
			continue
		}
		if trace.RequestID == "" {
			trace.RequestID = logEntry.RequestId
		}
		if trace.RequestID == "" {
			continue
		}
		if _, exists := seen[trace.RequestID]; exists {
			continue
		}
		if trace.Group == "" {
			trace.Group = logEntry.Group
		}
		if trace.Model == "" {
			trace.Model = logEntry.ModelName
		}
		if trace.RequestPath == "" {
			trace.RequestPath = other.RequestPath
		}
		if trace.StartedAt == 0 {
			trace.StartedAt = logEntry.CreatedAt * 1000
		}
		if trace.UpdatedAt == 0 {
			trace.UpdatedAt = logEntry.CreatedAt * 1000
		}
		if logEntry.Type == model.LogTypeError && trace.Status == "running" {
			trace.Status = "failed"
		}
		if !traceTouchesGroup(trace, group) || (channelID > 0 && !traceTouchesChannelGroup(trace, channelID, group)) {
			continue
		}
		seen[trace.RequestID] = struct{}{}
		traces = append(traces, trace)
		if len(traces) >= limit {
			break
		}
	}
	return traces, nil
}

func ListChannelExecutionTraces(channelID int, group string, limit int) ([]ChannelExecutionTrace, error) {
	group = strings.TrimSpace(group)
	if channelID < 0 || group == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	key := channelExecutionRecentGroupKey(group)
	if channelID > 0 {
		key = channelExecutionRecentKey(channelID, group)
	}
	cutoff := time.Now().Add(-channelExecutionTraceTTL).UnixMilli()

	if common.RedisEnabled && common.RDB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		requestIDs, err := common.RDB.ZRevRangeByScore(ctx, key, &redis.ZRangeBy{
			Max: "+inf", Min: strconv.FormatInt(cutoff, 10), Offset: 0, Count: int64(limit * 3),
		}).Result()
		if err != nil {
			return nil, err
		}
		values, err := getChannelExecutionTraceCache().GetMany(requestIDs)
		if err != nil {
			return nil, err
		}
		traces := make([]ChannelExecutionTrace, 0, limit)
		for _, requestID := range requestIDs {
			trace, exists := values[getChannelExecutionTraceCache().FullKey(requestID)]
			if !exists || (channelID > 0 && !traceTouchesChannelGroup(trace, channelID, group)) || !traceTouchesGroup(trace, group) {
				continue
			}
			traces = append(traces, trace)
			if len(traces) >= limit {
				break
			}
		}
		if len(traces) > 0 {
			return traces, nil
		}
		return listPersistedChannelExecutionTraces(channelID, group, limit, cutoff)
	}

	channelExecutionRecentMu.Lock()
	entries := channelExecutionRecent[key]
	traces := make([]ChannelExecutionTrace, 0, len(entries))
	for requestID, trace := range entries {
		if trace.UpdatedAt < cutoff {
			delete(entries, requestID)
			continue
		}
		if traceTouchesGroup(trace, group) && (channelID == 0 || traceTouchesChannelGroup(trace, channelID, group)) {
			traces = append(traces, trace)
		}
	}
	if len(entries) == 0 {
		delete(channelExecutionRecent, key)
	}
	channelExecutionRecentMu.Unlock()
	sort.Slice(traces, func(i, j int) bool { return traces[i].UpdatedAt > traces[j].UpdatedAt })
	if len(traces) > limit {
		traces = traces[:limit]
	}
	if len(traces) > 0 {
		return traces, nil
	}
	return listPersistedChannelExecutionTraces(channelID, group, limit, cutoff)
}

func appendChannelExecutionEvent(c *gin.Context, group string, modelName string, requestPath string, event ChannelExecutionEvent) {
	state := ensureChannelExecutionTrace(c, group, modelName, requestPath)
	if state == nil {
		return
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if group != "" {
		state.trace.Group = group
	}
	event.Sequence = len(state.trace.Events) + 1
	event.Timestamp = time.Now().UnixMilli()
	state.trace.UpdatedAt = event.Timestamp
	state.trace.Events = append(state.trace.Events, event)
	publishChannelExecutionTrace(state)
}

func nextChannelCandidateIDs(plan ChannelExecutionPlan, selectedID int, selectedPriority int64) []int {
	nextIDs := make([]int, 0)
	selectedPoolFound := false
	for _, pool := range plan.Pools {
		if plan.Mode == "retry" {
			if pool.Priority == selectedPriority {
				selectedPoolFound = true
				continue
			}
			if !selectedPoolFound {
				continue
			}
		}
		for _, candidate := range pool.Candidates {
			if candidate.ChannelID != selectedID && candidate.State != "cooling" {
				nextIDs = append(nextIDs, candidate.ChannelID)
			}
		}
		if plan.Mode == "retry" && len(nextIDs) > 0 {
			break
		}
	}
	return nextIDs
}

func TrackChannelExecutionSelection(c *gin.Context, group string, modelName string, requestPath string, channel *model.Channel, retryIndex int) {
	trackChannelExecutionSelectionWithCooldowns(c, group, modelName, requestPath, channel, retryIndex, nil)
}

func trackChannelExecutionSelectionWithCooldowns(c *gin.Context, group string, modelName string, requestPath string, channel *model.Channel, retryIndex int, cooldowns map[int]int64) {
	if channel == nil {
		return
	}
	plan, _ := buildChannelExecutionPlan(group, modelName, requestPath, ChannelExecutionMode(), cooldowns)
	appendChannelExecutionEvent(c, group, modelName, requestPath, ChannelExecutionEvent{
		Group:       group,
		ChannelID:   channel.Id,
		ChannelName: channel.Name,
		Priority:    channel.GetPriority(),
		State:       "active",
		RetryIndex:  retryIndex,
		NextIDs:     nextChannelCandidateIDs(plan, channel.Id, channel.GetPriority()),
	})
}

func TrackResolvedChannelExecutionAttempt(c *gin.Context, group string, modelName string, requestPath string, channel *model.Channel, retryIndex int) {
	if channel == nil {
		return
	}
	if state, ok := channelExecutionTraceStateFromContext(c); ok {
		state.mu.Lock()
		if len(state.trace.Events) > 0 {
			last := state.trace.Events[len(state.trace.Events)-1]
			if last.State == "active" && last.ChannelID == channel.Id && last.RetryIndex == retryIndex {
				state.mu.Unlock()
				return
			}
		}
		if group == "" && state.trace.Group != "" {
			group = state.trace.Group
		}
		if modelName == "" && state.trace.Model != "" {
			modelName = state.trace.Model
		}
		if requestPath == "" && state.trace.RequestPath != "" {
			requestPath = state.trace.RequestPath
		}
		state.mu.Unlock()
	}
	TrackChannelExecutionSelection(c, group, modelName, requestPath, channel, retryIndex)
}

func TrackChannelExecutionAffinityHit(c *gin.Context, group string, modelName string, requestPath string, channelID int, reason string) {
	channel, _ := model.CacheGetChannel(channelID)
	event := ChannelExecutionEvent{Group: group, ChannelID: channelID, State: "affinity_hit", Reason: reason}
	if channel != nil {
		event.ChannelName = channel.Name
		event.Priority = channel.GetPriority()
	}
	appendChannelExecutionEvent(c, group, modelName, requestPath, event)
}

func TrackChannelExecutionSkipped(c *gin.Context, group string, modelName string, requestPath string, channel *model.Channel, reason string, cooldownUntil int64) {
	if channel == nil {
		return
	}
	appendChannelExecutionEvent(c, group, modelName, requestPath, ChannelExecutionEvent{
		Group: group, ChannelID: channel.Id, ChannelName: channel.Name,
		Priority: channel.GetPriority(), State: "skipped", Reason: reason, CooldownUntil: cooldownUntil,
	})
}

func TrackChannelExecutionSameChannelRetry(c *gin.Context, channel *model.Channel, retryIndex int) {
	if channel == nil {
		return
	}
	appendChannelExecutionEvent(c, "", "", "", ChannelExecutionEvent{
		ChannelID: channel.Id, ChannelName: channel.Name, Priority: channel.GetPriority(),
		State: "same_channel_retry", RetryIndex: retryIndex,
	})
}

func TrackChannelExecutionFailure(c *gin.Context, channelID int, reason string) {
	channel, _ := model.CacheGetChannel(channelID)
	event := ChannelExecutionEvent{ChannelID: channelID, State: "failed", Reason: reason}
	if channel != nil {
		event.ChannelName = channel.Name
		event.Priority = channel.GetPriority()
	}
	appendChannelExecutionEvent(c, "", "", "", event)
}

func TrackChannelExecutionCooling(c *gin.Context, group string, channelID int, until int64) {
	channel, _ := model.CacheGetChannel(channelID)
	event := ChannelExecutionEvent{Group: group, ChannelID: channelID, State: "cooling", CooldownUntil: until}
	if channel != nil {
		event.ChannelName = channel.Name
		event.Priority = channel.GetPriority()
	}
	appendChannelExecutionEvent(c, group, "", "", event)
}

func TrackChannelExecutionGroupEvent(c *gin.Context, group string, modelName string, requestPath string, state string, reason string, cooldownUntil int64) {
	// Group-routing events describe a candidate route and must not become the
	// trace's actual execution group before a channel is selected.
	appendChannelExecutionEvent(c, "", modelName, requestPath, ChannelExecutionEvent{
		Group: group, State: state, Reason: reason, CooldownUntil: cooldownUntil,
	})
}

func MarkChannelExecutionSuccess(c *gin.Context) {
	state, ok := channelExecutionTraceStateFromContext(c)
	if !ok {
		return
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.trace.Status != "running" {
		return
	}
	channelID := 0
	channelName := ""
	priority := int64(0)
selectionLoop:
	for index := len(state.trace.Events) - 1; index >= 0; index-- {
		event := state.trace.Events[index]
		if event.ChannelID <= 0 {
			continue
		}
		switch event.State {
		case "active", "affinity_hit", "same_channel_retry":
			channelID, channelName, priority = event.ChannelID, event.ChannelName, event.Priority
			break selectionLoop
		}
	}
	now := time.Now().UnixMilli()
	state.trace.Events = append(state.trace.Events, ChannelExecutionEvent{
		Sequence: len(state.trace.Events) + 1, Timestamp: now, Group: state.trace.Group,
		ChannelID: channelID, ChannelName: channelName, Priority: priority, State: "success",
	})
	state.trace.Status = "success"
	state.trace.UpdatedAt = now
	publishChannelExecutionTrace(state)
}

func MarkChannelExecutionFailed(c *gin.Context, reason string) {
	state, ok := channelExecutionTraceStateFromContext(c)
	if !ok {
		return
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.trace.Status != "running" {
		return
	}
	state.trace.Status = "failed"
	state.trace.UpdatedAt = time.Now().UnixMilli()
	if reason != "" {
		state.trace.Events = append(state.trace.Events, ChannelExecutionEvent{
			Sequence: len(state.trace.Events) + 1, Timestamp: state.trace.UpdatedAt,
			Group: state.trace.Group, State: "finished", Reason: reason,
		})
	}
	publishChannelExecutionTrace(state)
}

func FinalizeChannelExecutionTrace(c *gin.Context) {
	state, ok := channelExecutionTraceStateFromContext(c)
	if !ok {
		return
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.trace.Status != "running" {
		return
	}
	state.trace.Status = "failed"
	reason := "request_finished_without_success"
	if c != nil && c.Request != nil && c.Request.Context().Err() != nil {
		state.trace.Status = "cancelled"
		reason = c.Request.Context().Err().Error()
	}
	state.trace.UpdatedAt = time.Now().UnixMilli()
	state.trace.Events = append(state.trace.Events, ChannelExecutionEvent{
		Sequence: len(state.trace.Events) + 1, Timestamp: state.trace.UpdatedAt,
		Group: state.trace.Group, State: "finished", Reason: reason,
	})
	publishChannelExecutionTrace(state)
}

func channelExecutionTraceStateFromContext(c *gin.Context) (*channelExecutionTraceState, bool) {
	if c == nil {
		return nil, false
	}
	value, exists := c.Get(channelExecutionTraceContextKey)
	if !exists {
		return nil, false
	}
	state, ok := value.(*channelExecutionTraceState)
	return state, ok && state != nil
}

func appendChannelExecutionTraceAdminInfo(c *gin.Context, adminInfo map[string]interface{}, errorSnapshot bool) {
	if adminInfo == nil {
		return
	}
	state, ok := channelExecutionTraceStateFromContext(c)
	if !ok {
		return
	}
	state.mu.Lock()
	snapshot := state.trace
	snapshot.Events = append([]ChannelExecutionEvent(nil), state.trace.Events...)
	state.mu.Unlock()
	if errorSnapshot && snapshot.Status == "running" {
		snapshot.Status = "failed"
	}
	// Successful SQL logs only need the execution summary. The runtime cache
	// keeps the complete timeline for the execution-plan UI.
	if snapshot.Status == "success" {
		channelIDs := make([]int, 0, len(snapshot.Events))
		affinityHit := false
		for _, event := range snapshot.Events {
			if event.State == "active" && event.ChannelID > 0 {
				channelIDs = append(channelIDs, event.ChannelID)
			}
			if event.State == "affinity_hit" {
				affinityHit = true
			}
		}
		adminInfo["channel_execution_trace"] = ChannelExecutionTraceSummary{
			Compact:            true,
			Mode:               snapshot.Mode,
			Status:             snapshot.Status,
			Group:              snapshot.Group,
			RouteGroups:        append([]string(nil), snapshot.RouteGroups...),
			RouteGroupStatuses: append([]ChannelExecutionRouteGroupStatus(nil), snapshot.RouteGroupStatuses...),
			ChannelIDs:         channelIDs,
			AffinityHit:        affinityHit,
		}
		return
	}
	adminInfo["channel_execution_trace"] = snapshot
}

func AppendChannelExecutionTraceAdminInfo(c *gin.Context, adminInfo map[string]interface{}) {
	appendChannelExecutionTraceAdminInfo(c, adminInfo, false)
}

func AppendChannelExecutionTraceErrorAdminInfo(c *gin.Context, adminInfo map[string]interface{}) {
	appendChannelExecutionTraceAdminInfo(c, adminInfo, true)
}

func GetChannelExecutionTrace(requestID string) (ChannelExecutionTrace, bool, error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return ChannelExecutionTrace{}, false, nil
	}
	return getChannelExecutionTraceCache().Get(requestID)
}
