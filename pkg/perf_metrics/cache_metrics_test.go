package perfmetrics

import (
	"testing"

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
			100: {cacheRequests: 2, cacheHits: 1, cachedTokens: 30},
			200: {cacheRequests: 1, cacheHits: 1, cachedTokens: 20},
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
	require.Len(t, result.Groups[0].Series, 2)

	assert.EqualValues(t, 4, result.Total.RequestCount)
	assert.EqualValues(t, 2, result.Total.HitCount)
	assert.EqualValues(t, 50, result.Total.CachedTokens)
	assert.Equal(t, 50.0, result.Total.CacheHitRate)
}
