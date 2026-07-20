package model

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const userAuthStateInvalidationChannel = "new-api:user-auth-state:invalidate"

var userAuthStateCacheInstanceID = common.GetUUID()

var userAuthStateCacheSync = struct {
	sync.Mutex
	cancel context.CancelFunc
	done   chan struct{}
}{}

func notifyUserAuthStateChanged(userId int) {
	if userId <= 0 || common.UserAuthCacheTTLSeconds <= 0 || !common.RedisEnabled || common.RDB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	payload := userAuthStateCacheInstanceID + ":" + strconv.Itoa(userId)
	if err := common.RDB.Publish(ctx, userAuthStateInvalidationChannel, payload).Err(); err != nil {
		common.SysLog(fmt.Sprintf("failed to broadcast user auth cache invalidation for user %d: %v", userId, err))
	}
}

func handleUserAuthStateInvalidation(payload string) {
	source, rawUserId, ok := strings.Cut(strings.TrimSpace(payload), ":")
	if !ok || source == "" || source == userAuthStateCacheInstanceID {
		return
	}
	userId, err := strconv.Atoi(rawUserId)
	if err != nil || userId <= 0 {
		return
	}
	invalidateUserAuthStateCache(userId)
}

// StartUserAuthStateCacheSync propagates user status, role, group, and identity
// changes across application instances. The short local TTL remains the safety
// net when Redis pub/sub is temporarily unavailable.
func StartUserAuthStateCacheSync() {
	if common.UserAuthCacheTTLSeconds <= 0 || !common.RedisEnabled || common.RDB == nil {
		return
	}
	userAuthStateCacheSync.Lock()
	if userAuthStateCacheSync.cancel != nil {
		userAuthStateCacheSync.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	userAuthStateCacheSync.cancel = cancel
	userAuthStateCacheSync.done = done
	userAuthStateCacheSync.Unlock()

	go func() {
		defer close(done)
		for {
			if ctx.Err() != nil {
				return
			}
			pubsub := common.RDB.Subscribe(ctx, userAuthStateInvalidationChannel)
			receiveContext, receiveCancel := context.WithTimeout(ctx, 3*time.Second)
			_, err := pubsub.Receive(receiveContext)
			receiveCancel()
			if err != nil {
				_ = pubsub.Close()
				if ctx.Err() != nil {
					return
				}
				common.SysLog("failed to subscribe user auth cache invalidation channel: " + err.Error())
				if !waitForUserAuthStateCacheSyncRetry(ctx) {
					return
				}
				continue
			}

			messages := pubsub.Channel()
			subscribed := true
			for subscribed {
				select {
				case <-ctx.Done():
					_ = pubsub.Close()
					return
				case message, ok := <-messages:
					if !ok {
						subscribed = false
						continue
					}
					handleUserAuthStateInvalidation(message.Payload)
				}
			}
			_ = pubsub.Close()
			if !waitForUserAuthStateCacheSyncRetry(ctx) {
				return
			}
		}
	}()
}

func waitForUserAuthStateCacheSyncRetry(ctx context.Context) bool {
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func StopUserAuthStateCacheSync() {
	userAuthStateCacheSync.Lock()
	cancel := userAuthStateCacheSync.cancel
	done := userAuthStateCacheSync.done
	if cancel == nil {
		userAuthStateCacheSync.Unlock()
		return
	}
	cancel()
	userAuthStateCacheSync.Unlock()
	stopped := done == nil
	if done != nil {
		select {
		case <-done:
			stopped = true
		case <-time.After(3 * time.Second):
			common.SysLog("timed out stopping user auth cache invalidation subscriber")
		}
	}
	userAuthStateCacheSync.Lock()
	if stopped && userAuthStateCacheSync.done == done {
		userAuthStateCacheSync.cancel = nil
		userAuthStateCacheSync.done = nil
	}
	userAuthStateCacheSync.Unlock()
}
