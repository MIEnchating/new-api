package service

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

const (
	ginKeyChannelRouteModel        = "channel_route_model"
	ginKeyChannelRouteRequestPath  = "channel_route_request_path"
	channelRouteCooldownPruneEvery = 256
)

var channelRouteCooldowns sync.Map
var channelRouteCooldownWrites atomic.Uint64

func IsChannelRouteEnabled() bool {
	return common.ChannelRouteCooldownEnabled
}

// IsChannelRouteCooldownEnabled reports whether failed channels should be
// excluded from future requests. Routing itself remains enabled when the
// configured cooldown is zero.
func IsChannelRouteCooldownEnabled() bool {
	return IsChannelRouteEnabled() && common.ChannelRouteCooldownSeconds > 0
}

func channelRouteCooldownKey(group string, channelID int) string {
	return fmt.Sprintf("channel_route:%s:%d", common.GenerateHMAC(group), channelID)
}

func channelRouteMemoryKey(group string, channelID int) string {
	return fmt.Sprintf("%s:%d", group, channelID)
}

func isChannelRouteFrozenInMemory(group string, channelID int, now int64) bool {
	return GetChannelRouteCooldownUntilInMemory(group, channelID, now) > now
}

func GetChannelRouteCooldownUntilInMemory(group string, channelID int, now int64) int64 {
	key := channelRouteMemoryKey(group, channelID)
	value, ok := channelRouteCooldowns.Load(key)
	if !ok {
		return 0
	}
	until, ok := value.(int64)
	if !ok || until <= now {
		channelRouteCooldowns.Delete(key)
		return 0
	}
	return until
}

func pruneExpiredChannelRouteCooldowns(now int64) int {
	deleted := 0
	channelRouteCooldowns.Range(func(key, value any) bool {
		until, ok := value.(int64)
		if !ok || until <= now {
			channelRouteCooldowns.Delete(key)
			deleted++
		}
		return true
	})
	return deleted
}

func maybePruneExpiredChannelRouteCooldowns(now int64) {
	if channelRouteCooldownWrites.Add(1)%channelRouteCooldownPruneEvery == 0 {
		pruneExpiredChannelRouteCooldowns(now)
	}
}

func IsChannelRouteFrozen(group string, channelID int, now int64) bool {
	return GetChannelRouteCooldownUntil(group, channelID, now) > now
}

func GetChannelRouteCooldownUntil(group string, channelID int, now int64) int64 {
	if !IsChannelRouteCooldownEnabled() {
		return 0
	}
	if group == "" || channelID <= 0 {
		return 0
	}
	if common.RedisEnabled && common.RDB != nil {
		value, err := common.RedisGet(channelRouteCooldownKey(group, channelID))
		if err == nil {
			until, parseErr := strconv.ParseInt(value, 10, 64)
			if parseErr == nil && until > now {
				return until
			}
		}
	}
	return GetChannelRouteCooldownUntilInMemory(group, channelID, now)
}

// getChannelRouteCooldownsUntil returns the same effective cooldown values as
// GetChannelRouteCooldownUntil while batching Redis reads into one round trip.
// Missing, invalid, or expired Redis values retain the existing in-memory
// fallback semantics on a per-channel basis.
func getChannelRouteCooldownsUntil(group string, channelIDs []int, now int64) map[int]int64 {
	cooldowns := make(map[int]int64, len(channelIDs))
	if !IsChannelRouteCooldownEnabled() || group == "" || len(channelIDs) == 0 {
		return cooldowns
	}

	uniqueIDs := make([]int, 0, len(channelIDs))
	keys := make([]string, 0, len(channelIDs))
	seen := make(map[int]struct{}, len(channelIDs))
	for _, channelID := range channelIDs {
		if channelID <= 0 {
			continue
		}
		if _, exists := seen[channelID]; exists {
			continue
		}
		seen[channelID] = struct{}{}
		uniqueIDs = append(uniqueIDs, channelID)
		keys = append(keys, channelRouteCooldownKey(group, channelID))
		cooldowns[channelID] = 0
	}

	if common.RedisEnabled && common.RDB != nil && len(keys) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		values, err := common.RDB.MGet(ctx, keys...).Result()
		if err == nil {
			for index, channelID := range uniqueIDs {
				if index < len(values) && values[index] != nil {
					if until, parseErr := strconv.ParseInt(fmt.Sprint(values[index]), 10, 64); parseErr == nil && until > now {
						cooldowns[channelID] = until
						continue
					}
				}
				if until := GetChannelRouteCooldownUntilInMemory(group, channelID, now); until > now {
					cooldowns[channelID] = until
				}
			}
			return cooldowns
		}
	}

	for _, channelID := range uniqueIDs {
		if until := GetChannelRouteCooldownUntilInMemory(group, channelID, now); until > now {
			cooldowns[channelID] = until
		}
	}
	return cooldowns
}

