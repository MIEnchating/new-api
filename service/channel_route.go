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
	ginKeyChannelRouteModel       = "channel_route_model"
	ginKeyChannelRouteRequestPath = "channel_route_request_path"
)

var channelRouteCooldowns sync.Map
var channelRouteStickyChannels sync.Map

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
	return "channel_route_sticky:" + common.GenerateHMAC(channelRouteStickyScope(group, modelName, requestPath))
}

func GetChannelRouteStickyChannel(group string, modelName string, requestPath string) int {
	if group == "" || modelName == "" {
		return 0
	}
	if common.RedisEnabled && common.RDB != nil {
		value, err := common.RedisGet(channelRouteStickyKey(group, modelName, requestPath))
		if err == nil {
			channelID, parseErr := strconv.Atoi(value)
			if parseErr == nil && channelID > 0 {
				return channelID
			}
		}
	}
	value, ok := channelRouteStickyChannels.Load(channelRouteStickyScope(group, modelName, requestPath))
	if !ok {
		return 0
	}
	channelID, ok := value.(int)
	if !ok || channelID <= 0 {
		channelRouteStickyChannels.Delete(channelRouteStickyScope(group, modelName, requestPath))
		return 0
	}
	return channelID
}

func SetChannelRouteStickyChannel(group string, modelName string, requestPath string, channelID int) {
	if group == "" || modelName == "" || channelID <= 0 {
		return
	}
	if common.RedisEnabled && common.RDB != nil {
		if err := common.RedisSet(channelRouteStickyKey(group, modelName, requestPath), strconv.Itoa(channelID), 0); err != nil {
			common.SysLog("failed to set channel route sticky in redis: " + err.Error())
		}
	}
	channelRouteStickyChannels.Store(channelRouteStickyScope(group, modelName, requestPath), channelID)
}

func ClearChannelRouteStickyChannel(group string, modelName string, requestPath string) {
	if group == "" || modelName == "" {
		return
	}
	if common.RedisEnabled && common.RDB != nil {
		if err := common.RedisDel(channelRouteStickyKey(group, modelName, requestPath)); err != nil {
			common.SysLog("failed to delete channel route sticky in redis: " + err.Error())
		}
	}
	channelRouteStickyChannels.Delete(channelRouteStickyScope(group, modelName, requestPath))
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

func selectSatisfiedChannel(param *RetryParam, group string, retry int) (*model.Channel, error) {
	if param == nil {
		return nil, fmt.Errorf("retry param is nil")
	}
	if !IsChannelRouteEnabled() {
		return model.GetRandomSatisfiedChannel(group, param.ModelName, retry, param.RequestPath)
	}

	now := common.GetTimestamp()
	if IsChannelRouteStickyEnabled() {
		stickyChannelID := GetChannelRouteStickyChannel(group, param.ModelName, param.RequestPath)
		if stickyChannelID > 0 {
			if IsChannelRouteFrozen(group, stickyChannelID, now) {
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
			}
			return !frozen
		},
	)
	if err == nil && channel != nil {
		TrackChannelRouteSelection(param.Ctx, group, param.ModelName, param.RequestPath, channel.Id)
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
	if IsChannelRouteStickyEnabled() {
		ClearChannelRouteStickyChannel(group, c.GetString(ginKeyChannelRouteModel), c.GetString(ginKeyChannelRouteRequestPath))
	}
	until := FreezeChannelRoute(group, channelID, cooldownSeconds)
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
