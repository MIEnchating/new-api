package service

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
)

var tokenGroupRouteCooldowns sync.Map
var tokenGroupRouteCooldownWrites atomic.Uint64

const (
	tokenGroupRouteStateCooldown      = "cooldown"
	tokenGroupRouteStateSticky        = "sticky"
	ginKeyTokenGroupRouteModel        = "token_group_route_model"
	ginKeyTokenGroupRoutePath         = "token_group_route_path"
	tokenGroupRouteCooldownPruneEvery = 256
)

type tokenGroupRouteStateRef struct {
	TokenID     int    `json:"-"`
	Kind        string `json:"kind"`
	Group       string `json:"group,omitempty"`
	ModelName   string `json:"model"`
	RequestPath string `json:"request_path"`
}

type tokenGroupRouteCooldownState struct {
	tokenGroupRouteStateRef
	Until int64
}

type TokenGroupRouteCooldownStatus struct {
	Group       string `json:"group"`
	ModelName   string `json:"model"`
	RequestPath string `json:"request_path"`
	Until       int64  `json:"cooldown_until"`
}

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

func tokenGroupRouteStateIndexKey(tokenID int) string {
	return fmt.Sprintf("token_group_route_state:%d", tokenID)
}

func tokenGroupRouteScope(group string, modelName string, requestPath string) string {
	return group + "\x00" + modelName + "\x00" + requestPath
}

func tokenGroupRouteCooldownKey(tokenID int, group string, modelName string, requestPath string) string {
	return fmt.Sprintf("token_group_route:%d:%s", tokenID, common.GenerateHMAC(tokenGroupRouteScope(group, modelName, requestPath)))
}

func tokenGroupRouteStickyScope(modelName string, requestPath string) string {
	return modelName + "\x00" + requestPath
}

func tokenGroupRouteStickyKey(tokenID int, modelName string, requestPath string) string {
	return fmt.Sprintf("token_group_route_sticky:%d:%s", tokenID, common.GenerateHMAC(tokenGroupRouteStickyScope(modelName, requestPath)))
}

func encodeTokenGroupRouteStateRef(ref tokenGroupRouteStateRef) string {
	data, _ := common.Marshal(ref)
	return string(data)
}

func registerTokenGroupRouteState(tokenID int, ref tokenGroupRouteStateRef) {
	if !common.RedisEnabled || common.RDB == nil {
		return
	}
	if err := common.RDB.SAdd(context.Background(), tokenGroupRouteStateIndexKey(tokenID), encodeTokenGroupRouteStateRef(ref)).Err(); err != nil {
		common.SysLog("failed to register token group route state: " + err.Error())
	}
}

func unregisterTokenGroupRouteState(tokenID int, ref tokenGroupRouteStateRef) {
	if !common.RedisEnabled || common.RDB == nil {
		return
	}
	if err := common.RDB.SRem(context.Background(), tokenGroupRouteStateIndexKey(tokenID), encodeTokenGroupRouteStateRef(ref)).Err(); err != nil {
		common.SysLog("failed to unregister token group route state: " + err.Error())
	}
}

func IsTokenGroupRouteStickyEnabled(c *gin.Context) bool {
	return common.GetContextKeyBool(c, constant.ContextKeyTokenGroupRouteSticky)
}

func GetTokenGroupRouteStickyGroup(tokenID int, modelName string, requestPath string) string {
	if tokenID <= 0 || modelName == "" {
		return ""
	}
	group, found, err := getTokenGroupRouteStickyStore().Get(tokenGroupRouteStickyKey(tokenID, modelName, requestPath))
	if err != nil {
		common.SysLog("failed to get token group route affinity: " + err.Error())
		return ""
	}
	if !found {
		return ""
	}
	return group
}

