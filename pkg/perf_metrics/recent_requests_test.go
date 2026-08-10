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
