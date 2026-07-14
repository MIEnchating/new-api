package controller

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

func buildMaskedTokenResponse(token *model.Token) *model.Token {
	if token == nil {
		return nil
	}
	maskedToken := *token
	maskedToken.Key = token.GetMaskedKey()
	return &maskedToken
}

func buildMaskedTokenResponses(tokens []*model.Token) []*model.Token {
	maskedTokens := make([]*model.Token, 0, len(tokens))
	for _, token := range tokens {
		maskedTokens = append(maskedTokens, buildMaskedTokenResponse(token))
	}
	return maskedTokens
}

func normalizeTokenGroupRouteConfigForUser(userID int, config string) (string, error) {
	normalized, routes, err := model.NormalizeTokenGroupRouteConfig(config)
	if err != nil {
		return "", err
	}
	if len(routes) == 0 {
		return "", nil
	}

	userGroup, err := model.GetUserGroup(userID, false)
	if err != nil {
		return "", err
	}
	usableGroups := service.GetUserUsableGroups(userGroup)
	for _, route := range routes {
		if route.Group == "auto" {
			return "", fmt.Errorf("密钥路由不支持 auto 分组")
		}
		if _, ok := usableGroups[route.Group]; !ok {
			return "", fmt.Errorf("无权访问 %s 分组", route.Group)
		}
		if !ratio_setting.ContainsGroupRatio(route.Group) {
			return "", fmt.Errorf("分组 %s 已被弃用", route.Group)
		}
	}
	return normalized, nil
}

func normalizeTokenGroupForUser(userID int, group string) (string, error) {
	group = strings.TrimSpace(group)
	if group == "" {
		return "", fmt.Errorf("请选择分组")
	}

	userGroup, err := model.GetUserGroup(userID, false)
	if err != nil {
		return "", err
	}
	if _, ok := service.GetUserUsableGroups(userGroup)[group]; !ok {
		return "", fmt.Errorf("无权访问 %s 分组", group)
	}
	if group != "auto" && !ratio_setting.ContainsGroupRatio(group) {
		return "", fmt.Errorf("分组 %s 已被弃用", group)
	}
	return group, nil
}

