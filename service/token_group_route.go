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

var tokenGroupRouteCooldowns sync.Map
var tokenGroupRouteStickyGroups sync.Map

func HasTokenGroupRoutes(c *gin.Context) bool {
	return len(getTokenGroupRoutes(c)) > 0
}

func getTokenGroupRoutes(c *gin.Context) []model.TokenGroupRoute {
	if c == nil {
		return nil
	}
	routes, ok := common.GetContextKeyType[[]model.TokenGroupRoute](c, constant.ContextKeyTokenGroupRoutes)
	if !ok || len(routes) == 0 {
		return nil
	}
	return routes
}

func tokenGroupRouteCooldownKey(tokenID int, group string) string {
	return fmt.Sprintf("token_group_route:%d:%s", tokenID, common.GenerateHMAC(group))
}

func tokenGroupRouteMemoryKey(tokenID int, group string) string {
	return fmt.Sprintf("%d:%s", tokenID, group)
}

func tokenGroupRouteStickyKey(tokenID int) string {
	return fmt.Sprintf("token_group_route_sticky:%d", tokenID)
}

func tokenGroupRouteStickyMemoryKey(tokenID int) string {
	return strconv.Itoa(tokenID)
}

func IsTokenGroupRouteStickyEnabled(c *gin.Context) bool {
	return common.GetContextKeyBool(c, constant.ContextKeyTokenGroupRouteSticky)
}

func GetTokenGroupRouteStickyGroup(tokenID int) string {
	if tokenID <= 0 {
		return ""
	}
	if common.RedisEnabled && common.RDB != nil {
		value, err := common.RedisGet(tokenGroupRouteStickyKey(tokenID))
		if err == nil {
			return value
		}
	}
	value, ok := tokenGroupRouteStickyGroups.Load(tokenGroupRouteStickyMemoryKey(tokenID))
	if !ok {
		return ""
	}
	group, ok := value.(string)
	if !ok {
		tokenGroupRouteStickyGroups.Delete(tokenGroupRouteStickyMemoryKey(tokenID))
		return ""
	}
	return group
}

func SetTokenGroupRouteStickyGroup(tokenID int, group string) {
	if tokenID <= 0 || group == "" {
		return
	}
	if common.RedisEnabled && common.RDB != nil {
		if err := common.RedisSet(tokenGroupRouteStickyKey(tokenID), group, 0); err != nil {
			common.SysLog("failed to set token group route sticky in redis: " + err.Error())
		}
	}
	tokenGroupRouteStickyGroups.Store(tokenGroupRouteStickyMemoryKey(tokenID), group)
}

func ClearTokenGroupRouteSticky(tokenID int) {
	if tokenID <= 0 {
		return
	}
	if common.RedisEnabled && common.RDB != nil {
		if err := common.RedisDel(tokenGroupRouteStickyKey(tokenID)); err != nil {
			common.SysLog("failed to delete token group route sticky in redis: " + err.Error())
		}
	}
	tokenGroupRouteStickyGroups.Delete(tokenGroupRouteStickyMemoryKey(tokenID))
}

func isTokenGroupRouteFrozenInMemory(tokenID int, group string, now int64) bool {
	return GetTokenGroupRouteCooldownUntilInMemory(tokenID, group, now) > now
}

func GetTokenGroupRouteCooldownUntilInMemory(tokenID int, group string, now int64) int64 {
	key := tokenGroupRouteMemoryKey(tokenID, group)
	value, ok := tokenGroupRouteCooldowns.Load(key)
	if !ok {
		return 0
	}
	until, ok := value.(int64)
	if !ok || until <= now {
		tokenGroupRouteCooldowns.Delete(key)
		return 0
	}
	return until
}

func IsTokenGroupRouteFrozen(tokenID int, group string, now int64) bool {
	return GetTokenGroupRouteCooldownUntil(tokenID, group, now) > now
}

func GetTokenGroupRouteCooldownUntil(tokenID int, group string, now int64) int64 {
	if tokenID <= 0 || group == "" {
		return 0
	}
	if common.RedisEnabled && common.RDB != nil {
		value, err := common.RedisGet(tokenGroupRouteCooldownKey(tokenID, group))
		if err == nil {
			until, parseErr := strconv.ParseInt(value, 10, 64)
			if parseErr == nil && until > now {
				return until
			}
		}
	}
	return GetTokenGroupRouteCooldownUntilInMemory(tokenID, group, now)
}

