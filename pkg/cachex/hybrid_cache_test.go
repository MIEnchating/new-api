package cachex

import (
	"testing"
	"time"

	"github.com/samber/hot"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHybridCacheGetManyAcceptsRawAndNamespacedKeys(t *testing.T) {
	cache := NewHybridCache[int](HybridCacheConfig[int]{
		Namespace: "test:affinity",
		Memory: func() *hot.HotCache[string, int] {
			return hot.NewHotCache[string, int](hot.LRU, 10).Build()
		},
	})

	require.NoError(t, cache.SetWithTTL("first", 11, time.Minute))
	require.NoError(t, cache.SetWithTTL("second", 22, time.Minute))

	values, err := cache.GetMany([]string{"first", "test:affinity:second", "missing"})
	require.NoError(t, err)
	assert.Equal(t, map[string]int{
		"test:affinity:first":  11,
		"test:affinity:second": 22,
	}, values)
}
