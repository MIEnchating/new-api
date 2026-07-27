package service

import (
	"container/list"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
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
	channelExecutionPublishDebounce  = 100 * time.Millisecond
	channelExecutionPublishQueueSize = 4096
	channelExecutionPublishJobSize   = 512
	channelExecutionPublishWorkers   = 8
	channelExecutionPublishRetries   = 3
	channelExecutionPublishRetryBase = 50 * time.Millisecond
	channelExecutionPublishTimeout   = 500 * time.Millisecond
	channelExecutionFallbackSize     = 4096
	channelExecutionRecoveryBatch    = 64
	channelExecutionRecoveryInterval = 250 * time.Millisecond
	channelExecutionRecoveryMaxDelay = 5 * time.Second
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

type ChannelExecutionFinalError struct {
	StatusCode int    `json:"status_code,omitempty"`
	Message    string `json:"message,omitempty"`
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
	ChannelName        string                             `json:"channel_name,omitempty"`
	Priority           *int64                             `json:"priority,omitempty"`
	AffinityHit        bool                               `json:"affinity_hit,omitempty"`
	OriginalFinalError *ChannelExecutionFinalError        `json:"original_final_error,omitempty"`
	UserVisibleError   *ChannelExecutionFinalError        `json:"user_visible_final_error,omitempty"`
	CustomErrorApplied bool                               `json:"custom_error_applied,omitempty"`
}

type ChannelExecutionTraceSummary struct {
	Compact            bool                               `json:"compact"`
	Mode               string                             `json:"mode"`
	Status             string                             `json:"status"`
	Group              string                             `json:"group,omitempty"`
	RouteGroups        []string                           `json:"route_groups,omitempty"`
	RouteGroupStatuses []ChannelExecutionRouteGroupStatus `json:"route_group_statuses,omitempty"`
	StartedAt          int64                              `json:"started_at,omitempty"`
	UpdatedAt          int64                              `json:"updated_at,omitempty"`
	ChannelIDs         []int                              `json:"channel_ids,omitempty"`
	ChannelName        string                             `json:"channel_name,omitempty"`
	Priority           *int64                             `json:"priority,omitempty"`
	AffinityHit        bool                               `json:"affinity_hit,omitempty"`
}

type channelExecutionTraceState struct {
	mu                   sync.Mutex
	publishMu            sync.Mutex
	trace                ChannelExecutionTrace
	indexedKeys          map[string]struct{}
	lastIndexRefreshTime int64
	revision             uint64
	publishedRevision    uint64
	publishFailureRev    uint64
	publishFailures      int
	publishQueued        bool
}

type channelExecutionPublishRequest struct {
	state *channelExecutionTraceState
	due   time.Time
}

type channelExecutionPublishResult struct {
	succeeded bool
	retryable bool
}

type channelExecutionFallbackEntry struct {
	trace            ChannelExecutionTrace
	state            *channelExecutionTraceState
	orderElement     *list.Element
	nextRecoveryAt   time.Time
	recoveryAttempts int
}

// ChannelExecutionPublishStats exposes queue pressure and terminal recovery so
// saturation is visible without logging every dropped enqueue attempt.
type ChannelExecutionPublishStats struct {
	InputQueueSaturation   uint64 `json:"input_queue_saturation"`
	PendingQueueSaturation uint64 `json:"pending_queue_saturation"`
	TerminalRetryAttempts  uint64 `json:"terminal_retry_attempts"`
	TerminalRetryQueued    uint64 `json:"terminal_retry_queued"`
	TerminalRecovered      uint64 `json:"terminal_recovered"`
	TerminalEvicted        uint64 `json:"terminal_evicted"`
}

var channelExecutionTraceCacheOnce sync.Once
var channelExecutionTraceCache *cachex.HybridCache[ChannelExecutionTrace]
var channelExecutionRecentMu sync.Mutex
var channelExecutionRecent = make(map[string]map[string]ChannelExecutionTrace)
var channelExecutionFallback = make(map[string]*channelExecutionFallbackEntry)
var channelExecutionFallbackOrder = list.New()
var channelExecutionRecentWrites uint64
var channelExecutionPublisherOnce sync.Once
var channelExecutionPublishInput chan channelExecutionPublishRequest
var channelExecutionRecoveryOnce sync.Once
var channelExecutionRecoveryWake chan struct{}
var channelExecutionInputQueueSaturation atomic.Uint64
var channelExecutionPendingQueueSaturation atomic.Uint64
var channelExecutionTerminalRetryAttempts atomic.Uint64
var channelExecutionTerminalRetryQueued atomic.Uint64
var channelExecutionTerminalRecovered atomic.Uint64
var channelExecutionTerminalEvicted atomic.Uint64

// GetChannelExecutionPublishStats returns an atomic publisher-health snapshot.
func GetChannelExecutionPublishStats() ChannelExecutionPublishStats {
	return ChannelExecutionPublishStats{
		InputQueueSaturation:   channelExecutionInputQueueSaturation.Load(),
		PendingQueueSaturation: channelExecutionPendingQueueSaturation.Load(),
		TerminalRetryAttempts:  channelExecutionTerminalRetryAttempts.Load(),
		TerminalRetryQueued:    channelExecutionTerminalRetryQueued.Load(),
		TerminalRecovered:      channelExecutionTerminalRecovered.Load(),
		TerminalEvicted:        channelExecutionTerminalEvicted.Load(),
	}
}

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
	candidates, err := model.ListSatisfiedChannelCandidates(group, modelName, requestPath)
	if err != nil {
		return ChannelExecutionPlan{}, err
	}
	return buildChannelExecutionPlanFromCandidates(group, modelName, requestPath, mode, candidates, cooldownSnapshot), nil
}

