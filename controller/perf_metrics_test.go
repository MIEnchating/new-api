package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
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
	score := 90.0
	result := perfmetrics.CacheQueryResult{Groups: []perfmetrics.CacheGroupResult{{
		Group:        "default",
		Health:       perfmetrics.MonitorHealth{Overall: "healthy", Cache: "warning", Score: &score},
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

	assert.Equal(t, "healthy", result.Groups[0].Health.Overall)
	assert.Equal(t, &score, result.Groups[0].Health.Score)
	assert.Zero(t, result.Groups[0].RequestCount)
	assert.Zero(t, result.Groups[0].HitCount)
	assert.Equal(t, float64(75), result.Groups[0].CacheHitRate)
	assert.True(t, result.Groups[0].HasData)
	assert.Zero(t, result.Groups[0].Series[0].RequestCount)
	assert.Zero(t, result.Groups[0].Series[0].HitCount)
	assert.True(t, result.Groups[0].Series[0].HasData)
}

func TestUpdateMonitorHealthThresholdsRejectsInvalidValues(t *testing.T) {
	defaults := perf_metrics_setting.GetHealthThresholds()
	for _, tc := range []struct {
		name   string
		change func(*perf_metrics_setting.HealthThresholds)
	}{
		{"zero sample", func(h *perf_metrics_setting.HealthThresholds) { h.MinimumSample = 0 }},
		{"oversized sample", func(h *perf_metrics_setting.HealthThresholds) { h.MinimumSample = 1000001 }},
		{"reversed error bands", func(h *perf_metrics_setting.HealthThresholds) { h.WarningErrorRate = h.CriticalErrorRate }},
		{"percentage outside range", func(h *perf_metrics_setting.HealthThresholds) { h.WarningCacheRate = 101 }},
		{"reversed cache bands", func(h *perf_metrics_setting.HealthThresholds) { h.CriticalCacheRate = 90 }},
		{"target above warning", func(h *perf_metrics_setting.HealthThresholds) { h.TargetTTFTMs = 9000 }},
		{"warning at critical", func(h *perf_metrics_setting.HealthThresholds) { h.WarningTTFTMs = h.CriticalTTFTMs }},
		{"oversized latency", func(h *perf_metrics_setting.HealthThresholds) { h.CriticalTTFTMs = 3600001 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := defaults
			tc.change(&h)
			body, err := common.Marshal(h)
			require.NoError(t, err)
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodPut, "/api/status-monitor/cache/health-thresholds", strings.NewReader(string(body)))
			UpdateMonitorHealthThresholds(ctx)
			assert.Contains(t, recorder.Body.String(), `"success":false`)
			assert.Equal(t, defaults, perf_metrics_setting.GetHealthThresholds())
		})
	}
}
