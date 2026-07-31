package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateCacheHitRateBaseline(t *testing.T) {
	for _, baseline := range []int{0, 85, 100} {
		require.NoError(t, validateCacheHitRateBaseline(baseline))
	}
	for _, baseline := range []int{-1, 101} {
		require.Error(t, validateCacheHitRateBaseline(baseline))
	}
}

func TestUpdateCacheHitRateBaselineRequiresValue(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/status-monitor/cache/baseline",
		strings.NewReader(`{}`),
	)

	UpdateCacheHitRateBaseline(ctx)

	require.Contains(t, recorder.Body.String(), `"success":false`)
	require.Contains(t, recorder.Body.String(), "无效的参数")
}

func TestResolveCacheMonitorGroups(t *testing.T) {
	available := []string{"auto", "default", "vip"}
	require.Equal(t, available, resolveCacheMonitorGroups(available, nil))
	require.Equal(t, []string{"vip", "default"}, resolveCacheMonitorGroups(available, []string{"vip", "missing", "default", "vip"}))
}

func TestNormalizeCacheMonitorGroups(t *testing.T) {
	available := []string{"auto", "default", "vip"}

	groups, err := normalizeCacheMonitorGroups(updateCacheMonitorGroupsRequest{AllGroups: true}, available)
	require.NoError(t, err)
	require.Empty(t, groups)

	groups, err = normalizeCacheMonitorGroups(updateCacheMonitorGroupsRequest{Groups: []string{"vip", "default"}}, available)
	require.NoError(t, err)
	require.Equal(t, []string{"vip", "default"}, groups)

	_, err = normalizeCacheMonitorGroups(updateCacheMonitorGroupsRequest{Groups: []string{"missing"}}, available)
	require.Error(t, err)
}

func TestBuildCacheMonitorGroupsAuditParams(t *testing.T) {
	available := []string{"auto", "default", "vip"}

	selected := buildCacheMonitorGroupsAuditParams(available, nil, []string{"vip", "default"})
	require.Equal(t, false, selected["all_groups"])
	require.Equal(t, []string{"vip", "default"}, selected["display_groups"])
	require.Equal(t, 2, selected["group_count"])
	require.Equal(t, true, selected["previous_all_groups"])
	require.Equal(t, available, selected["previous_display_groups"])

	all := buildCacheMonitorGroupsAuditParams(available, []string{"vip", "default"}, nil)
	require.Equal(t, true, all["all_groups"])
	require.Equal(t, available, all["display_groups"])
	require.Equal(t, len(available), all["group_count"])
	require.Equal(t, false, all["previous_all_groups"])
	require.Equal(t, []string{"vip", "default"}, all["previous_display_groups"])
}

func TestHideCacheMetricCountsPreservesRatesAndDataState(t *testing.T) {
	result := perfmetrics.CacheQueryResult{Groups: []perfmetrics.CacheGroupResult{{
		Group:        "default",
		RequestCount: 20,
		HitCount:     15,
		CacheHitRate: 75,
		HasData:      true,
		Series: []perfmetrics.CacheBucketPoint{{
			RequestCount: 10,
			HitCount:     8,
			CacheHitRate: 80,
			HasData:      true,
		}},
	}}}

	hideCacheMetricCounts(&result)

	assert.Zero(t, result.Groups[0].RequestCount)
	assert.Zero(t, result.Groups[0].HitCount)
	assert.Equal(t, float64(75), result.Groups[0].CacheHitRate)
	assert.True(t, result.Groups[0].HasData)
	assert.Zero(t, result.Groups[0].Series[0].RequestCount)
	assert.Zero(t, result.Groups[0].Series[0].HitCount)
	assert.True(t, result.Groups[0].Series[0].HasData)
}
