package perf_metrics_setting

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDefaultCacheHitRateBaseline(t *testing.T) {
	require.Equal(t, 85, GetCacheHitRateBaseline())
	require.Empty(t, GetCacheMonitorGroups())
}