func GetAllTokens(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	tokens, err := model.GetAllUserTokens(userId, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	total, _ := model.CountUserTokens(userId)
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(buildMaskedTokenResponses(tokens))
	common.ApiSuccess(c, pageInfo)
}

func SearchTokens(c *gin.Context) {
	userId := c.GetInt("id")
	keyword := c.Query("keyword")
	token := c.Query("token")

	pageInfo := common.GetPageQuery(c)

	tokens, total, err := model.SearchUserTokens(userId, keyword, token, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(buildMaskedTokenResponses(tokens))
	common.ApiSuccess(c, pageInfo)
}

func GetToken(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := model.GetTokenByIds(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, buildMaskedTokenResponse(token))
}

func getTokenModelGroups(token *model.Token) ([]string, error) {
	_, routes, err := model.NormalizeTokenGroupRouteConfig(token.GroupRouteConfig)
	if err != nil {
		return nil, err
	}
	if len(routes) > 0 {
		groups := make([]string, 0, len(routes))
		for _, route := range routes {
			groups = append(groups, route.Group)
		}
		return groups, nil
	}

	if token.Group != "" && token.Group != "auto" {
		return []string{token.Group}, nil
	}

	userGroup, err := model.GetUserGroup(token.UserId, false)
	if err != nil {
		return nil, err
	}
	if token.Group == "auto" {
		return service.GetUserAutoGroup(userGroup), nil
	}
	return []string{userGroup}, nil
}

func getTokenModels(token *model.Token) ([]string, error) {
	groups, err := getTokenModelGroups(token)
	if err != nil {
		return nil, err
	}

	modelLimits := make(map[string]struct{})
	if token.ModelLimitsEnabled {
		for _, modelName := range token.GetModelLimits() {
			modelName = strings.TrimSpace(modelName)
			if modelName != "" {
				modelLimits[modelName] = struct{}{}
			}
		}
	}

	seen := make(map[string]struct{})
	models := make([]string, 0)
	for _, group := range groups {
		for _, modelName := range model.GetGroupEnabledModels(group) {
			modelName = strings.TrimSpace(modelName)
			if modelName == "" {
				continue
			}
			if token.ModelLimitsEnabled {
				if _, ok := modelLimits[modelName]; !ok {
					continue
				}
			}
			if _, ok := seen[modelName]; ok {
				continue
			}
			seen[modelName] = struct{}{}
			models = append(models, modelName)
		}
	}
	sort.Strings(models)
	return models, nil
}

func GetTokenModels(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := model.GetTokenByIds(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	models, err := getTokenModels(token)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, models)
}

type tokenGroupRouteStatus struct {
	Group                    string `json:"group"`
	Model                    string `json:"model,omitempty"`
	RequestPath              string `json:"request_path,omitempty"`
	Status                   string `json:"status"`
	Cooling                  bool   `json:"cooling"`
	CooldownUntil            int64  `json:"cooldown_until,omitempty"`
	CooldownRemainingSeconds int64  `json:"cooldown_remaining_seconds,omitempty"`
}

func GetTokenRouteStatus(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := model.GetTokenByIds(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	_, routes, err := model.NormalizeTokenGroupRouteConfig(token.GroupRouteConfig)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	now := common.GetTimestamp()
	cooldowns := service.ListTokenGroupRouteCooldowns(token.Id, now)
	cooldownsByGroup := make(map[string][]service.TokenGroupRouteCooldownStatus, len(routes))
	for _, cooldown := range cooldowns {
		cooldownsByGroup[cooldown.Group] = append(cooldownsByGroup[cooldown.Group], cooldown)
	}
	statuses := make([]tokenGroupRouteStatus, 0, len(routes)+len(cooldowns))
	for _, route := range routes {
		groupCooldowns := cooldownsByGroup[route.Group]
		if len(groupCooldowns) == 0 {
			statuses = append(statuses, tokenGroupRouteStatus{Group: route.Group, Status: "normal"})
			continue
		}
		for _, cooldown := range groupCooldowns {
			statuses = append(statuses, tokenGroupRouteStatus{
				Group:                    route.Group,
				Model:                    cooldown.ModelName,
				RequestPath:              cooldown.RequestPath,
				Status:                   "cooling",
				Cooling:                  true,
				CooldownUntil:            cooldown.Until,
				CooldownRemainingSeconds: cooldown.Until - now,
			})
		}
	}
	common.ApiSuccess(c, statuses)
}

func GetTokenKey(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := model.GetTokenByIds(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"key": token.GetFullKey(),
	})
}

func GetTokenStatus(c *gin.Context) {
	tokenId := c.GetInt("token_id")
	userId := c.GetInt("id")
	token, err := model.GetTokenByIds(tokenId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	expiredAt := token.ExpiredTime
	if expiredAt == -1 {
		expiredAt = 0
	}
	c.JSON(http.StatusOK, gin.H{
		"object":          "credit_summary",
		"total_granted":   token.RemainQuota,
		"total_used":      0, // not supported currently
		"total_available": token.RemainQuota,
		"expires_at":      expiredAt * 1000,
	})
}

func GetTokenUsage(c *gin.Context) {
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "No Authorization header",
		})
		return
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "Invalid Bearer token",
		})
		return
	}
	tokenKey := parts[1]

	token, err := model.GetTokenByKey(strings.TrimPrefix(tokenKey, "sk-"), false)
	if err != nil {
		common.SysError("failed to get token by key: " + err.Error())
		common.ApiErrorI18n(c, i18n.MsgTokenGetInfoFailed)
		return
	}

	expiredAt := token.ExpiredTime
	if expiredAt == -1 {
		expiredAt = 0
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    true,
		"message": "ok",
		"data": gin.H{
			"object":               "token_usage",
			"name":                 token.Name,
			"total_granted":        token.RemainQuota + token.UsedQuota,
			"total_used":           token.UsedQuota,
			"total_available":      token.RemainQuota,
			"unlimited_quota":      token.UnlimitedQuota,
			"model_limits":         token.GetModelLimitsMap(),
			"model_limits_enabled": token.ModelLimitsEnabled,
			"expires_at":           expiredAt,
		},
	})
}

func AddToken(c *gin.Context) {
	token := model.Token{}
	err := c.ShouldBindJSON(&token)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(token.Name) > 50 {
		common.ApiErrorI18n(c, i18n.MsgTokenNameTooLong)
		return
	}
	// 非无限额度时，检查额度值是否超出有效范围
	if !token.UnlimitedQuota {
		if token.RemainQuota < 0 {
			common.ApiErrorI18n(c, i18n.MsgTokenQuotaNegative)
			return
		}
		maxQuotaValue := int((1000000000 * common.QuotaPerUnit))
		if token.RemainQuota > maxQuotaValue {
			common.ApiErrorI18n(c, i18n.MsgTokenQuotaExceedMax, map[string]any{"Max": maxQuotaValue})
			return
		}
	}
	groupRouteConfig, err := normalizeTokenGroupRouteConfigForUser(c.GetInt("id"), token.GroupRouteConfig)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if groupRouteConfig != "" {
		token.Group = ""
		token.CrossGroupRetry = false
	} else {
		token.Group, err = normalizeTokenGroupForUser(c.GetInt("id"), token.Group)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		token.GroupRouteSticky = false
	}
	// 检查用户令牌数量是否已达上限
	maxTokens := operation_setting.GetMaxUserTokens()
	count, err := model.CountUserTokens(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if int(count) >= maxTokens {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": fmt.Sprintf("已达到最大令牌数量限制 (%d)", maxTokens),
		})
		return
	}
	key, err := common.GenerateKey()
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgTokenGenerateFailed)
		common.SysLog("failed to generate token key: " + err.Error())
		return
	}
	cleanToken := model.Token{
		UserId:             c.GetInt("id"),
		Name:               token.Name,
		Key:                key,
		CreatedTime:        common.GetTimestamp(),
		AccessedTime:       common.GetTimestamp(),
		ExpiredTime:        token.ExpiredTime,
		RemainQuota:        token.RemainQuota,
		UnlimitedQuota:     token.UnlimitedQuota,
		ModelLimitsEnabled: token.ModelLimitsEnabled,
		ModelLimits:        token.ModelLimits,
		AllowIps:           token.AllowIps,
		Group:              token.Group,
		CrossGroupRetry:    token.CrossGroupRetry,
		GroupRouteConfig:   groupRouteConfig,
		GroupRouteSticky:   token.GroupRouteSticky,
	}
	err = cleanToken.Insert()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