// loadChannelRouteCooldownSnapshot batches cooldown reads for the in-memory
// channel-selection path. When channel caching is disabled, callers keep the
// existing per-candidate lookup so this helper does not add a duplicate DB
// query just to discover candidate IDs.
func loadChannelRouteCooldownSnapshot(group string, modelName string, requestPath string, now int64, extraChannelIDs ...int) (map[int]int64, bool, error) {
	if !common.MemoryCacheEnabled {
		return nil, false, nil
	}
	candidates, err := model.ListSatisfiedChannelCandidates(group, modelName, requestPath)
	if err != nil {
		return nil, false, err
	}
	channelIDs := make([]int, 0, len(candidates)+len(extraChannelIDs))
	for _, candidate := range candidates {
		channelIDs = append(channelIDs, candidate.ChannelID)
	}
	channelIDs = append(channelIDs, extraChannelIDs...)
	return getChannelRouteCooldownsUntil(group, channelIDs, now), true, nil
}

func channelRouteCooldownFromSnapshot(cooldowns map[int]int64, batched bool, group string, channelID int, now int64) int64 {
	if batched {
		return cooldowns[channelID]
	}
	return GetChannelRouteCooldownUntil(group, channelID, now)
}

func FreezeChannelRoute(group string, channelID int, cooldownSeconds int) int64 {
	if group == "" || channelID <= 0 || cooldownSeconds <= 0 {
		return 0
	}
	duration := time.Duration(cooldownSeconds) * time.Second
	until := time.Now().Add(duration).Unix()
	maybePruneExpiredChannelRouteCooldowns(time.Now().Unix())
	if common.RedisEnabled && common.RDB != nil {
		err := common.RedisSet(channelRouteCooldownKey(group, channelID), strconv.FormatInt(until, 10), duration)
		if err != nil {
			common.SysLog("failed to set channel route cooldown in redis: " + err.Error())
		}
	}
	channelRouteCooldowns.Store(channelRouteMemoryKey(group, channelID), until)
	return until
}

func ClearChannelRouteCooldown(group string, channelID int) {
	if group == "" || channelID <= 0 {
		return
	}
	if common.RedisEnabled && common.RDB != nil {
		if err := common.RedisDel(channelRouteCooldownKey(group, channelID)); err != nil {
			common.SysLog("failed to delete channel route cooldown in redis: " + err.Error())
		}
	}
	channelRouteCooldowns.Delete(channelRouteMemoryKey(group, channelID))
}

func ShouldFreezeChannelRoute(err *types.NewAPIError) bool {
	if err == nil {
		return false
	}
	if types.IsSkipRetryError(err) || operation_setting.IsAlwaysSkipRetryError(err) {
		return false
	}
	if types.IsChannelError(err) {
		return true
	}
	if err.StatusCode < 100 || err.StatusCode > 599 {
		return true
	}
	return operation_setting.ShouldRetryByStatusCode(err.StatusCode) ||
		operation_setting.ShouldDisableByStatusCode(err.StatusCode)
}

func ShouldRetrySameChannelRoute(err *types.NewAPIError, retriesUsed int) bool {
	return ShouldRetrySameChannelRouteForGroup(err, retriesUsed, "")
}

func ShouldRetrySameChannelRouteForGroup(err *types.NewAPIError, retriesUsed int, group string) bool {
	return IsChannelRouteEnabled() &&
		!setting.IsChannelRouteSameChannelRetryExcluded(group) &&
		common.ChannelRouteSameChannelRetries > retriesUsed &&
		ShouldFreezeChannelRoute(err)
}

func ShouldRetrySameChannelRouteForContext(c *gin.Context, err *types.NewAPIError, retriesUsed int) bool {
	group := common.GetContextKeyString(c, constant.ContextKeyChannelRouteGroup)
	return ShouldRetrySameChannelRouteForGroup(err, retriesUsed, group)
}

func IsNextChannelRouteExcluded(c *gin.Context) bool {
	if !IsChannelRouteEnabled() || c == nil {
		return false
	}
	group := common.GetContextKeyString(c, constant.ContextKeyChannelRouteGroup)
	return setting.IsChannelRouteNextChannelExcluded(group)
}

func TrackChannelRouteSelection(c *gin.Context, group string, modelName string, requestPath string, channelID int) {
	if c == nil || group == "" || modelName == "" || channelID <= 0 {
		return
	}
	common.SetContextKey(c, constant.ContextKeyChannelRouteGroup, group)
	common.SetContextKey(c, constant.ContextKeyChannelRouteChannelId, channelID)
	common.SetContextKey(c, constant.ContextKeyChannelRouteCooldown, common.ChannelRouteCooldownSeconds)
	c.Set(ginKeyChannelRouteModel, modelName)
	c.Set(ginKeyChannelRouteRequestPath, requestPath)
}

