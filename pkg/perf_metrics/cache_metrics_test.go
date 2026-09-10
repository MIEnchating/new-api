package perfmetrics

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAtomicBucketTracksOnlyCacheEligibleRequests(t *testing.T) {
	bucket := &atomicBucket{}
	bucket.add(Sample{CacheEligible: false, CachedTokens: 100})
	bucket.add(Sample{CacheEligible: true})
	bucket.add(Sample{CacheEligible: true, CachedTokens: 40})

	snapshot := bucket.snapshot()
	assert.EqualValues(t, 2, snapshot.cacheRequests)
	assert.EqualValues(t, 1, snapshot.cacheHits)
	assert.EqualValues(t, 40, snapshot.cachedTokens)
}

func TestBuildCacheQueryResultAggregatesModelsByGroup(t *testing.T) {
	result := buildCacheQueryResult(map[string]map[int64]counters{
		"default": {
			100: {requestCount: 2, outputTokens: 30, generationMs: 1_000, cacheRequests: 2, cacheHits: 1, cachedTokens: 30},
			200: {requestCount: 1, outputTokens: 30, generationMs: 1_000, cacheRequests: 1, cacheHits: 1, cachedTokens: 20},
		},
		"vip": {
			100: {cacheRequests: 1, cachedTokens: 0},
		},
	})

	require.Len(t, result.Groups, 2)
	assert.Equal(t, "default", result.Groups[0].Group)
	assert.EqualValues(t, 3, result.Groups[0].RequestCount)
	assert.EqualValues(t, 2, result.Groups[0].HitCount)
	assert.EqualValues(t, 50, result.Groups[0].CachedTokens)
	assert.Equal(t, 66.67, result.Groups[0].CacheHitRate)
	assert.Equal(t, 30.0, result.Groups[0].AvgTps)
	require.Len(t, result.Groups[0].Series, 2)
	assert.Equal(t, 30.0, result.Groups[0].Series[0].AvgTps)

	assert.EqualValues(t, 1, result.Groups[1].RequestCount)
	assert.EqualValues(t, 0, result.Groups[1].HitCount)
	assert.Equal(t, 0.0, result.Groups[1].CacheHitRate)
}

func TestCacheHitRateUsesTokenRatioWhenAvailable(t *testing.T) {
	result := buildCacheQueryResult(map[string]map[int64]counters{
		"default": {
			100: {
				requestCount:          100,
				cacheRequests:         100,
				cacheHits:             94,
				cachedTokens:          79,
				cacheTokenReadTokens:  79,
				cacheTokenDenominator: 100,
			},
		},
	})

	require.Len(t, result.Groups, 1)
	assert.Equal(t, 79.0, result.Groups[0].CacheHitRate)
}

func TestCacheGroupsMergeModelBucketsWithoutLosingTokenWeights(t *testing.T) {
	buckets := map[string]map[int64]counters{}
	mergeCacheGroupBucket(buckets, "default", 3600, counters{
		requestCount: 40, successCount: 38, ttftCount: 30, ttftSumMs: 90000, cacheRequests: 2, cacheHits: 1,
		cachedTokens: 30, cacheTokenReadTokens: 30, cacheTokenDenominator: 100,
		outputTokens: 20, generationMs: 1000,
	})
	mergeCacheGroupBucket(buckets, "default", 3600, counters{
		requestCount: 60, successCount: 52, ttftCount: 50, ttftSumMs: 250000, cacheRequests: 1, cacheHits: 1,
		cachedTokens: 70, cacheTokenReadTokens: 70, cacheTokenDenominator: 100,
		outputTokens: 40, generationMs: 1000,
	})
	result := buildCacheQueryResult(buckets)
	require.Len(t, result.Groups, 1)
	assert.EqualValues(t, 3, result.Groups[0].RequestCount)
	assert.EqualValues(t, 2, result.Groups[0].HitCount)
	assert.EqualValues(t, 100, result.Groups[0].CachedTokens)
	assert.Equal(t, 50.0, result.Groups[0].CacheHitRate)
	assert.Equal(t, 30.0, result.Groups[0].AvgTps)
	require.Len(t, result.Groups[0].Series, 1)
	assert.Equal(t, 50.0, result.Groups[0].Series[0].CacheHitRate)
	require.NotNil(t, result.Groups[0].Health.ErrorRatePercent)
	require.NotNil(t, result.Groups[0].Health.AvgTTFTMs)
	assert.Equal(t, float64(10), *result.Groups[0].Health.ErrorRatePercent)
	assert.Equal(t, float64(4250), *result.Groups[0].Health.AvgTTFTMs)
	assert.Equal(t, result.Groups[0].Health, result.Groups[0].Series[0].Health)
}