func DeleteToken(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	err := model.DeleteTokenById(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	service.ClearTokenGroupRouteState(id)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

func UpdateToken(c *gin.Context) {
	userId := c.GetInt("id")
	statusOnly := c.Query("status_only")
	token := model.Token{}
	err := c.ShouldBindJSON(&token)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(token.Name) > 50 {
		common.ApiErrorI18n(c, i18n.MsgTokenNameTooLong)
		return
	}
	if !token.UnlimitedQuota {
		if token.RemainQuota < 0 {
			common.ApiErrorI18n(c, i18n.MsgTokenQuotaNegative)
			return
		}
		maxQuotaValue := int((1000000000 * common.QuotaPerUnit))
		if token.RemainQuota > maxQuotaValue {
			common.ApiErrorI18n(c, i18n.MsgTokenQuotaExceedMax, map[string]any{"Max": maxQuotaValue})
			return
		}
	}
	cleanToken, err := model.GetTokenByIds(token.Id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if token.Status == common.TokenStatusEnabled {
		if cleanToken.Status == common.TokenStatusExpired && cleanToken.ExpiredTime <= common.GetTimestamp() && cleanToken.ExpiredTime != -1 {
			common.ApiErrorI18n(c, i18n.MsgTokenExpiredCannotEnable)
			return
		}
		if cleanToken.Status == common.TokenStatusExhausted && cleanToken.RemainQuota <= 0 && !cleanToken.UnlimitedQuota {
			common.ApiErrorI18n(c, i18n.MsgTokenExhaustedCannotEable)
			return
		}
	}
	if statusOnly != "" {
		cleanToken.Status = token.Status
	} else {
		groupRouteConfig, err := normalizeTokenGroupRouteConfigForUser(userId, token.GroupRouteConfig)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if groupRouteConfig != "" {
			token.Group = ""
			token.CrossGroupRetry = false
		} else {
			token.Group, err = normalizeTokenGroupForUser(userId, token.Group)
			if err != nil {
				common.ApiError(c, err)
				return
			}
			token.GroupRouteSticky = false
		}
		// If you add more fields, please also update token.Update()
		cleanToken.Name = token.Name
		cleanToken.ExpiredTime = token.ExpiredTime
		cleanToken.RemainQuota = token.RemainQuota
		cleanToken.UnlimitedQuota = token.UnlimitedQuota
		cleanToken.ModelLimitsEnabled = token.ModelLimitsEnabled
		cleanToken.ModelLimits = token.ModelLimits
		cleanToken.AllowIps = token.AllowIps
		cleanToken.Group = token.Group
		cleanToken.CrossGroupRetry = token.CrossGroupRetry
		cleanToken.GroupRouteConfig = groupRouteConfig
		cleanToken.GroupRouteSticky = token.GroupRouteSticky
	}
	err = cleanToken.Update()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if statusOnly == "" {
		service.ClearTokenGroupRouteState(cleanToken.Id)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    buildMaskedTokenResponse(cleanToken),
	})
}

type TokenBatch struct {
	Ids []int `json:"ids"`
}

func DeleteTokenBatch(c *gin.Context) {
	tokenBatch := TokenBatch{}
	if err := c.ShouldBindJSON(&tokenBatch); err != nil || len(tokenBatch.Ids) == 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	userId := c.GetInt("id")
	count, err := model.BatchDeleteTokens(tokenBatch.Ids, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for _, id := range tokenBatch.Ids {
		service.ClearTokenGroupRouteState(id)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    count,
	})
}

func GetTokenKeysBatch(c *gin.Context) {
	tokenBatch := TokenBatch{}
	if err := c.ShouldBindJSON(&tokenBatch); err != nil || len(tokenBatch.Ids) == 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if len(tokenBatch.Ids) > 100 {
		common.ApiErrorI18n(c, i18n.MsgBatchTooMany, map[string]any{"Max": 100})
		return
	}
	userId := c.GetInt("id")
	tokens, err := model.GetTokenKeysByIds(tokenBatch.Ids, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	keysMap := make(map[int]string)
	for _, t := range tokens {
		keysMap[t.Id] = t.GetFullKey()
	}
	common.ApiSuccess(c, gin.H{"keys": keysMap})
}
