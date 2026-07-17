package service

import (
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

const (
	ginKeyChannelRouteModel         = "channel_route_model"
	ginKeyChannelRouteRequestPath   = "channel_route_request_path"
	ginKeyChannelRouteStickyLogInfo = "channel_route_sticky_log_info"
	channelRouteAffinityNamespace   = "channel_route_sticky"
)

var channelRouteCooldowns sync.Map
var channelRouteAffinityStoreOnce sync.Once
var channelRouteAffinityStore *stickyChannelStore

type ChannelRouteAffinityStats struct {
	Enabled       bool   `json:"enabled"`
	Total         int    `json:"total"`
	CacheCapacity int    `json:"cache_capacity"`
	CacheAlgo     string `json:"cache_algo"`
}

func IsChannelRouteEnabled() bool {
	return common.ChannelRouteCooldownEnabled && common.ChannelRouteCooldownSeconds > 0
}

func IsChannelRouteStickyEnabled() bool {
	return IsChannelRouteEnabled() && common.ChannelRouteStickyEnabled
}

func channelRouteCooldownKey(group string, channelID int) string {
	return fmt.Sprintf("channel_route:%s:%d", common.GenerateHMAC(group), channelID)
}

func channelRouteMemoryKey(group string, channelID int) string {
	return fmt.Sprintf("%s:%d", group, channelID)
}

func channelRouteStickyScope(group string, modelName string, requestPath string) string {
	return group + "\x00" + modelName + "\x00" + requestPath
}

func channelRouteStickyKey(group string, modelName string, requestPath string) string {
	return common.GenerateHMAC(channelRouteStickyScope(group, modelName, requestPath))
}

func getChannelRouteAffinityStore() *stickyChannelStore {
	channelRouteAffinityStoreOnce.Do(func() {
		channelRouteAffinityStore = newStickyChannelStore(stickyChannelStoreConfig{
			Namespace: channelRouteAffinityNamespace,
			Capacity:  100_000,
		})
	})
	return channelRouteAffinityStore
}

func GetChannelRouteAffinityStats() ChannelRouteAffinityStats {
	store := getChannelRouteAffinityStore()
	keys, err := store.Keys()
	if err != nil {
		common.SysError("channel route affinity cache list failed: " + err.Error())
		keys = nil
	}
	capacity, _ := store.Capacity()
	algorithm, _ := store.Algorithm()
	return ChannelRouteAffinityStats{
		Enabled:       IsChannelRouteStickyEnabled(),
		Total:         len(keys),
		CacheCapacity: capacity,
		CacheAlgo:     algorithm,
	}
}

func GetChannelRouteStickyChannel(group string, modelName string, requestPath string) int {
	if group == "" || modelName == "" {
		return 0
	}
	channelID, found, err := getChannelRouteAffinityStore().Get(channelRouteStickyKey(group, modelName, requestPath))
	if err != nil {
		common.SysLog("failed to get channel route affinity: " + err.Error())
		return 0
	}
	if !found {
		return 0
	}
	return channelID
}

func SetChannelRouteStickyChannel(group string, modelName string, requestPath string, channelID int) {
	if group == "" || modelName == "" || channelID <= 0 {
		return
	}
	if err := getChannelRouteAffinityStore().SetWithTTL(
		channelRouteStickyKey(group, modelName, requestPath),
		channelID,
		0,
	); err != nil {
		common.SysLog("failed to set channel route affinity: " + err.Error())
	}
}

func ClearChannelRouteStickyChannel(group string, modelName string, requestPath string) {
	if group == "" || modelName == "" {
		return
	}
	if _, err := getChannelRouteAffinityStore().Delete(channelRouteStickyKey(group, modelName, requestPath)); err != nil {
		common.SysLog("failed to delete channel route affinity: " + err.Error())
	}
}

func ClearChannelRouteAffinityByChannel(channelID int) (int, error) {
	if channelID <= 0 {
		return 0, fmt.Errorf("invalid channel ID")
	}
	return getChannelRouteAffinityStore().DeleteByChannelID(channelID)
}

func ClearAllChannelRouteAffinity() (int, error) {
	return getChannelRouteAffinityStore().ClearAll()
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

func IsChannelRouteFrozen(group string, channelID int, now int64) bool {
	return GetChannelRouteCooldownUntil(group, channelID, now) > now
}

func GetChannelRouteCooldownUntil(group string, channelID int, now int64) int64 {
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

func FreezeChannelRoute(group string, channelID int, cooldownSeconds int) int64 {
	if group == "" || channelID <= 0 || cooldownSeconds <= 0 {
		return 0
	}
	duration := time.Duration(cooldownSeconds) * time.Second
	until := time.Now().Add(duration).Unix()
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
	if types.IsSkipRetryError(err) {
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
	return IsChannelRouteEnabled() &&
		common.ChannelRouteSameChannelRetries > retriesUsed &&
		ShouldFreezeChannelRoute(err)
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

func markChannelRouteStickyHit(c *gin.Context, group string, modelName string, requestPath string, channelID int) {
	if c == nil || group == "" || modelName == "" || channelID <= 0 {
		return
	}
	c.Set(ginKeyChannelRouteStickyLogInfo, map[string]interface{}{
		"group":        group,
		"model":        modelName,
		"request_path": requestPath,
		"channel_id":   channelID,
	})
}

func AppendChannelRouteStickyAdminInfo(c *gin.Context, adminInfo map[string]interface{}) {
	if c == nil || adminInfo == nil {
		return
	}
	value, ok := c.Get(ginKeyChannelRouteStickyLogInfo)
	if !ok || value == nil {
		return
	}
	info, ok := value.(map[string]interface{})
	if !ok {
		return
	}
	channelID, ok := info["channel_id"].(int)
	if !ok || channelID != common.GetContextKeyInt(c, constant.ContextKeyChannelRouteChannelId) {
		return
	}
	adminInfo["channel_route_sticky"] = info
}

func hasAvailableChannelRouteAlternative(group string, modelName string, requestPath string, channelID int, now int64) (bool, error) {
	channel, err := model.GetRandomSatisfiedChannelWithFilter(
		group,
		modelName,
		0,
		requestPath,
		func(candidate *model.Channel) bool {
			return candidate.Id != channelID &&
				candidate.Status == common.ChannelStatusEnabled &&
				!IsChannelRouteFrozen(group, candidate.Id, now)
		},
	)
	return channel != nil, err
}

func selectSatisfiedChannel(param *RetryParam, group string, retry int) (*model.Channel, error) {
	if param == nil {
		return nil, fmt.Errorf("retry param is nil")
	}
	if !IsChannelRouteEnabled() {
		channel, err := model.GetRandomSatisfiedChannel(group, param.ModelName, retry, param.RequestPath)
		if err == nil && channel != nil {
			TrackChannelExecutionSelection(param.Ctx, group, param.ModelName, param.RequestPath, channel, retry)
		}
		return channel, err
	}

	now := common.GetTimestamp()
	if IsChannelRouteStickyEnabled() {
		stickyChannelID := GetChannelRouteStickyChannel(group, param.ModelName, param.RequestPath)
		if stickyChannelID > 0 {
			if IsChannelRouteFrozen(group, stickyChannelID, now) {
				if stickyChannel, _ := model.CacheGetChannel(stickyChannelID); stickyChannel != nil {
					TrackChannelExecutionSkipped(param.Ctx, group, param.ModelName, param.RequestPath, stickyChannel, "affinity_cooling", GetChannelRouteCooldownUntil(group, stickyChannelID, now))
				}
				ClearChannelRouteStickyChannel(group, param.ModelName, param.RequestPath)
			} else {
				channel, err := model.GetRandomSatisfiedChannelWithFilter(
					group,
					param.ModelName,
					0,
					param.RequestPath,
					func(channel *model.Channel) bool {
						return channel.Id == stickyChannelID
					},
				)
				if err != nil {
					return nil, err
				}
				if channel != nil {
					TrackChannelRouteSelection(param.Ctx, group, param.ModelName, param.RequestPath, channel.Id)
					markChannelRouteStickyHit(param.Ctx, group, param.ModelName, param.RequestPath, channel.Id)
					TrackChannelExecutionAffinityHit(param.Ctx, group, param.ModelName, param.RequestPath, channel.Id, "route_affinity")
					TrackChannelExecutionSelection(param.Ctx, group, param.ModelName, param.RequestPath, channel, retry)
					logger.LogDebug(param.Ctx, "channel route selected sticky channel: group=%s channel=%d", group, channel.Id)
					return channel, nil
				}
				ClearChannelRouteStickyChannel(group, param.ModelName, param.RequestPath)
			}
		}
	}

	channel, err := model.GetRandomSatisfiedChannelWithFilter(
		group,
		param.ModelName,
		0,
		param.RequestPath,
		func(channel *model.Channel) bool {
			frozen := IsChannelRouteFrozen(group, channel.Id, now)
			if frozen {
				logger.LogDebug(param.Ctx, "channel route skipped cooldown channel: group=%s channel=%d", group, channel.Id)
				TrackChannelExecutionSkipped(param.Ctx, group, param.ModelName, param.RequestPath, channel, "cooling", GetChannelRouteCooldownUntil(group, channel.Id, now))
			}
			return !frozen
		},
	)
	if err == nil && channel != nil {
		TrackChannelRouteSelection(param.Ctx, group, param.ModelName, param.RequestPath, channel.Id)
		TrackChannelExecutionSelection(param.Ctx, group, param.ModelName, param.RequestPath, channel, retry)
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
	if group == "" || channelID <= 0 || cooldownSeconds <= 0 {
		return false
	}
	modelName := c.GetString(ginKeyChannelRouteModel)
	requestPath := c.GetString(ginKeyChannelRouteRequestPath)
	if IsChannelRouteStickyEnabled() {
		ClearChannelRouteStickyChannel(group, modelName, requestPath)
	}
	if modelName != "" {
		hasAlternative, lookupErr := hasAvailableChannelRouteAlternative(
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
	if IsChannelRouteStickyEnabled() {
		SetChannelRouteStickyChannel(group, c.GetString(ginKeyChannelRouteModel), c.GetString(ginKeyChannelRouteRequestPath), channelID)
	}
}
