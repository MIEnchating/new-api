package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChannelExecutionTraceMergePrefersLatestAndTerminalTie(t *testing.T) {
	running := ChannelExecutionTrace{
		RequestID: "merge-latest-trace",
		Status:    "running",
		UpdatedAt: 100,
	}
	terminal := ChannelExecutionTrace{
		RequestID: "merge-latest-trace",
		Status:    "success",
		UpdatedAt: 101,
	}

	merged := mergeChannelExecutionTraces(10, []ChannelExecutionTrace{running}, []ChannelExecutionTrace{terminal})
	require.Len(t, merged, 1)
	assert.Equal(t, "success", merged[0].Status)

	running.UpdatedAt = terminal.UpdatedAt
	merged = mergeChannelExecutionTraces(10, []ChannelExecutionTrace{running}, []ChannelExecutionTrace{terminal})
	require.Len(t, merged, 1)
	assert.Equal(t, "success", merged[0].Status, "terminal state must win an equal-millisecond tie")

	running.UpdatedAt = terminal.UpdatedAt + 1
	merged = mergeChannelExecutionTraces(10, []ChannelExecutionTrace{terminal}, []ChannelExecutionTrace{running})
	require.Len(t, merged, 1)
	assert.Equal(t, "running", merged[0].Status, "UpdatedAt remains authoritative across sources")
}

func TestGetChannelExecutionTraceDoesNotLetStaleRunningCacheHideFallbackTerminal(t *testing.T) {
	setupChannelRouteTest(t)
	requestID := "stale-running-cache"
	now := time.Now().UnixMilli()
	require.NoError(t, getChannelExecutionTraceCache().SetWithTTL(requestID, ChannelExecutionTrace{
		RequestID: requestID,
		Group:     "default",
		Status:    "running",
		UpdatedAt: now,
	}, channelExecutionTraceTTL))
	rememberChannelExecutionTraceFallback(ChannelExecutionTrace{
		RequestID: requestID,
		Group:     "default",
		Status:    "failed",
		UpdatedAt: now + 1,
	})

	trace, found, err := GetChannelExecutionTrace(requestID)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, "failed", trace.Status)
	assert.Equal(t, now+1, trace.UpdatedAt)
}

func TestChannelExecutionFallbackDeleteDoesNotLeaveOrderTombstones(t *testing.T) {
	setupChannelRouteTest(t)
	now := time.Now().UnixMilli()
	for index := 0; index < channelExecutionFallbackSize*2; index++ {
		requestID := "fallback-delete-reinsert"
		rememberChannelExecutionTraceFallback(ChannelExecutionTrace{
			RequestID: requestID,
			Status:    "failed",
			UpdatedAt: now + int64(index),
		})
		forgetChannelExecutionTraceFallback(requestID)
	}

	channelExecutionRecentMu.Lock()
	defer channelExecutionRecentMu.Unlock()
	assert.Empty(t, channelExecutionFallback)
	assert.Zero(t, channelExecutionFallbackOrder.Len())
}

func TestChannelExecutionTerminalSurvivesInputQueueSaturationAndCanBeRetried(t *testing.T) {
	setupChannelRouteTest(t)
	requestID := "terminal-queue-saturation"
	now := time.Now()
	state := &channelExecutionTraceState{
		indexedKeys: make(map[string]struct{}),
		revision:    1,
		trace: ChannelExecutionTrace{
			RequestID: requestID,
			Group:     "default",
			Status:    "success",
			UpdatedAt: now.UnixMilli(),
		},
	}
	input := make(chan channelExecutionPublishRequest, 1)
	input <- channelExecutionPublishRequest{}

	state.mu.Lock()
	queued := scheduleChannelExecutionTracePublishToLocked(state, 0, input)
	state.mu.Unlock()
	assert.False(t, queued)
	assert.Equal(t, uint64(1), GetChannelExecutionPublishStats().InputQueueSaturation)

	fallback, found := getChannelExecutionTraceFallback(requestID)
	require.True(t, found)
	assert.Equal(t, "success", fallback.Status)
	channelExecutionRecentMu.Lock()
	require.Contains(t, channelExecutionFallback, requestID)
	channelExecutionFallback[requestID].nextRecoveryAt = now.Add(-time.Millisecond)
	channelExecutionRecentMu.Unlock()

	<-input
	queuedCount := retryChannelExecutionTerminalFallbacksWithScheduler(time.Now(), func(state *channelExecutionTraceState) bool {
		return scheduleChannelExecutionTracePublishToLocked(state, 0, input)
	})
	assert.Equal(t, 1, queuedCount)
	select {
	case request := <-input:
		assert.Same(t, state, request.state)
	default:
		t.Fatal("terminal fallback was not re-enqueued after queue capacity recovered")
	}
	stats := GetChannelExecutionPublishStats()
	assert.Equal(t, uint64(1), stats.TerminalRetryAttempts)
	assert.Equal(t, uint64(1), stats.TerminalRetryQueued)
}
