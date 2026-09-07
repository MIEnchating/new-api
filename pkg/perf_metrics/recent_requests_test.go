package perfmetrics

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

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
