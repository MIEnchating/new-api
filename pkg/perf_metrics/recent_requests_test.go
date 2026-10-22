package perfmetrics

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRecentRequestStatusUsesFinalResultsAndSeparateWindows(t *testing.T) {
	const now int64 = 10000
	stats := buildRecentRequestStatus([]model.RelayRequestSample{
		{CreatedAt: now, RequestId: "same", Type: model.LogTypeConsume, UseTime: 2, Group: "a"},
		{CreatedAt: now - 1, RequestId: "same", Type: model.LogTypeError, UseTime: 10, Group: "b"},
		{CreatedAt: now - 300, RequestId: "failure", Type: model.LogTypeError, UseTime: 4, Group: "a"},
		{CreatedAt: now - 1800, RequestId: "older", Type: model.LogTypeConsume, UseTime: 6, Group: "a"},
		{CreatedAt: now - 3600, RequestId: "oldest", Type: model.LogTypeConsume, UseTime: 8},
	}, now)
	assert.Equal(t, RequestWindowStats{RequestCount: 2, SuccessCount: 1, FailureCount: 1, SuccessRate: 50, AvgLatencyMs: 3000, LastRequestAt: now, HasData: true}, stats.FiveMinutes)
	assert.EqualValues(t, 3, stats.ThirtyMinutes.RequestCount)
	assert.InDelta(t, 200.0/3, stats.ThirtyMinutes.SuccessRate, 0.0001)
	assert.EqualValues(t, 4, stats.OneHour.RequestCount)
	assert.Equal(t, float64(5000), stats.OneHour.AvgLatencyMs)
	assert.NotContains(t, stats.ByGroup, "b")
	assert.False(t, stats.ByGroup["default"].FiveMinutes.HasData)
	assert.True(t, stats.ByGroup["default"].OneHour.HasData)
	require.Len(t, stats.ByGroup["a"].Samples, 3)
	assert.Equal(t, RequestSample{Time: now, LatencyMs: 2000, Success: true}, stats.ByGroup["a"].Samples[0])
	assert.Empty(t, buildRecentRequestStatus(nil, now).ByGroup)
}

func TestBuildRequestWindowStats(t *testing.T) {
	assert.Equal(
		t,
		RequestWindowStats{RequestCount: 6, SuccessCount: 5, FailureCount: 1, SuccessRate: 83.33, AvgLatencyMs: 1500, LastRequestAt: 42, HasData: true},
		buildRequestWindowStats(6, 5, 1.5, 42),
	)
	assert.Equal(t, RequestWindowStats{}, buildRequestWindowStats(0, 0, 0, 0))
}

func TestRecentSuccessSeriesAggregatesHoursByRequestCount(t *testing.T) {
	assert.Equal(t, []SuccessRatePoint{
		{Ts: 3600, SuccessRate: 75},
		{Ts: 10800, SuccessRate: 33.33},
	}, recentSuccessSeries(map[int64]counters{
		3600:  {requestCount: 1, successCount: 0},
		3900:  {requestCount: 3, successCount: 3},
		7200:  {},
		11100: {requestCount: 3, successCount: 1},
	}))
	assert.Empty(t, recentSuccessSeries(nil))
	assert.Empty(t, recentSuccessSeries(map[int64]counters{3600: {}}))
}