func SetTokenGroupRouteStickyGroup(tokenID int, modelName string, requestPath string, group string) {
	if tokenID <= 0 || modelName == "" || group == "" {
		return
	}
	ref := tokenGroupRouteStateRef{TokenID: tokenID, Kind: tokenGroupRouteStateSticky, ModelName: modelName, RequestPath: requestPath}
	if err := getTokenGroupRouteStickyStore().Set(tokenGroupRouteStickyKey(tokenID, modelName, requestPath), group); err != nil {
		common.SysLog("failed to set token group route affinity: " + err.Error())
		return
	}
	if common.RedisEnabled && common.RDB != nil {
		registerTokenGroupRouteState(tokenID, ref)
	}
}

func clearTokenGroupRouteStickyScope(tokenID int, modelName string, requestPath string) {
	if tokenID <= 0 || modelName == "" {
		return
	}
	ref := tokenGroupRouteStateRef{TokenID: tokenID, Kind: tokenGroupRouteStateSticky, ModelName: modelName, RequestPath: requestPath}
	if _, err := getTokenGroupRouteStickyStore().Delete(tokenGroupRouteStickyKey(tokenID, modelName, requestPath)); err != nil {
		common.SysLog("failed to delete token group route affinity: " + err.Error())
	}
	if common.RedisEnabled && common.RDB != nil {
		unregisterTokenGroupRouteState(tokenID, ref)
	}
}

func pruneExpiredTokenGroupRouteCooldowns(now int64) int {
	deleted := 0
	tokenGroupRouteCooldowns.Range(func(key, value any) bool {
		state, ok := value.(tokenGroupRouteCooldownState)
		if !ok || state.Until <= now {
			tokenGroupRouteCooldowns.Delete(key)
			deleted++
		}
		return true
	})
	return deleted
}

func maybePruneExpiredTokenGroupRouteCooldowns(now int64) {
	if tokenGroupRouteCooldownWrites.Add(1)%tokenGroupRouteCooldownPruneEvery == 0 {
		pruneExpiredTokenGroupRouteCooldowns(now)
	}
}

func GetTokenGroupRouteCooldownUntilInMemory(tokenID int, group string, modelName string, requestPath string, now int64) int64 {
	key := tokenGroupRouteCooldownKey(tokenID, group, modelName, requestPath)
	value, ok := tokenGroupRouteCooldowns.Load(key)
	if !ok {
		return 0
	}
	state, ok := value.(tokenGroupRouteCooldownState)
	if !ok || state.Until <= now {
		tokenGroupRouteCooldowns.Delete(key)
		return 0
	}
	return state.Until
}

func IsTokenGroupRouteFrozen(tokenID int, group string, modelName string, requestPath string, now int64) bool {
	return GetTokenGroupRouteCooldownUntil(tokenID, group, modelName, requestPath, now) > now
}

func GetTokenGroupRouteCooldownUntil(tokenID int, group string, modelName string, requestPath string, now int64) int64 {
	if tokenID <= 0 || group == "" || modelName == "" {
		return 0
	}
	ref := tokenGroupRouteStateRef{TokenID: tokenID, Kind: tokenGroupRouteStateCooldown, Group: group, ModelName: modelName, RequestPath: requestPath}
	if common.RedisEnabled && common.RDB != nil {
		value, err := common.RDB.Get(context.Background(), tokenGroupRouteCooldownKey(tokenID, group, modelName, requestPath)).Result()
		if err == nil {
			until, parseErr := strconv.ParseInt(value, 10, 64)
			if parseErr == nil && until > now {
				return until
			}
		} else if err == redis.Nil {
			unregisterTokenGroupRouteState(tokenID, ref)
		}
	}
	return GetTokenGroupRouteCooldownUntilInMemory(tokenID, group, modelName, requestPath, now)
}