func FreezeTokenGroupRoute(tokenID int, group string, cooldownSeconds int) int64 {
	if tokenID <= 0 || group == "" || cooldownSeconds <= 0 {
		return 0
	}
	duration := time.Duration(cooldownSeconds) * time.Second
	until := time.Now().Add(duration).Unix()
	if common.RedisEnabled && common.RDB != nil {
		err := common.RedisSet(tokenGroupRouteCooldownKey(tokenID, group), strconv.FormatInt(until, 10), duration)
		if err == nil {
			return until
		}
		common.SysLog("failed to set token group route cooldown in redis: " + err.Error())
	}
	tokenGroupRouteCooldowns.Store(tokenGroupRouteMemoryKey(tokenID, group), until)
	return until
}

func ClearTokenGroupRouteCooldown(tokenID int, group string) {
	if tokenID <= 0 || group == "" {
		return
	}
	if common.RedisEnabled && common.RDB != nil {
		if err := common.RedisDel(tokenGroupRouteCooldownKey(tokenID, group)); err != nil {
			common.SysLog("failed to delete token group route cooldown in redis: " + err.Error())
		}
	}
	tokenGroupRouteCooldowns.Delete(tokenGroupRouteMemoryKey(tokenID, group))
}

func ShouldFreezeTokenGroupRoute(err *types.NewAPIError) bool {
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

func MarkTokenGroupRouteFailure(c *gin.Context, err *types.NewAPIError) {
	if !ShouldFreezeTokenGroupRoute(err) {
		return
	}
	routes := getTokenGroupRoutes(c)
	if len(routes) == 0 {
		return
	}
	tokenID := common.GetContextKeyInt(c, constant.ContextKeyTokenId)
	group := common.GetContextKeyString(c, constant.ContextKeyTokenGroupRouteGroup)
	if tokenID <= 0 || group == "" {
		return
	}
	cooldownSeconds := common.GetContextKeyInt(c, constant.ContextKeyTokenGroupRouteCooldown)
	if cooldownSeconds <= 0 {
		for _, route := range routes {
			if route.Group == group {
				cooldownSeconds = route.CooldownSeconds
				break
			}
		}
	}
	if cooldownSeconds <= 0 {
		return
	}
	until := FreezeTokenGroupRoute(tokenID, group, cooldownSeconds)
	stickyHit := common.GetContextKeyBool(c, constant.ContextKeyTokenGroupRouteStickyHit)
	if IsTokenGroupRouteStickyEnabled(c) {
		ClearTokenGroupRouteSticky(tokenID)
	}
	index := common.GetContextKeyInt(c, constant.ContextKeyTokenGroupRouteIndex)
	if stickyHit {
		common.SetContextKey(c, constant.ContextKeyTokenGroupRouteIndex, 0)
	} else {
		common.SetContextKey(c, constant.ContextKeyTokenGroupRouteIndex, index+1)
	}
	logger.LogWarn(c, fmt.Sprintf("token group route frozen: token=%d group=%s cooldown=%ds until=%d",
		tokenID, group, cooldownSeconds, until))
}

func MarkTokenGroupRouteSuccess(c *gin.Context) {
	if !HasTokenGroupRoutes(c) {
		return
	}
	tokenID := common.GetContextKeyInt(c, constant.ContextKeyTokenId)
	group := common.GetContextKeyString(c, constant.ContextKeyTokenGroupRouteGroup)
	ClearTokenGroupRouteCooldown(tokenID, group)
	if IsTokenGroupRouteStickyEnabled(c) {
		SetTokenGroupRouteStickyGroup(tokenID, group)
	}
}

func findTokenGroupRouteIndex(routes []model.TokenGroupRoute, group string) int {
	for index, route := range routes {
		if route.Group == group {
			return index
		}
	}
	return -1
}

func setTokenGroupRouteContext(c *gin.Context, index int, route model.TokenGroupRoute) {
	common.SetContextKey(c, constant.ContextKeyTokenGroupRouteIndex, index)
	common.SetContextKey(c, constant.ContextKeyTokenGroupRouteGroup, route.Group)
	common.SetContextKey(c, constant.ContextKeyTokenGroupRouteCooldown, route.CooldownSeconds)
	common.SetContextKey(c, constant.ContextKeyUsingGroup, route.Group)
}

func trySelectTokenGroupRoute(param *RetryParam, route model.TokenGroupRoute, index int) (*model.Channel, string, error) {
	logger.LogDebug(param.Ctx, "Token group route selecting group: %s, priority: %d", route.Group, route.Priority)
	channel, err := selectSatisfiedChannel(param, route.Group, 0)
	if err != nil {
		return nil, route.Group, err
	}
	if channel == nil {
		return nil, route.Group, nil
	}
	setTokenGroupRouteContext(param.Ctx, index, route)
	return channel, route.Group, nil
}

func selectTokenGroupRoute(param *RetryParam, routes []model.TokenGroupRoute) (*model.Channel, string, error) {
	if param == nil || param.Ctx == nil {
		return nil, "", fmt.Errorf("token group route context is nil")
	}
	tokenID := common.GetContextKeyInt(param.Ctx, constant.ContextKeyTokenId)
	startGroupIndex := common.GetContextKeyInt(param.Ctx, constant.ContextKeyTokenGroupRouteIndex)
	if startGroupIndex < 0 {
		startGroupIndex = 0
	}
	if startGroupIndex >= len(routes) {
		return nil, "", fmt.Errorf("密钥路由分组已全部尝试完毕")
	}

	now := common.GetTimestamp()
	selectGroup := routes[startGroupIndex].Group
	skippedCooldown := false
	if IsTokenGroupRouteStickyEnabled(param.Ctx) && startGroupIndex == 0 {
		stickyGroup := GetTokenGroupRouteStickyGroup(tokenID)
		if stickyGroup != "" {
			stickyIndex := findTokenGroupRouteIndex(routes, stickyGroup)
			if stickyIndex < 0 {
				ClearTokenGroupRouteSticky(tokenID)
			} else {
				stickyRoute := routes[stickyIndex]
				if IsTokenGroupRouteFrozen(tokenID, stickyRoute.Group, now) {
					skippedCooldown = true
					ClearTokenGroupRouteSticky(tokenID)
					logger.LogDebug(param.Ctx, "Token group route sticky group is cooling: %s", stickyRoute.Group)
				} else {
					channel, group, err := trySelectTokenGroupRoute(param, stickyRoute, stickyIndex)
					if err != nil {
						return nil, group, err
					}
					if channel != nil {
						common.SetContextKey(param.Ctx, constant.ContextKeyTokenGroupRouteStickyHit, true)
						return channel, group, nil
					}
					until := FreezeTokenGroupRoute(tokenID, stickyRoute.Group, stickyRoute.CooldownSeconds)
					ClearTokenGroupRouteSticky(tokenID)
					logger.LogWarn(param.Ctx, fmt.Sprintf("token group route sticky group has no channel, frozen: token=%d group=%s cooldown=%ds until=%d",
						tokenID, stickyRoute.Group, stickyRoute.CooldownSeconds, until))
				}
			}
		}
	}

	for i := startGroupIndex; i < len(routes); i++ {
		route := routes[i]
		selectGroup = route.Group
		if IsTokenGroupRouteFrozen(tokenID, route.Group, now) {
			skippedCooldown = true
			logger.LogDebug(param.Ctx, "Token group route skipped cooldown group: %s", route.Group)
			continue
		}

		channel, group, err := trySelectTokenGroupRoute(param, route, i)
		if err != nil {
			return nil, group, err
		}
		if channel == nil {
			until := FreezeTokenGroupRoute(tokenID, route.Group, route.CooldownSeconds)
			common.SetContextKey(param.Ctx, constant.ContextKeyTokenGroupRouteIndex, i+1)
			logger.LogWarn(param.Ctx, fmt.Sprintf("token group route has no channel, frozen: token=%d group=%s cooldown=%ds until=%d",
				tokenID, route.Group, route.CooldownSeconds, until))
			continue
		}
		return channel, group, nil
	}

	if skippedCooldown {
		return nil, selectGroup, fmt.Errorf("密钥路由分组正在冷却，暂无可用分组")
	}
	return nil, selectGroup, nil
}
