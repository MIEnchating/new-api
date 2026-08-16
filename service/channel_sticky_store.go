package service

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/cachex"

	"github.com/samber/hot"
)

type stickyChannelStoreConfig struct {
	Namespace  string
	Capacity   int
	DefaultTTL time.Duration
}

type stickyChannelStore struct {
	cache *cachex.HybridCache[int]
}

func newStickyChannelStore(config stickyChannelStoreConfig) *stickyChannelStore {
	capacity := config.Capacity
	if capacity <= 0 {
		capacity = 100_000
	}

	return &stickyChannelStore{
		cache: cachex.NewHybridCache[int](cachex.HybridCacheConfig[int]{
			Namespace: cachex.Namespace(config.Namespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.IntCodec{},
			Memory: func() *hot.HotCache[string, int] {
				builder := hot.NewHotCache[string, int](hot.LRU, capacity)
				if config.DefaultTTL > 0 {
					return builder.WithTTL(config.DefaultTTL).WithJanitor().Build()
				}
				return builder.Build()
			},
		}),
	}
}

func (s *stickyChannelStore) Get(key string) (int, bool, error) {
	channelID, found, err := s.cache.Get(key)
	if err != nil {
		return 0, false, err
	}
	if !found || channelID <= 0 {
		if found {
			_, _ = s.DeleteMany([]string{key})
		}
		return 0, false, nil
	}
	return channelID, true, nil
}

func (s *stickyChannelStore) SetWithTTL(key string, channelID int, ttl time.Duration) error {
	if channelID <= 0 {
		return fmt.Errorf("invalid channel ID")
	}
	return s.cache.SetWithTTL(key, channelID, ttl)
}

func (s *stickyChannelStore) Keys() ([]string, error) {
	return s.cache.Keys()
}

func (s *stickyChannelStore) DeleteMany(keys []string) (map[string]bool, error) {
	return s.cache.DeleteMany(keys)
}

func (s *stickyChannelStore) DeleteByPrefix(prefix string) (int, error) {
	return s.cache.DeleteByPrefix(prefix)
}

func (s *stickyChannelStore) Capacity() (int, int) {
	return s.cache.Capacity()
}

func (s *stickyChannelStore) Algorithm() (string, string) {
	return s.cache.Algorithm()
}

func (s *stickyChannelStore) ClearAll() (int, error) {
	keys, err := s.Keys()
	if err != nil {
		return 0, err
	}
	deleted, err := s.DeleteMany(keys)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, ok := range deleted {
		if ok {
			count++
		}
	}
	return count, nil
}
