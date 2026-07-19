package service

import (
	"fmt"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/cachex"

	"github.com/samber/hot"
)

const (
	tokenGroupRouteStickyNamespace = "token_group_route_sticky"
	tokenGroupRouteStickyCapacity  = 100_000
)

var tokenGroupRouteStickyStoreOnce sync.Once
var tokenGroupRouteStickyStore *tokenGroupStickyStore

type tokenGroupStickyStore struct {
	cache *cachex.HybridCache[string]
}

func newTokenGroupStickyStore(capacity int) *tokenGroupStickyStore {
	if capacity <= 0 {
		capacity = tokenGroupRouteStickyCapacity
	}
	return &tokenGroupStickyStore{
		cache: cachex.NewHybridCache[string](cachex.HybridCacheConfig[string]{
			Namespace: cachex.Namespace(tokenGroupRouteStickyNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.StringCodec{},
			Memory: func() *hot.HotCache[string, string] {
				return hot.NewHotCache[string, string](hot.LRU, capacity).Build()
			},
		}),
	}
}

func getTokenGroupRouteStickyStore() *tokenGroupStickyStore {
	tokenGroupRouteStickyStoreOnce.Do(func() {
		tokenGroupRouteStickyStore = newTokenGroupStickyStore(tokenGroupRouteStickyCapacity)
	})
	return tokenGroupRouteStickyStore
}

func (s *tokenGroupStickyStore) Get(key string) (string, bool, error) {
	group, found, err := s.cache.Get(key)
	if err != nil {
		return "", false, err
	}
	if !found || group == "" {
		if found {
			_, _ = s.Delete(key)
		}
		return "", false, nil
	}
	return group, true, nil
}

func (s *tokenGroupStickyStore) Set(key string, group string) error {
	if group == "" {
		return fmt.Errorf("empty group")
	}
	// A zero TTL deliberately preserves affinity until failure or manual cleanup.
	return s.cache.SetWithTTL(key, group, 0)
}

func (s *tokenGroupStickyStore) Delete(key string) (bool, error) {
	deleted, err := s.cache.DeleteMany([]string{key})
	if err != nil {
		return false, err
	}
	return deleted[s.cache.FullKey(key)], nil
}

func (s *tokenGroupStickyStore) DeleteByToken(tokenID int) (int, error) {
	if tokenID <= 0 {
		return 0, fmt.Errorf("invalid token ID")
	}
	return s.cache.DeleteByPrefix(fmt.Sprintf("%s:%d", tokenGroupRouteStickyNamespace, tokenID))
}