func TestMonitorHealthThresholdsAndSampleGating(t *testing.T) {
	thresholds := perf_metrics_setting.GetHealthThresholds()
	for _, tc := range []struct {
		name                                        string
		sample                                      counters
		wantOverall, wantError, wantTTFT, wantCache string
		wantScore                                   float64
	}{
		{"insufficient samples", counters{requestCount: 49, successCount: 49, ttftCount: 49, cacheRequests: 49}, "unknown", "unknown", "unknown", "unknown", -1},
		{"all signals healthy", counters{requestCount: 50, successCount: 50, ttftCount: 50, ttftSumMs: 150000, cacheRequests: 50, cacheHits: 50}, "healthy", "healthy", "healthy", "healthy", 100},
		{"threshold boundaries", counters{requestCount: 100, successCount: 95, ttftCount: 100, ttftSumMs: 800000, cacheRequests: 100, cacheHits: 60}, "warning", "warning", "warning", "warning", 71.12},
		{"critical errors without cache or latency", counters{requestCount: 100, successCount: 80}, "critical", "critical", "unknown", "unknown", 0},
		{"cache below critical", counters{cacheRequests: 100, cacheHits: 59}, "warning", "unknown", "unknown", "critical", 59},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := monitorHealth(tc.sample, thresholds)
			assert.Equal(t, tc.wantOverall, result.Overall)
			assert.Equal(t, tc.wantError, result.ErrorRate)
			assert.Equal(t, tc.wantTTFT, result.TTFT)
			assert.Equal(t, tc.wantCache, result.Cache)
			if tc.wantScore < 0 {
				assert.Nil(t, result.Score)
			} else {
				require.NotNil(t, result.Score)
				assert.Equal(t, tc.wantScore, *result.Score)
			}
		})
	}
	thresholds.MinimumSample = 1
	thresholds.TargetTTFTMs = 1000
	thresholds.WarningTTFTMs = 2000
	thresholds.CriticalTTFTMs = 4000
	result := monitorHealth(counters{ttftCount: 1, ttftSumMs: 2500}, thresholds)
	assert.Equal(t, "warning", result.TTFT)
	require.NotNil(t, result.Score)
	assert.Equal(t, float64(50), *result.Score)
	thresholds.WarningCacheRate, thresholds.CriticalCacheRate = 0, 0
	result = monitorHealth(counters{cacheRequests: 1}, thresholds)
	assert.Equal(t, "healthy", result.Cache)
	assert.Equal(t, float64(100), *result.Score)
}

func TestMonitorSummaryWeightsSignalsAcrossDisplayedGroups(t *testing.T) {
	result := buildCacheQueryResult(map[string]map[int64]counters{
		"small": {100: {requestCount: 10, successCount: 5, ttftCount: 10, ttftSumMs: 10000, cacheRequests: 10, cacheTokenReadTokens: 90, cacheTokenDenominator: 100}},
		"large": {100: {requestCount: 90, successCount: 90, ttftCount: 30, ttftSumMs: 150000, cacheRequests: 90, cacheTokenReadTokens: 90, cacheTokenDenominator: 900}},
	})
	require.NotNil(t, result.Summary.Health.ErrorRatePercent)
	assert.Equal(t, float64(5), *result.Summary.Health.ErrorRatePercent)
	require.NotNil(t, result.Summary.Health.AvgTTFTMs)
	assert.Equal(t, float64(4000), *result.Summary.Health.AvgTTFTMs)
	assert.Equal(t, "unknown", result.Summary.Health.TTFT)
	assert.Equal(t, float64(18), result.Summary.CacheHitRate)
	assert.True(t, result.Summary.HasData)
	require.Len(t, result.Summary.Series, 1)
	assert.Equal(t, int64(100), result.Summary.Series[0].Ts)
	assert.Equal(t, result.Summary.Health, result.Summary.Series[0].Health)
	assert.Equal(t, float64(18), result.Summary.Series[0].CacheHitRate)
	assert.True(t, result.Summary.Series[0].HasData)
	// Insufficient samples affect assessment, not the measured values.
	assert.Equal(t, "unknown", result.Groups[1].Health.ErrorRate)
	assert.Equal(t, float64(50), *result.Groups[1].Health.ErrorRatePercent)
	empty := buildCacheQueryResult(nil)
	assert.Nil(t, empty.Summary.Health.Score)
	assert.Nil(t, empty.Summary.Health.ErrorRatePercent)
	assert.Nil(t, empty.Summary.Health.AvgTTFTMs)
	assert.False(t, empty.Summary.HasData)
	assert.Empty(t, empty.Summary.Series)
}
