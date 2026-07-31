package perfmetrics

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestBuildRequestWindowStats(t *testing.T) {
	assert.Equal(
		t,
		RequestWindowStats{RequestCount: 6, SuccessCount: 5, SuccessRate: 83.33, HasData: true},
		buildRequestWindowStats(6, 5),
	)
	assert.Equal(t, RequestWindowStats{}, buildRequestWindowStats(0, 0))
}
