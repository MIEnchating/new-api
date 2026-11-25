package qqbot

import (
	"context"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
)

const (
	discoveredGroupTTL  = 24 * time.Hour
	maxDiscoveredGroups = 50
)

type discoveredGroup struct {
	appID, openID string
	seenAt        time.Time
}

type groupDiscovery struct {
	mu     sync.Mutex
	groups []discoveredGroup
}

func (b *Bot) groupDiscoveryKey() string { return "qqbot:discovered-groups:" + b.appID }

func (b *Bot) discoverGroup(ctx context.Context, openID string, now time.Time) error {
	if b.redis != nil {
		key := b.groupDiscoveryKey()
		_, err := b.redis.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			pipe.ZAdd(ctx, key, &redis.Z{Score: float64(now.UnixMilli()), Member: openID})
			pipe.ZRemRangeByRank(ctx, key, 0, -maxDiscoveredGroups-1)
			pipe.Expire(ctx, key, discoveredGroupTTL)
			return nil
		})
		return err
	}
	b.discovery.mu.Lock()
	defer b.discovery.mu.Unlock()
	groups := slices.DeleteFunc(b.discovery.groups, func(group discoveredGroup) bool {
		return (group.appID == b.appID && group.openID == openID) ||
			!group.seenAt.After(now.Add(-discoveredGroupTTL))
	})
	if len(groups) == maxDiscoveredGroups {
		groups = slices.Delete(groups, 0, 1)
	}
	b.discovery.groups = append(groups, discoveredGroup{appID: b.appID, openID: openID, seenAt: now})
	return nil
}

// DiscoveredGroups lists groups seen by the configured bot that are waiting for
// an administrator to add them to the allowlist.
func (r *Runtime) DiscoveredGroups(ctx context.Context) ([]string, error) {
	bot := r.currentBot()
	if bot == nil {
		return []string{}, nil
	}
	return bot.discoveredGroups(ctx)
}

func (b *Bot) discoveredGroups(ctx context.Context) ([]string, error) {
	cutoff := b.now().Add(-discoveredGroupTTL)
	groups := make([]string, 0)
	if b.redis != nil {
		recent, err := b.redis.ZRevRangeByScore(ctx, b.groupDiscoveryKey(), &redis.ZRangeBy{
			Min: "(" + strconv.FormatInt(cutoff.UnixMilli(), 10), Max: "+inf", Count: maxDiscoveredGroups,
		}).Result()
		if err != nil {
			return nil, err
		}
		for _, openID := range recent {
			if _, allowed := b.groups[openID]; !allowed && groupOpenID.MatchString(openID) {
				groups = append(groups, openID)
			}
		}
		return groups, nil
	}
	b.discovery.mu.Lock()
	defer b.discovery.mu.Unlock()
	for _, group := range slices.Backward(b.discovery.groups) {
		if _, allowed := b.groups[group.openID]; !allowed && group.appID == b.appID && group.seenAt.After(cutoff) {
			groups = append(groups, group.openID)
		}
	}
	return groups, nil
}