func channelWasUsed(c *gin.Context, channelID int) bool {
	if c == nil || channelID <= 0 {
		return false
	}
	for _, value := range c.GetStringSlice("use_channel") {
		if value == strconv.Itoa(channelID) {
			return true
		}
	}
	return false
}

func hasAvailableChannelRouteAlternative(c *gin.Context, group string, modelName string, requestPath string, channelID int, now int64) (bool, error) {
	cooldowns, batched, err := loadChannelRouteCooldownSnapshot(group, modelName, requestPath, now)
	if err != nil {
		return false, err
	}
	channel, err := model.GetRandomSatisfiedChannelWithFilter(
		group,
		modelName,
		0,
		requestPath,
		func(candidate *model.Channel) bool {
			return candidate.Id != channelID &&
				(IsChannelRouteCooldownEnabled() || !channelWasUsed(c, candidate.Id)) &&
				candidate.Status == common.ChannelStatusEnabled &&
				channelRouteCooldownFromSnapshot(cooldowns, batched, group, candidate.Id, now) <= now
		},
	)
	return channel != nil, err
}

func shouldResolveChannelAffinityAfterGroup(param *RetryParam) bool {
	if param == nil || param.Ctx == nil {
		return false
	}
	return IsChannelRouteEnabled() ||
		HasTokenGroupRoutes(param.Ctx) ||
		param.TokenGroup == "auto" ||
		common.GetContextKeyString(param.Ctx, constant.ContextKeyUsingGroup) == "auto"
}

func resolvePostGroupChannelAffinity(param *RetryParam, group string) (int, bool) {
	if !shouldResolveChannelAffinityAfterGroup(param) {
		return 0, false
	}
	channelID, found := GetPreferredChannelByAffinity(param.Ctx, param.ModelName, group)
	return channelID, found && shouldSelectFirstChannelByAffinity(param.Ctx)
}

func getSatisfiedChannelAffinityCandidate(
	param *RetryParam,
	group string,
	channelID int,
) (*model.Channel, error) {
	channel, err := model.GetRandomSatisfiedChannelWithFilter(
		group,
		param.ModelName,
		0,
		param.RequestPath,
		func(candidate *model.Channel) bool {
			return candidate.Id == channelID &&
				candidate.Status == common.ChannelStatusEnabled
		},
	)
	if err != nil {
		return nil, err
	}
	if channel == nil {
		if !ShouldKeepChannelAffinityOnChannelDisabled() {
			ClearCurrentChannelAffinityCache(param.Ctx)
		}
		return nil, nil
	}
	MarkChannelAffinityUsed(param.Ctx, group, channel.Id)
	return channel, nil
}

func markPostGroupChannelSelected(param *RetryParam, channel *model.Channel) {
	if channel != nil && shouldResolveChannelAffinityAfterGroup(param) {
		markChannelAffinityFirstPickComplete(param.Ctx)
		param.Ctx.Set(ginKeyChannelAffinityManaged, true)
	}
}

