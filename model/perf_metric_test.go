package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPerfMetricCacheColumnsUpsertAndGroupAggregation(t *testing.T) {
	require.True(t, DB.Migrator().HasColumn(&PerfMetric{}, "cache_requests"))
	require.True(t, DB.Migrator().HasColumn(&PerfMetric{}, "cache_hits"))
	require.True(t, DB.Migrator().HasColumn(&PerfMetric{}, "cached_tokens"))
	require.True(t, DB.Migrator().HasColumn(&PerfMetric{}, "cache_token_read_tokens"))
	require.True(t, DB.Migrator().HasColumn(&PerfMetric{}, "cache_token_denominator"))

	require.NoError(t, DB.Where("model_name LIKE ?", "cache-test-%").Delete(&PerfMetric{}).Error)
	t.Cleanup(func() {
		_ = DB.Where("model_name LIKE ?", "cache-test-%").Delete(&PerfMetric{}).Error
	})

	const bucketTs = int64(1_700_000_000)
	metrics := []*PerfMetric{
		{
			ModelName:     "cache-test-a",
			Group:         "default",
			BucketTs:      bucketTs,
			RequestCount:  1,
			OutputTokens:  20,
			GenerationMs:  1_000,
			CacheRequests: 1,
			CacheHits:     1,
			CachedTokens:  30,
		},
		{
			ModelName:     "cache-test-a",
			Group:         "default",
			BucketTs:      bucketTs,
			RequestCount:  1,
			OutputTokens:  10,
			GenerationMs:  1_000,
			CacheRequests: 1,
		},
		{
			ModelName:     "cache-test-b",
			Group:         "default",
			BucketTs:      bucketTs,
			RequestCount:  1,
			OutputTokens:  30,
			GenerationMs:  1_000,
			CacheRequests: 1,
			CacheHits:     1,
			CachedTokens:  20,
		},
		{
			ModelName:    "cache-test-throughput-only",
			Group:        "default",
			BucketTs:     bucketTs,
			RequestCount: 1,
			OutputTokens: 40,
			GenerationMs: 1_000,
		},
		{
			ModelName:     "cache-test-a",
			Group:         "vip",
			BucketTs:      bucketTs,
			RequestCount:  1,
			CacheRequests: 1,
			CacheHits:     1,
			CachedTokens:  10,
		},
	}
	for _, metric := range metrics {
		require.NoError(t, UpsertPerfMetric(metric))
	}

	rows, err := GetPerfMetricCacheBucketsAll(bucketTs, bucketTs, []string{"default"})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, "default", rows[0].Group)
	assert.EqualValues(t, 3, rows[0].CacheRequests)
	assert.EqualValues(t, 2, rows[0].CacheHits)
	assert.EqualValues(t, 50, rows[0].CachedTokens)
	assert.EqualValues(t, 4, rows[0].RequestCount)
	assert.EqualValues(t, 100, rows[0].OutputTokens)
	assert.EqualValues(t, 4_000, rows[0].GenerationMs)
}