func buildChannelExecutionPlanFromCandidates(
	group string,
	modelName string,
	requestPath string,
	mode string,
	candidates []model.ChannelSelectionCandidate,
	cooldownSnapshot map[int]int64,
) ChannelExecutionPlan {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode != "route" && mode != "retry" {
		mode = ChannelExecutionMode()
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
	seenCandidateIDs := make(map[int]struct{}, len(candidates))
	for _, candidate := range candidates {
		if _, exists := seenCandidateIDs[candidate.ChannelID]; exists {
			continue
		}
		seenCandidateIDs[candidate.ChannelID] = struct{}{}
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
	}
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

func channelExecutionTraceUsesRedis() bool {
	return common.RedisEnabled && common.RDB != nil
}

func cloneChannelExecutionTrace(trace ChannelExecutionTrace) ChannelExecutionTrace {
	clone := trace
	clone.Events = append([]ChannelExecutionEvent(nil), trace.Events...)
	for index := range clone.Events {
		clone.Events[index].NextIDs = append([]int(nil), trace.Events[index].NextIDs...)
	}
	clone.RouteGroups = append([]string(nil), trace.RouteGroups...)
	clone.RouteGroupStatuses = append([]ChannelExecutionRouteGroupStatus(nil), trace.RouteGroupStatuses...)
	clone.ChannelIDs = append([]int(nil), trace.ChannelIDs...)
	if trace.OriginalFinalError != nil {
		originalFinalError := *trace.OriginalFinalError
		clone.OriginalFinalError = &originalFinalError
	}
	if trace.UserVisibleError != nil {
		userVisibleError := *trace.UserVisibleError
		clone.UserVisibleError = &userVisibleError
	}
	return clone
}

func isChannelExecutionTraceTerminal(trace ChannelExecutionTrace) bool {
	return trace.Status != "" && trace.Status != "running"
}

// preferChannelExecutionTrace keeps reads monotonic across Redis, the local
// terminal fallback and persisted logs. UpdatedAt is authoritative; terminal
// state wins an equal-millisecond tie so a stale running snapshot cannot hide
// a completed request.
func preferChannelExecutionTrace(candidate ChannelExecutionTrace, current ChannelExecutionTrace) bool {
	if candidate.UpdatedAt != current.UpdatedAt {
		return candidate.UpdatedAt > current.UpdatedAt
	}
	candidateTerminal := isChannelExecutionTraceTerminal(candidate)
	currentTerminal := isChannelExecutionTraceTerminal(current)
	if candidateTerminal != currentTerminal {
		return candidateTerminal
	}
	if len(candidate.Events) != len(current.Events) {
		return len(candidate.Events) > len(current.Events)
	}
	if candidate.OriginalFinalError != nil && current.OriginalFinalError == nil {
		return true
	}
	return candidate.UserVisibleError != nil && current.UserVisibleError == nil
}

func newerChannelExecutionTrace(first ChannelExecutionTrace, second ChannelExecutionTrace) ChannelExecutionTrace {
	if preferChannelExecutionTrace(second, first) {
		return second
	}
	return first
}

func publishChannelExecutionTraceSnapshot(state *channelExecutionTraceState, unpublishedOnly bool) channelExecutionPublishResult {
	if state == nil {
		return channelExecutionPublishResult{succeeded: true}
	}
	// Serialize debounced snapshots with terminal snapshots so an older running
	// write can never land after success/failure.
	state.publishMu.Lock()
	defer state.publishMu.Unlock()

	state.mu.Lock()
	if unpublishedOnly && state.revision <= state.publishedRevision {
		state.mu.Unlock()
		return channelExecutionPublishResult{succeeded: true}
	}
	revision := state.revision
	snapshot := cloneChannelExecutionTrace(state.trace)
	updateChannelExecutionRouteGroupStatuses(&snapshot)
	if snapshot.RequestID == "" {
		if revision > state.publishedRevision {
			state.publishedRevision = revision
		}
		state.mu.Unlock()
		return channelExecutionPublishResult{succeeded: true}
	}
	var keysToIndex []string
	refreshAll := false
	usesRedis := channelExecutionTraceUsesRedis()
	if usesRedis {
		if state.indexedKeys == nil {
			state.indexedKeys = make(map[string]struct{})
		}
		keysToIndex, refreshAll = channelExecutionIndexKeysForPublish(state, snapshot)
	}
	state.mu.Unlock()

	if usesRedis {
		if err := publishChannelExecutionTraceRedis(snapshot, keysToIndex); err != nil {
			common.SysLog("failed to publish channel execution trace: " + err.Error())
			if snapshot.Status != "running" {
				rememberChannelExecutionTraceFallbackForState(snapshot, state)
			}
			return channelExecutionPublishResult{retryable: true}
		}
		if snapshot.Status != "running" {
			if forgetPublishedChannelExecutionTraceFallback(snapshot) {
				channelExecutionTerminalRecovered.Add(1)
			}
		}
		state.mu.Lock()
		if revision > state.publishedRevision {
			state.publishedRevision = revision
		}
		for _, key := range keysToIndex {
			state.indexedKeys[key] = struct{}{}
		}
		if refreshAll {
			state.lastIndexRefreshTime = snapshot.UpdatedAt
		}
		state.mu.Unlock()
		return channelExecutionPublishResult{succeeded: true}
	}
	if err := getChannelExecutionTraceCache().SetWithTTL(snapshot.RequestID, snapshot, channelExecutionTraceTTL); err != nil {
		common.SysLog("failed to cache channel execution trace: " + err.Error())
		return channelExecutionPublishResult{}
	}
	indexChannelExecutionTrace(snapshot)
	state.mu.Lock()
	if revision > state.publishedRevision {
		state.publishedRevision = revision
	}
	state.mu.Unlock()
	return channelExecutionPublishResult{succeeded: true}
}

func publishChannelExecutionTrace(state *channelExecutionTraceState) {
	if state == nil {
		return
	}
	if channelExecutionTraceUsesRedis() {
		state.mu.Lock()
		scheduleChannelExecutionTracePublishLocked(state, 0)
		state.mu.Unlock()
		return
	}
	result := publishChannelExecutionTraceSnapshot(state, true)
	state.mu.Lock()
	handleChannelExecutionPublishResultLocked(state, result, false)
	state.mu.Unlock()
}

func startChannelExecutionTracePublisher() {
	channelExecutionPublisherOnce.Do(func() {
		channelExecutionPublishInput = make(chan channelExecutionPublishRequest, channelExecutionPublishQueueSize)
		jobs := make(chan *channelExecutionTraceState, channelExecutionPublishJobSize)
		go func() {
			ticker := time.NewTicker(channelExecutionPublishDebounce / 4)
			defer ticker.Stop()
			pending := make(map[*channelExecutionTraceState]time.Time, channelExecutionPublishQueueSize)
			for {
				select {
				case request := <-channelExecutionPublishInput:
					if currentDue, exists := pending[request.state]; exists {
						if request.due.Before(currentDue) {
							pending[request.state] = request.due
						}
						continue
					}
					if len(pending) >= channelExecutionPublishQueueSize {
						request.state.mu.Lock()
						request.state.publishQueued = false
						snapshot := cloneChannelExecutionTrace(request.state.trace)
						request.state.mu.Unlock()
						observeChannelExecutionPublisherSaturation("pending scheduler", &channelExecutionPendingQueueSaturation)
						if isChannelExecutionTraceTerminal(snapshot) {
							signalChannelExecutionTerminalRecovery()
						}
						continue
					}
					pending[request.state] = request.due
				case now := <-ticker.C:
					jobsFull := false
					for state, due := range pending {
						if now.Before(due) {
							continue
						}
						select {
						case jobs <- state:
							delete(pending, state)
						default:
							jobsFull = true
						}
						if jobsFull {
							break
						}
					}
				}
			}
		}()
		for range channelExecutionPublishWorkers {
			go func() {
				for state := range jobs {
					result := publishChannelExecutionTraceSnapshot(state, true)
					state.mu.Lock()
					handleChannelExecutionPublishResultLocked(state, result, true)
					state.mu.Unlock()
				}
			}()
		}
	})
}

func channelExecutionPublishRetryDelay(failures int) time.Duration {
	if failures <= 1 {
		return channelExecutionPublishRetryBase
	}
	return channelExecutionPublishRetryBase * time.Duration(1<<min(failures-1, 2))
}

func observeChannelExecutionPublisherSaturation(scope string, counter *atomic.Uint64) {
	count := counter.Add(1)
	if count == 1 || count&(count-1) == 0 {
		common.SysLog(fmt.Sprintf("channel execution trace %s saturated (%d occurrences)", scope, count))
	}
}

func channelExecutionTerminalRecoveryDelay(attempts int) time.Duration {
	if attempts <= 1 {
		return channelExecutionRecoveryInterval
	}
	delay := channelExecutionRecoveryInterval * time.Duration(1<<min(attempts-1, 4))
	if delay > channelExecutionRecoveryMaxDelay {
		return channelExecutionRecoveryMaxDelay
	}
	return delay
}

func startChannelExecutionTerminalRecovery() {
	channelExecutionRecoveryOnce.Do(func() {
		channelExecutionRecoveryWake = make(chan struct{}, 1)
		go func() {
			ticker := time.NewTicker(channelExecutionRecoveryInterval)
			defer ticker.Stop()
			for {
				select {
				case <-channelExecutionRecoveryWake:
				case <-ticker.C:
				}
				retryChannelExecutionTerminalFallbacks(time.Now())
			}
		}()
	})
}

func signalChannelExecutionTerminalRecovery() {
	startChannelExecutionTerminalRecovery()
	select {
	case channelExecutionRecoveryWake <- struct{}{}:
	default:
	}
}

func dueChannelExecutionTerminalFallbackStates(now time.Time) []*channelExecutionTraceState {
	cutoff := now.Add(-channelExecutionTraceTTL).UnixMilli()
	channelExecutionRecentMu.Lock()
	defer channelExecutionRecentMu.Unlock()
	pruneChannelExecutionFallbackLocked(cutoff)
	states := make([]*channelExecutionTraceState, 0, channelExecutionRecoveryBatch)
	for element := channelExecutionFallbackOrder.Front(); element != nil && len(states) < channelExecutionRecoveryBatch; element = element.Next() {
		requestID, _ := element.Value.(string)
		entry := channelExecutionFallback[requestID]
		if entry == nil || entry.state == nil || !isChannelExecutionTraceTerminal(entry.trace) || now.Before(entry.nextRecoveryAt) {
			continue
		}
		entry.recoveryAttempts++
		entry.nextRecoveryAt = now.Add(channelExecutionTerminalRecoveryDelay(entry.recoveryAttempts))
		states = append(states, entry.state)
	}
	return states
}

func retryChannelExecutionTerminalFallbacks(now time.Time) {
	retryChannelExecutionTerminalFallbacksWithScheduler(now, func(state *channelExecutionTraceState) bool {
		return scheduleChannelExecutionTracePublishLocked(state, 0)
	})
}

func retryChannelExecutionTerminalFallbacksWithScheduler(
	now time.Time,
	schedule func(*channelExecutionTraceState) bool,
) int {
	queuedCount := 0
	for _, state := range dueChannelExecutionTerminalFallbackStates(now) {
		channelExecutionTerminalRetryAttempts.Add(1)
		state.mu.Lock()
		if state.revision <= state.publishedRevision || !isChannelExecutionTraceTerminal(state.trace) {
			snapshot := cloneChannelExecutionTrace(state.trace)
			state.mu.Unlock()
			forgetPublishedChannelExecutionTraceFallback(snapshot)
			continue
		}
		wasQueued := state.publishQueued
		queued := schedule(state)
		state.mu.Unlock()
		if queued && !wasQueued {
			channelExecutionTerminalRetryQueued.Add(1)
			queuedCount++
		}
	}
	return queuedCount
}

func handleChannelExecutionPublishResultLocked(state *channelExecutionTraceState, result channelExecutionPublishResult, worker bool) {
	if state == nil {
		return
	}
	if worker {
		state.publishQueued = false
	}
	if state.revision <= state.publishedRevision {
		state.publishFailureRev = 0
		state.publishFailures = 0
		return
	}
	if !result.succeeded && !result.retryable {
		return
	}
	if !result.retryable {
		if !state.publishQueued {
			delay := channelExecutionPublishDebounce
			if state.trace.Status != "running" {
				delay = 0
			}
			scheduleChannelExecutionTracePublishLocked(state, delay)
		}
		return
	}
	if state.publishFailureRev != state.revision {
		state.publishFailureRev = state.revision
		state.publishFailures = 0
	}
	state.publishFailures++
	if state.publishFailures > channelExecutionPublishRetries || state.publishQueued {
		return
	}
	scheduleChannelExecutionTracePublishLocked(state, channelExecutionPublishRetryDelay(state.publishFailures))
}

// scheduleChannelExecutionTracePublishLocked coalesces running and terminal
// snapshots in a bounded queue. Terminal snapshots are retained in the bounded
// fallback store and retried independently when either publisher queue is full.
func scheduleChannelExecutionTracePublishLocked(state *channelExecutionTraceState, delay time.Duration) bool {
	if state == nil {
		return false
	}
	startChannelExecutionTracePublisher()
	return scheduleChannelExecutionTracePublishToLocked(state, delay, channelExecutionPublishInput)
}

func scheduleChannelExecutionTracePublishToLocked(state *channelExecutionTraceState, delay time.Duration, input chan<- channelExecutionPublishRequest) bool {
	if state == nil {
		return false
	}
	if isChannelExecutionTraceTerminal(state.trace) && state.trace.RequestID != "" {
		snapshot := cloneChannelExecutionTrace(state.trace)
		updateChannelExecutionRouteGroupStatuses(&snapshot)
		rememberChannelExecutionTraceFallbackForState(snapshot, state)
	}
	if state.publishQueued {
		return true
	}
	state.publishQueued = true
	select {
	case input <- channelExecutionPublishRequest{state: state, due: time.Now().Add(delay)}:
		return true
	default:
		state.publishQueued = false
		observeChannelExecutionPublisherSaturation("input queue", &channelExecutionInputQueueSaturation)
		if isChannelExecutionTraceTerminal(state.trace) {
			signalChannelExecutionTerminalRecovery()
		}
		return false
	}
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
	ctx, cancel := context.WithTimeout(context.Background(), channelExecutionPublishTimeout)
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

	indexChannelExecutionTraceMemory(trace, keys)
}

func indexChannelExecutionTraceMemory(trace ChannelExecutionTrace, keys []string) {
	if trace.RequestID == "" {
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
		if existing, exists := entries[trace.RequestID]; !exists || preferChannelExecutionTrace(trace, existing) {
			entries[trace.RequestID] = cloneChannelExecutionTrace(trace)
		}
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

func rememberChannelExecutionTraceFallback(trace ChannelExecutionTrace) {
	rememberChannelExecutionTraceFallbackForState(trace, nil)
}

func rememberChannelExecutionTraceFallbackForState(trace ChannelExecutionTrace, state *channelExecutionTraceState) {
	if trace.RequestID == "" {
		return
	}
	cutoff := time.Now().Add(-channelExecutionTraceTTL).UnixMilli()
	shouldSignalRecovery := false
	channelExecutionRecentMu.Lock()
	entry := channelExecutionFallback[trace.RequestID]
	if entry == nil {
		entry = &channelExecutionFallbackEntry{
			trace:          cloneChannelExecutionTrace(trace),
			state:          state,
			nextRecoveryAt: time.Now().Add(channelExecutionRecoveryInterval),
		}
		entry.orderElement = channelExecutionFallbackOrder.PushBack(trace.RequestID)
		channelExecutionFallback[trace.RequestID] = entry
	} else {
		if preferChannelExecutionTrace(trace, entry.trace) {
			entry.trace = cloneChannelExecutionTrace(trace)
			entry.recoveryAttempts = 0
			entry.nextRecoveryAt = time.Now().Add(channelExecutionRecoveryInterval)
			channelExecutionFallbackOrder.MoveToBack(entry.orderElement)
		}
		if state != nil {
			entry.state = state
		}
	}
	pruneChannelExecutionFallbackLocked(cutoff)
	shouldSignalRecovery = entry.state != nil && isChannelExecutionTraceTerminal(entry.trace)
	channelExecutionRecentMu.Unlock()
	if shouldSignalRecovery {
		signalChannelExecutionTerminalRecovery()
	}
}

func forgetChannelExecutionTraceFallback(requestID string) {
	if requestID == "" {
		return
	}
	channelExecutionRecentMu.Lock()
	removeChannelExecutionFallbackLocked(requestID)
	channelExecutionRecentMu.Unlock()
}

func forgetPublishedChannelExecutionTraceFallback(published ChannelExecutionTrace) bool {
	if published.RequestID == "" {
		return false
	}
	channelExecutionRecentMu.Lock()
	defer channelExecutionRecentMu.Unlock()
	entry := channelExecutionFallback[published.RequestID]
	if entry == nil || preferChannelExecutionTrace(entry.trace, published) {
		return false
	}
	return removeChannelExecutionFallbackLocked(published.RequestID)
}

func removeChannelExecutionFallbackLocked(requestID string) bool {
	entry := channelExecutionFallback[requestID]
	if entry == nil {
		return false
	}
	if entry.orderElement != nil {
		channelExecutionFallbackOrder.Remove(entry.orderElement)
	}
	delete(channelExecutionFallback, requestID)
	return true
}

func pruneChannelExecutionFallbackLocked(cutoff int64) {
	for channelExecutionFallbackOrder.Len() > 0 {
		front := channelExecutionFallbackOrder.Front()
		requestID, _ := front.Value.(string)
		entry := channelExecutionFallback[requestID]
		oversized := len(channelExecutionFallback) > channelExecutionFallbackSize
		expired := entry == nil || entry.trace.UpdatedAt < cutoff
		if !oversized && !expired {
			break
		}
		if entry != nil && oversized {
			count := channelExecutionTerminalEvicted.Add(1)
			if count == 1 || count&(count-1) == 0 {
				common.SysLog(fmt.Sprintf("channel execution terminal fallback evicted before Redis persistence (%d occurrences)", count))
			}
		}
		removeChannelExecutionFallbackLocked(requestID)
	}
}

func getChannelExecutionTraceFallback(requestID string) (ChannelExecutionTrace, bool) {
	cutoff := time.Now().Add(-channelExecutionTraceTTL).UnixMilli()
	channelExecutionRecentMu.Lock()
	defer channelExecutionRecentMu.Unlock()
	entry := channelExecutionFallback[requestID]
	if entry == nil {
		return ChannelExecutionTrace{}, false
	}
	if entry.trace.UpdatedAt < cutoff {
		removeChannelExecutionFallbackLocked(requestID)
		return ChannelExecutionTrace{}, false
	}
	return cloneChannelExecutionTrace(entry.trace), true
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

func channelExecutionTraceFromLog(logEntry model.Log) (ChannelExecutionTrace, bool) {
	var other struct {
		RequestPath string `json:"request_path"`
		AdminInfo   struct {
			ChannelExecutionTrace json.RawMessage `json:"channel_execution_trace"`
		} `json:"admin_info"`
	}
	if err := json.Unmarshal([]byte(logEntry.Other), &other); err != nil || len(other.AdminInfo.ChannelExecutionTrace) == 0 {
		return ChannelExecutionTrace{}, false
	}
	var trace ChannelExecutionTrace
	if err := json.Unmarshal(other.AdminInfo.ChannelExecutionTrace, &trace); err != nil {
		return ChannelExecutionTrace{}, false
	}
	if trace.RequestID == "" {
		trace.RequestID = logEntry.RequestId
	}
	if trace.RequestID == "" {
		return ChannelExecutionTrace{}, false
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
	if !trace.Compact || len(trace.Events) > 0 || len(trace.RouteGroupStatuses) == 0 {
		if !trace.Compact || len(trace.RouteGroupStatuses) == 0 {
			updateChannelExecutionRouteGroupStatuses(&trace)
		}
	}
	if trace.Compact && len(trace.ChannelIDs) == 1 && (trace.ChannelName == "" || trace.Priority == nil) {
		if channel, err := model.CacheGetChannel(trace.ChannelIDs[0]); err == nil && channel != nil {
			trace.ChannelName = channel.Name
			priority := channel.GetPriority()
			trace.Priority = &priority
		}
	}
	return trace, true
}

func getPersistedChannelExecutionTrace(requestID string, cutoff int64) (ChannelExecutionTrace, bool, error) {
	if model.LOG_DB == nil {
		return ChannelExecutionTrace{}, false, nil
	}
	logs := make([]model.Log, 0, 10)
	err := model.LOG_DB.
		Select("id", "created_at", "type", "request_id", "model_name", "group", "channel_id", "other").
		Where("created_at >= ? AND request_id = ? AND type IN ?", cutoff/1000, requestID, []int{model.LogTypeConsume, model.LogTypeError}).
		Order("id DESC").
		Limit(10).
		Find(&logs).Error
	if err != nil {
		return ChannelExecutionTrace{}, false, err
	}
	for _, logEntry := range logs {
		if trace, exists := channelExecutionTraceFromLog(logEntry); exists {
			return trace, true, nil
		}
	}
	return ChannelExecutionTrace{}, false, nil
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
		trace, exists := channelExecutionTraceFromLog(logEntry)
		if !exists {
			continue
		}
		if _, exists := seen[trace.RequestID]; exists {
			continue
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

func listChannelExecutionMemoryTraces(channelID int, group string, cutoff int64) []ChannelExecutionTrace {
	channelExecutionRecentMu.Lock()
	defer channelExecutionRecentMu.Unlock()
	entries := channelExecutionRecent[channelExecutionRecentGroupKey(group)]
	if channelID > 0 {
		entries = channelExecutionRecent[channelExecutionRecentKey(channelID, group)]
	}
	memoryTraces := make([]ChannelExecutionTrace, 0, len(entries))
	for requestID, trace := range entries {
		if trace.UpdatedAt < cutoff {
			delete(entries, requestID)
			continue
		}
		if traceTouchesGroup(trace, group) && (channelID == 0 || traceTouchesChannelGroup(trace, channelID, group)) {
			memoryTraces = append(memoryTraces, cloneChannelExecutionTrace(trace))
		}
	}
	for requestID, entry := range channelExecutionFallback {
		if entry == nil {
			removeChannelExecutionFallbackLocked(requestID)
			continue
		}
		trace := entry.trace
		if trace.UpdatedAt < cutoff {
			removeChannelExecutionFallbackLocked(requestID)
			continue
		}
		if traceTouchesGroup(trace, group) && (channelID == 0 || traceTouchesChannelGroup(trace, channelID, group)) {
			memoryTraces = append(memoryTraces, cloneChannelExecutionTrace(trace))
		}
	}
	return memoryTraces
}

func mergeChannelExecutionTraces(limit int, traceSets ...[]ChannelExecutionTrace) []ChannelExecutionTrace {
	capacity := 0
	for _, traces := range traceSets {
		capacity += len(traces)
	}
	byRequestID := make(map[string]ChannelExecutionTrace, capacity)
	for _, traces := range traceSets {
		for _, trace := range traces {
			if trace.RequestID == "" {
				continue
			}
			existing, exists := byRequestID[trace.RequestID]
			if !exists || preferChannelExecutionTrace(trace, existing) {
				byRequestID[trace.RequestID] = trace
			}
		}
	}
	merged := make([]ChannelExecutionTrace, 0, len(byRequestID))
	for _, trace := range byRequestID {
		merged = append(merged, trace)
	}
	sort.Slice(merged, func(i, j int) bool { return merged[i].UpdatedAt > merged[j].UpdatedAt })
	if len(merged) > limit {
		merged = merged[:limit]
	}
	return merged
}

func listChannelExecutionTraceFallbacks(channelID int, group string, limit int, cutoff int64) ([]ChannelExecutionTrace, error) {
	memoryTraces := listChannelExecutionMemoryTraces(channelID, group, cutoff)
	persistedTraces, err := listPersistedChannelExecutionTraces(channelID, group, limit, cutoff)
	if err != nil && len(memoryTraces) == 0 {
		return nil, err
	}
	return mergeChannelExecutionTraces(limit, memoryTraces, persistedTraces), nil
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
			return listChannelExecutionTraceFallbacks(channelID, group, limit, cutoff)
		}
		values, err := getChannelExecutionTraceCache().GetMany(requestIDs)
		if err != nil {
			return listChannelExecutionTraceFallbacks(channelID, group, limit, cutoff)
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
		memoryTraces := listChannelExecutionMemoryTraces(channelID, group, cutoff)
		traces = mergeChannelExecutionTraces(limit, traces, memoryTraces)
		needsPersistedLookup := len(traces) == 0
		for _, trace := range traces {
			if !isChannelExecutionTraceTerminal(trace) {
				needsPersistedLookup = true
				break
			}
		}
		if !needsPersistedLookup {
			return traces, nil
		}
		persistedTraces, persistedErr := listPersistedChannelExecutionTraces(channelID, group, limit, cutoff)
		if persistedErr != nil {
			if len(traces) > 0 {
				return traces, nil
			}
			return nil, persistedErr
		}
		return mergeChannelExecutionTraces(limit, traces, persistedTraces), nil
	}

	return listChannelExecutionTraceFallbacks(channelID, group, limit, cutoff)
}

func appendChannelExecutionEvent(c *gin.Context, group string, modelName string, requestPath string, event ChannelExecutionEvent) {
	state := ensureChannelExecutionTrace(c, group, modelName, requestPath)
	if state == nil {
		return
	}
	state.mu.Lock()
	if group != "" {
		state.trace.Group = group
	}
	event.Sequence = len(state.trace.Events) + 1
	event.Timestamp = time.Now().UnixMilli()
	state.trace.UpdatedAt = event.Timestamp
	state.trace.Events = append(state.trace.Events, event)
	updateChannelExecutionRouteGroupStatuses(&state.trace)
	state.revision++
	if channelExecutionTraceUsesRedis() {
		scheduleChannelExecutionTracePublishLocked(state, channelExecutionPublishDebounce)
		state.mu.Unlock()
		return
	}
	state.mu.Unlock()
	publishChannelExecutionTraceSnapshot(state, true)
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
	trackChannelExecutionSelectionWithCandidates(c, group, modelName, requestPath, channel, retryIndex, nil, cooldowns)
}

func trackChannelExecutionSelectionWithCandidates(
	c *gin.Context,
	group string,
	modelName string,
	requestPath string,
	channel *model.Channel,
	retryIndex int,
	candidates []model.ChannelSelectionCandidate,
	cooldowns map[int]int64,
) {
	if channel == nil {
		return
	}
	var plan ChannelExecutionPlan
	if candidates == nil {
		plan, _ = buildChannelExecutionPlan(group, modelName, requestPath, ChannelExecutionMode(), cooldowns)
	} else {
		plan = buildChannelExecutionPlanFromCandidates(group, modelName, requestPath, ChannelExecutionMode(), candidates, cooldowns)
	}
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
		for index := len(state.trace.Events) - 1; index >= 0; index-- {
			last := state.trace.Events[index]
			// Group-routing decisions can be recorded after channel selection.
			// Skip them when checking whether this concrete attempt is already
			// tracked, otherwise the resolver appends a duplicate active event.
			if last.ChannelID <= 0 {
				continue
			}
			if last.State == "active" && last.ChannelID == channel.Id && last.RetryIndex == retryIndex {
				state.mu.Unlock()
				return
			}
			break
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

func TrackChannelExecutionGroupAffinityHit(c *gin.Context, group string, modelName string, requestPath string, channelID int) {
	state := ensureChannelExecutionTrace(c, "", modelName, requestPath)
	if state == nil {
		return
	}

	now := time.Now().UnixMilli()
	event := ChannelExecutionEvent{
		Timestamp: now,
		Group:     group,
		State:     "affinity_hit",
		Reason:    "group_affinity",
	}

	state.mu.Lock()
	insertAt := len(state.trace.Events)
	for insertAt > 0 {
		selection := state.trace.Events[insertAt-1]
		if selection.ChannelID != channelID || (selection.State != "active" && selection.State != "affinity_hit") {
			break
		}
		insertAt--
	}
	if insertAt < len(state.trace.Events) {
		event.Timestamp = state.trace.Events[insertAt].Timestamp
	}
	state.trace.Events = append(state.trace.Events, ChannelExecutionEvent{})
	copy(state.trace.Events[insertAt+1:], state.trace.Events[insertAt:])
	state.trace.Events[insertAt] = event
	for index := range state.trace.Events {
		state.trace.Events[index].Sequence = index + 1
	}
	state.trace.UpdatedAt = now
	updateChannelExecutionRouteGroupStatuses(&state.trace)
	state.revision++
	if channelExecutionTraceUsesRedis() {
		scheduleChannelExecutionTracePublishLocked(state, channelExecutionPublishDebounce)
		state.mu.Unlock()
		return
	}
	state.mu.Unlock()
	publishChannelExecutionTraceSnapshot(state, true)
}

func RecordChannelExecutionFinalOutcome(
	c *gin.Context,
	originalStatusCode int,
	originalMessage string,
	userStatusCode int,
	userMessage string,
	customErrorApplied bool,
) {
	state, ok := channelExecutionTraceStateFromContext(c)
	if !ok {
		return
	}

	state.mu.Lock()
	state.trace.OriginalFinalError = &ChannelExecutionFinalError{
		StatusCode: originalStatusCode,
		Message:    originalMessage,
	}
	state.trace.UserVisibleError = &ChannelExecutionFinalError{
		StatusCode: userStatusCode,
		Message:    userMessage,
	}
	state.trace.CustomErrorApplied = customErrorApplied
	state.trace.UpdatedAt = time.Now().UnixMilli()
	state.revision++
	terminal := state.trace.Status != "running"
	if !terminal && channelExecutionTraceUsesRedis() {
		scheduleChannelExecutionTracePublishLocked(state, channelExecutionPublishDebounce)
		state.mu.Unlock()
		return
	}
	state.mu.Unlock()

	if terminal {
		publishChannelExecutionTrace(state)
		return
	}
	publishChannelExecutionTraceSnapshot(state, true)
}

func MarkChannelExecutionSuccess(c *gin.Context) {
	state, ok := channelExecutionTraceStateFromContext(c)
	if !ok {
		return
	}
	state.mu.Lock()
	if state.trace.Status != "running" {
		state.mu.Unlock()
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
	updateChannelExecutionRouteGroupStatuses(&state.trace)
	state.revision++
	state.mu.Unlock()
	publishChannelExecutionTrace(state)
}

func MarkChannelExecutionFailed(c *gin.Context, reason string) {
	state, ok := channelExecutionTraceStateFromContext(c)
	if !ok {
		return
	}
	state.mu.Lock()
	if state.trace.Status != "running" {
		state.mu.Unlock()
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
	updateChannelExecutionRouteGroupStatuses(&state.trace)
	state.revision++
	state.mu.Unlock()
	publishChannelExecutionTrace(state)
}

func FinalizeChannelExecutionTrace(c *gin.Context) {
	state, ok := channelExecutionTraceStateFromContext(c)
	if !ok {
		return
	}
	state.mu.Lock()
	if state.trace.Status != "running" {
		state.mu.Unlock()
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
	updateChannelExecutionRouteGroupStatuses(&state.trace)
	state.revision++
	state.mu.Unlock()
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
	snapshot.RouteGroups = append([]string(nil), state.trace.RouteGroups...)
	snapshot.RouteGroupStatuses = append([]ChannelExecutionRouteGroupStatus(nil), state.trace.RouteGroupStatuses...)
	state.mu.Unlock()
	if errorSnapshot && snapshot.Status == "running" {
		snapshot.Status = "failed"
	}
	updateChannelExecutionRouteGroupStatuses(&snapshot)
	if snapshot.Status == "success" {
		channelIDs := make([]int, 0, 1)
		channelName := ""
		var channelPriority *int64
		affinityHit := false
		persistFullTrace := false
		for _, event := range snapshot.Events {
			switch event.State {
			case "affinity_hit":
				affinityHit = true
			case "active":
				if event.ChannelID > 0 {
					channelIDs = append(channelIDs, event.ChannelID)
					channelName = event.ChannelName
					priority := event.Priority
					channelPriority = &priority
				}
			case "success":
			default:
				// Retries, failures, cooldowns, skipped candidates and other
				// decisions carry diagnostic information that must be retained.
				persistFullTrace = true
			}
		}
		if len(channelIDs) != 1 {
			persistFullTrace = true
		}
		if !persistFullTrace {
			adminInfo["channel_execution_trace"] = ChannelExecutionTraceSummary{
				Compact:            true,
				Mode:               snapshot.Mode,
				Status:             snapshot.Status,
				Group:              snapshot.Group,
				RouteGroups:        append([]string(nil), snapshot.RouteGroups...),
				RouteGroupStatuses: append([]ChannelExecutionRouteGroupStatus(nil), snapshot.RouteGroupStatuses...),
				StartedAt:          snapshot.StartedAt,
				UpdatedAt:          snapshot.UpdatedAt,
				ChannelIDs:         channelIDs,
				ChannelName:        channelName,
				Priority:           channelPriority,
				AffinityHit:        affinityHit,
			}
			return
		}
	}
	// Persist complex success and all failure timelines so their diagnostic
	// detail survives cross-instance reads and Redis expiry.
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
	fallback, fallbackFound := getChannelExecutionTraceFallback(requestID)
	trace, cacheFound, cacheErr := getChannelExecutionTraceCache().Get(requestID)
	best := ChannelExecutionTrace{}
	bestFound := false
	if cacheFound {
		best = trace
		bestFound = true
	}
	if fallbackFound {
		if !bestFound {
			best = fallback
		} else {
			best = newerChannelExecutionTrace(best, fallback)
		}
		bestFound = true
	}
	if bestFound && isChannelExecutionTraceTerminal(best) {
		return best, true, nil
	}
	if cacheErr != nil && fallbackFound {
		return fallback, true, nil
	}
	persisted, exists, persistedErr := getPersistedChannelExecutionTrace(requestID, time.Now().Add(-channelExecutionTraceTTL).UnixMilli())
	if persistedErr != nil {
		if bestFound {
			return best, true, nil
		}
		if cacheErr != nil {
			return ChannelExecutionTrace{}, false, cacheErr
		}
		return ChannelExecutionTrace{}, false, persistedErr
	}
	if exists {
		if !bestFound {
			return persisted, true, nil
		}
		return newerChannelExecutionTrace(best, persisted), true, nil
	}
	if bestFound {
		return best, true, nil
	}
	return ChannelExecutionTrace{}, false, nil
}