func selectSatisfiedChannel(param *RetryParam, group string, retry int) (*model.Channel, error) {
	if param == nil {
		return nil, fmt.Errorf("retry param is nil")
	}
	affinityChannelID, selectAffinity := resolvePostGroupChannelAffinity(param, group)
	if !IsChannelRouteEnabled() {
		if selectAffinity {
			channel, err := getSatisfiedChannelAffinityCandidate(param, group, affinityChannelID)
			if err != nil {
				return nil, err
			}
			if channel != nil {
				TrackChannelExecutionAffinityHit(param.Ctx, group, param.ModelName, param.RequestPath, channel.Id, "channel_affinity")
				TrackChannelExecutionSelection(param.Ctx, group, param.ModelName, param.RequestPath, channel, retry)
				markPostGroupChannelSelected(param, channel)
				return channel, nil
			}
		}
		channel, err := model.GetRandomSatisfiedChannel(group, param.ModelName, retry, param.RequestPath)
		if err == nil && channel != nil {
			TrackChannelExecutionSelection(param.Ctx, group, param.ModelName, param.RequestPath, channel, retry)
			markPostGroupChannelSelected(param, channel)
		}
		return channel, err
	}

	now := common.GetTimestamp()
	extraChannelID := 0
	if selectAffinity {
		extraChannelID = affinityChannelID
	}
	cooldowns, batchedCooldowns, snapshotErr := loadChannelRouteCooldownSnapshot(
		group,
		param.ModelName,
		param.RequestPath,
		now,
		extraChannelID,
	)
	if snapshotErr != nil {
		return nil, snapshotErr
	}
	cooldownUntil := func(channelID int) int64 {
		return channelRouteCooldownFromSnapshot(cooldowns, batchedCooldowns, group, channelID, now)
	}

	if selectAffinity {
		affinityCooldownUntil := cooldownUntil(affinityChannelID)
		if affinityCooldownUntil > now {
			if affinityChannel, _ := model.CacheGetChannel(affinityChannelID); affinityChannel != nil {
				TrackChannelExecutionSkipped(param.Ctx, group, param.ModelName, param.RequestPath, affinityChannel, "affinity_cooling", affinityCooldownUntil)
			}
		} else {
			channel, err := getSatisfiedChannelAffinityCandidate(param, group, affinityChannelID)
			if err != nil {
				return nil, err
			}
			if channel != nil {
				TrackChannelRouteSelection(param.Ctx, group, param.ModelName, param.RequestPath, channel.Id)
				TrackChannelExecutionAffinityHit(param.Ctx, group, param.ModelName, param.RequestPath, channel.Id, "channel_affinity")
				trackChannelExecutionSelectionWithCooldowns(param.Ctx, group, param.ModelName, param.RequestPath, channel, retry, cooldowns)
				markPostGroupChannelSelected(param, channel)
				logger.LogDebug(param.Ctx, "channel route selected request-affinity channel: group=%s channel=%d", group, channel.Id)
				return channel, nil
			}
		}
	}

	channel, err := model.GetRandomSatisfiedChannelWithFilter(
		group,
		param.ModelName,
		0,
		param.RequestPath,
		func(channel *model.Channel) bool {
			if !IsChannelRouteCooldownEnabled() && channelWasUsed(param.Ctx, channel.Id) {
				return false
			}
			until := cooldownUntil(channel.Id)
			frozen := until > now
			if frozen {
				logger.LogDebug(param.Ctx, "channel route skipped cooldown channel: group=%s channel=%d", group, channel.Id)
				TrackChannelExecutionSkipped(param.Ctx, group, param.ModelName, param.RequestPath, channel, "cooling", until)
			}
			return !frozen
		},
	)
	if err == nil && channel != nil {
		TrackChannelRouteSelection(param.Ctx, group, param.ModelName, param.RequestPath, channel.Id)
		trackChannelExecutionSelectionWithCooldowns(param.Ctx, group, param.ModelName, param.RequestPath, channel, retry, cooldowns)
		markPostGroupChannelSelected(param, channel)
	}
	return channel, err
}

func MarkChannelRouteFailure(c *gin.Context, err *types.NewAPIError) bool {
	if !IsChannelRouteEnabled() || !ShouldFreezeChannelRoute(err) {
		return false
	}
	group := common.GetContextKeyString(c, constant.ContextKeyChannelRouteGroup)
	channelID := common.GetContextKeyInt(c, constant.ContextKeyChannelRouteChannelId)
	cooldownSeconds := common.GetContextKeyInt(c, constant.ContextKeyChannelRouteCooldown)
	if cooldownSeconds <= 0 {
		cooldownSeconds = common.ChannelRouteCooldownSeconds
	}
	if group == "" || channelID <= 0 {
		return false
	}
	modelName := c.GetString(ginKeyChannelRouteModel)
	requestPath := c.GetString(ginKeyChannelRouteRequestPath)
	if modelName != "" {
		hasAlternative, lookupErr := hasAvailableChannelRouteAlternative(
			c,
			group,
			modelName,
			requestPath,
			channelID,
			common.GetTimestamp(),
		)
		if lookupErr != nil {
			logger.LogWarn(c, fmt.Sprintf("failed to check channel route alternatives, keeping cooldown behavior: group=%s channel=%d error=%s",
				group, channelID, lookupErr.Error()))
		} else if !hasAlternative {
			logger.LogDebug(c, "channel route cooldown skipped because no alternative channel is available: group=%s channel=%d", group, channelID)
			return false
		}
	}
	if cooldownSeconds <= 0 {
		logger.LogDebug(c, "channel route cooldown disabled: group=%s channel=%d", group, channelID)
		return true
	}
	until := FreezeChannelRoute(group, channelID, cooldownSeconds)
	TrackChannelExecutionCooling(c, group, channelID, until)
	logger.LogWarn(c, fmt.Sprintf("channel route frozen: group=%s channel=%d cooldown=%ds until=%d",
		group, channelID, cooldownSeconds, until))
	return true
}

func MarkChannelRouteSuccess(c *gin.Context) {
	if !IsChannelRouteEnabled() {
		return
	}
	group := common.GetContextKeyString(c, constant.ContextKeyChannelRouteGroup)
	channelID := common.GetContextKeyInt(c, constant.ContextKeyChannelRouteChannelId)
	ClearChannelRouteCooldown(group, channelID)
}