func FreezeTokenGroupRoute(tokenID int, group string, modelName string, requestPath string, cooldownSeconds int) int64 {
	if tokenID <= 0 || group == "" || modelName == "" || cooldownSeconds <= 0 {
		return 0
	}
	duration := time.Duration(cooldownSeconds) * time.Second
	until := time.Now().Add(duration).Unix()
	maybePruneExpiredTokenGroupRouteCooldowns(time.Now().Unix())
	ref := tokenGroupRouteStateRef{TokenID: tokenID, Kind: tokenGroupRouteStateCooldown, Group: group, ModelName: modelName, RequestPath: requestPath}
	if common.RedisEnabled && common.RDB != nil {
		err := common.RedisSet(tokenGroupRouteCooldownKey(tokenID, group, modelName, requestPath), strconv.FormatInt(until, 10), duration)
		if err == nil {
			registerTokenGroupRouteState(tokenID, ref)
			return until
		}
		common.SysLog("failed to set token group route cooldown in redis: " + err.Error())
	}
	tokenGroupRouteCooldowns.Store(tokenGroupRouteCooldownKey(tokenID, group, modelName, requestPath), tokenGroupRouteCooldownState{tokenGroupRouteStateRef: ref, Until: until})
	return until
}

func ClearTokenGroupRouteCooldown(tokenID int, group string, modelName string, requestPath string) {
	if tokenID <= 0 || group == "" || modelName == "" {
		return
	}
	ref := tokenGroupRouteStateRef{TokenID: tokenID, Kind: tokenGroupRouteStateCooldown, Group: group, ModelName: modelName, RequestPath: requestPath}
	if common.RedisEnabled && common.RDB != nil {
		if err := common.RedisDel(tokenGroupRouteCooldownKey(tokenID, group, modelName, requestPath)); err != nil {
			common.SysLog("failed to delete token group route cooldown in redis: " + err.Error())
		}
		unregisterTokenGroupRouteState(tokenID, ref)
	}
	tokenGroupRouteCooldowns.Delete(tokenGroupRouteCooldownKey(tokenID, group, modelName, requestPath))
}

func ClearTokenGroupRouteState(tokenID int) {
	if tokenID <= 0 {
		return
	}
	if common.RedisEnabled && common.RDB != nil {
		ctx := context.Background()
		members, err := common.RDB.SMembers(ctx, tokenGroupRouteStateIndexKey(tokenID)).Result()
		if err == nil {
			for _, member := range members {
				var ref tokenGroupRouteStateRef
				if common.Unmarshal([]byte(member), &ref) != nil {
					continue
				}
				key := tokenGroupRouteCooldownKey(tokenID, ref.Group, ref.ModelName, ref.RequestPath)
				if ref.Kind == tokenGroupRouteStateSticky {
					key = tokenGroupRouteStickyKey(tokenID, ref.ModelName, ref.RequestPath)
				}
				_ = common.RDB.Del(ctx, key).Err()
				_ = common.RDB.SRem(ctx, tokenGroupRouteStateIndexKey(tokenID), member).Err()
			}
		}
		_ = common.RDB.Del(ctx, tokenGroupRouteStateIndexKey(tokenID)).Err()
	}
	cooldownPrefix := fmt.Sprintf("token_group_route:%d:", tokenID)
	tokenGroupRouteCooldowns.Range(func(key, _ any) bool {
		if value, ok := key.(string); ok && strings.HasPrefix(value, cooldownPrefix) {
			tokenGroupRouteCooldowns.Delete(key)
		}
		return true
	})
	if _, err := getTokenGroupRouteStickyStore().DeleteByToken(tokenID); err != nil {
		common.SysLog("failed to clear token group route affinity: " + err.Error())
	}
}

func ListTokenGroupRouteCooldowns(tokenID int, now int64) []TokenGroupRouteCooldownStatus {
	statuses := make([]TokenGroupRouteCooldownStatus, 0)
	seen := make(map[string]struct{})
	appendStatus := func(ref tokenGroupRouteStateRef, until int64) {
		if until <= now || ref.Kind != tokenGroupRouteStateCooldown || (ref.TokenID != 0 && ref.TokenID != tokenID) {
			return
		}
		key := tokenGroupRouteScope(ref.Group, ref.ModelName, ref.RequestPath)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		statuses = append(statuses, TokenGroupRouteCooldownStatus{Group: ref.Group, ModelName: ref.ModelName, RequestPath: ref.RequestPath, Until: until})
	}
	if common.RedisEnabled && common.RDB != nil {
		members, err := common.RDB.SMembers(context.Background(), tokenGroupRouteStateIndexKey(tokenID)).Result()
		if err == nil {
			for _, member := range members {
				var ref tokenGroupRouteStateRef
				if common.Unmarshal([]byte(member), &ref) != nil || ref.Kind != tokenGroupRouteStateCooldown {
					continue
				}
				appendStatus(ref, GetTokenGroupRouteCooldownUntil(tokenID, ref.Group, ref.ModelName, ref.RequestPath, now))
			}
		}
	}
	tokenGroupRouteCooldowns.Range(func(key, value any) bool {
		if state, ok := value.(tokenGroupRouteCooldownState); ok {
			if state.Until <= now {
				tokenGroupRouteCooldowns.Delete(key)
				return true
			}
			appendStatus(state.tokenGroupRouteStateRef, state.Until)
		}
		return true
	})
	sort.Slice(statuses, func(i, j int) bool {
		if statuses[i].Group != statuses[j].Group {
			return statuses[i].Group < statuses[j].Group
		}
		if statuses[i].ModelName != statuses[j].ModelName {
			return statuses[i].ModelName < statuses[j].ModelName
		}
		return statuses[i].RequestPath < statuses[j].RequestPath
	})
	return statuses
}

func ShouldFreezeTokenGroupRoute(err *types.NewAPIError) bool {
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

func MarkTokenGroupRouteFailure(c *gin.Context, err *types.NewAPIError) bool {
	if !ShouldFreezeTokenGroupRoute(err) {
		return false
	}
	routes := getTokenGroupRoutes(c)
	if len(routes) == 0 {
		return false
	}
	tokenID := common.GetContextKeyInt(c, constant.ContextKeyTokenId)
	group := common.GetContextKeyString(c, constant.ContextKeyTokenGroupRouteGroup)
	modelName := c.GetString(ginKeyTokenGroupRouteModel)
	requestPath := c.GetString(ginKeyTokenGroupRoutePath)
	if tokenID <= 0 || group == "" || modelName == "" {
		return false
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
		return false
	}
	until := FreezeTokenGroupRoute(tokenID, group, modelName, requestPath, cooldownSeconds)
	TrackChannelExecutionGroupEvent(c, group, modelName, requestPath, "cooling", "group_route_failure", until)
	stickyHit := common.GetContextKeyBool(c, constant.ContextKeyTokenGroupRouteStickyHit)
	if IsTokenGroupRouteStickyEnabled(c) {
		clearTokenGroupRouteStickyScope(tokenID, modelName, requestPath)
	}
	index := common.GetContextKeyInt(c, constant.ContextKeyTokenGroupRouteIndex)
	if stickyHit {
		common.SetContextKey(c, constant.ContextKeyTokenGroupRouteIndex, 0)
	} else {
		common.SetContextKey(c, constant.ContextKeyTokenGroupRouteIndex, index+1)
	}
	logger.LogWarn(c, fmt.Sprintf("token group route frozen: token=%d group=%s model=%s path=%s cooldown=%ds until=%d",
		tokenID, group, modelName, requestPath, cooldownSeconds, until))
	return true
}

func MarkTokenGroupRouteSuccess(c *gin.Context) {
	if !HasTokenGroupRoutes(c) {
		return
	}
	tokenID := common.GetContextKeyInt(c, constant.ContextKeyTokenId)
	group := common.GetContextKeyString(c, constant.ContextKeyTokenGroupRouteGroup)
	modelName := c.GetString(ginKeyTokenGroupRouteModel)
	requestPath := c.GetString(ginKeyTokenGroupRoutePath)
	ClearTokenGroupRouteCooldown(tokenID, group, modelName, requestPath)
	if IsTokenGroupRouteStickyEnabled(c) {
		SetTokenGroupRouteStickyGroup(tokenID, modelName, requestPath, group)
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

func setTokenGroupRouteContext(c *gin.Context, index int, route model.TokenGroupRoute, modelName string, requestPath string) {
	common.SetContextKey(c, constant.ContextKeyTokenGroupRouteIndex, index)
	common.SetContextKey(c, constant.ContextKeyTokenGroupRouteGroup, route.Group)
	common.SetContextKey(c, constant.ContextKeyTokenGroupRouteCooldown, route.CooldownSeconds)
	common.SetContextKey(c, constant.ContextKeyTokenGroupRouteStickyHit, false)
	common.SetContextKey(c, constant.ContextKeyUsingGroup, route.Group)
	c.Set(ginKeyTokenGroupRouteModel, modelName)
	c.Set(ginKeyTokenGroupRoutePath, requestPath)
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
	setTokenGroupRouteContext(param.Ctx, index, route, param.ModelName, param.RequestPath)
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
		return nil, "", fmt.Errorf("密钥分组路由规则已全部尝试完毕")
	}

	now := common.GetTimestamp()
	selectGroup := routes[startGroupIndex].Group
	skippedCooldown := false
	if IsTokenGroupRouteStickyEnabled(param.Ctx) && startGroupIndex == 0 {
		stickyGroup := GetTokenGroupRouteStickyGroup(tokenID, param.ModelName, param.RequestPath)
		if stickyGroup != "" {
			stickyIndex := findTokenGroupRouteIndex(routes, stickyGroup)
			if stickyIndex < 0 {
				clearTokenGroupRouteStickyScope(tokenID, param.ModelName, param.RequestPath)
			} else {
				stickyRoute := routes[stickyIndex]
				if IsTokenGroupRouteFrozen(tokenID, stickyRoute.Group, param.ModelName, param.RequestPath, now) {
					skippedCooldown = true
					clearTokenGroupRouteStickyScope(tokenID, param.ModelName, param.RequestPath)
					logger.LogDebug(param.Ctx, "Token group route sticky group is cooling: %s", stickyRoute.Group)
				} else {
					channel, group, err := trySelectTokenGroupRoute(param, stickyRoute, stickyIndex)
					if err != nil {
						return nil, group, err
					}
					if channel != nil {
						common.SetContextKey(param.Ctx, constant.ContextKeyTokenGroupRouteStickyHit, true)
						TrackChannelExecutionGroupAffinityHit(param.Ctx, group, param.ModelName, param.RequestPath, channel.Id)
						return channel, group, nil
					}
					clearTokenGroupRouteStickyScope(tokenID, param.ModelName, param.RequestPath)
					logger.LogDebug(param.Ctx, "Token group route sticky group does not support request, skipped: group=%s model=%s path=%s",
						stickyRoute.Group, param.ModelName, param.RequestPath)
				}
			}
		}
	}

	for i := startGroupIndex; i < len(routes); i++ {
		route := routes[i]
		selectGroup = route.Group
		if IsTokenGroupRouteFrozen(tokenID, route.Group, param.ModelName, param.RequestPath, now) {
			skippedCooldown = true
			TrackChannelExecutionGroupEvent(param.Ctx, route.Group, param.ModelName, param.RequestPath, "skipped", "group_cooling", GetTokenGroupRouteCooldownUntil(tokenID, route.Group, param.ModelName, param.RequestPath, now))
			logger.LogDebug(param.Ctx, "Token group route skipped cooldown group: %s", route.Group)
			continue
		}

		channel, group, err := trySelectTokenGroupRoute(param, route, i)
		if err != nil {
			return nil, group, err
		}
		if channel == nil {
			common.SetContextKey(param.Ctx, constant.ContextKeyTokenGroupRouteIndex, i+1)
			TrackChannelExecutionGroupEvent(param.Ctx, route.Group, param.ModelName, param.RequestPath, "skipped", "group_unsupported", 0)
			logger.LogDebug(param.Ctx, "Token group route group does not support request, skipped: group=%s model=%s path=%s",
				route.Group, param.ModelName, param.RequestPath)
			continue
		}
		return channel, group, nil
	}

	if skippedCooldown {
		return nil, selectGroup, fmt.Errorf("密钥分组路由规则正在冷却，暂无可用分组")
	}
	return nil, selectGroup, nil
}
