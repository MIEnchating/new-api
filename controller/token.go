package controller

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

type tokenAutoGroupsInput struct {
	Set    bool
	Groups []string
}

func (input *tokenAutoGroupsInput) UnmarshalJSON(data []byte) error {
	input.Set = true
	if strings.TrimSpace(string(data)) == "null" {
		input.Groups = nil
		return nil
	}
	return common.Unmarshal(data, &input.Groups)
}

type tokenRequest struct {
	model.Token
	AutoGroups tokenAutoGroupsInput `json:"auto_groups"`
}

type tokenResponse struct {
	*model.Token
	AutoGroups []string `json:"auto_groups"`
}

func buildMaskedTokenResponse(token *model.Token) *tokenResponse {
	if token == nil {
		return nil
	}
	maskedToken := *token
	maskedToken.Key = token.GetMaskedKey()
	autoGroups, err := token.GetAutoGroups()
	if err != nil {
		common.SysError(fmt.Sprintf("failed to parse auto groups for token %d: %v", token.Id, err))
		autoGroups = nil
	}
	if len(autoGroups) == 0 {
		autoGroups = nil
	}
	return &tokenResponse{Token: &maskedToken, AutoGroups: autoGroups}
}

func buildMaskedTokenResponses(tokens []*model.Token) []*tokenResponse {
	maskedTokens := make([]*tokenResponse, 0, len(tokens))
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
	activeRoutes := model.EnabledTokenGroupRoutes(routes)
	if len(activeRoutes) == 0 {
		return "", fmt.Errorf("请至少启用一条分组路由规则")
	}

	userGroup, err := model.GetUserGroup(userID, false)
	if err != nil {
		return "", err
	}
	usableGroups := service.GetUserUsableGroups(userGroup)
	for _, route := range activeRoutes {
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
	if group == "auto" {
		return group, nil
	}

	userGroup, err := model.GetUserGroup(userID, false)
	if err != nil {
		return "", err
	}
	if _, ok := service.GetUserUsableGroups(userGroup)[group]; !ok {
		return "", fmt.Errorf("无权访问 %s 分组", group)
	}
	if !ratio_setting.ContainsGroupRatio(group) {
		return "", fmt.Errorf("分组 %s 已被弃用", group)
	}
	return group, nil
}

func getTokenRequestUserGroup(c *gin.Context) (string, error) {
	if userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup); userGroup != "" {
		return userGroup, nil
	}
	if userGroup := c.GetString("group"); userGroup != "" {
		return userGroup, nil
	}
	return model.GetUserGroup(c.GetInt("id"), false)
}

func setTokenAutoGroups(c *gin.Context, token *model.Token, groups []string) bool {
	if len(groups) == 0 {
		if err := token.SetAutoGroups(nil); err != nil {
			common.ApiError(c, err)
			return false
		}
		return true
	}

	maxCount := setting.GetMaxTokenAutoGroups()
	if len(groups) > maxCount {
		common.ApiErrorI18n(c, i18n.MsgTokenAutoGroupsTooMany, map[string]any{"Max": maxCount})
		return false
	}

	userGroup, err := getTokenRequestUserGroup(c)
	if err != nil {
		common.ApiError(c, err)
		return false
	}
	seen := make(map[string]struct{}, len(groups))
	for _, group := range groups {
		if _, ok := seen[group]; ok {
			common.ApiErrorI18n(c, i18n.MsgTokenAutoGroupsDuplicate, map[string]any{"Group": group})
			return false
		}
		seen[group] = struct{}{}
		if !service.IsUserSelectableGroup(userGroup, group) {
			common.ApiErrorI18n(c, i18n.MsgTokenAutoGroupsInvalid, map[string]any{"Group": group})
			return false
		}
	}

	if err := token.SetAutoGroups(groups); err != nil {
		common.ApiError(c, err)
		return false
	}
	return true
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
	hasConfiguredRoutes := len(routes) > 0
	routes = model.EnabledTokenGroupRoutes(routes)
	if len(routes) > 0 {
		groups := make([]string, 0, len(routes))
		for _, route := range routes {
			groups = append(groups, route.Group)
		}
		return groups, nil
	}
	if hasConfiguredRoutes {
		return []string{}, nil
	}

	if token.Group != "" && token.Group != "auto" {
		return []string{token.Group}, nil
	}

	userGroup, err := model.GetUserGroup(token.UserId, false)
	if err != nil {
		return nil, err
	}
	if token.Group == "auto" {
		autoGroups, err := token.GetAutoGroups()
		if err != nil {
			return nil, err
		}
		if len(autoGroups) > 0 {
			return service.FilterUserTokenAutoGroups(userGroup, autoGroups), nil
		}
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

func ClearTokenRouteCooldown(c *gin.Context) {
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

	requestedGroup := strings.TrimSpace(c.Query("group"))
	if requestedGroup != "" {
		_, routes, err := model.NormalizeTokenGroupRouteConfig(token.GroupRouteConfig)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		found := false
		for _, route := range routes {
			if route.Group == requestedGroup {
				found = true
				break
			}
		}
		if !found {
			common.ApiErrorMsg(c, "密钥不属于指定的路由分组")
			return
		}
	}

	cooldowns := service.ListTokenGroupRouteCooldowns(token.Id, common.GetTimestamp())
	cleared := 0
	for _, cooldown := range cooldowns {
		if requestedGroup != "" && cooldown.Group != requestedGroup {
			continue
		}
		service.ClearTokenGroupRouteCooldown(
			token.Id,
			cooldown.Group,
			cooldown.ModelName,
			cooldown.RequestPath,
		)
		cleared++
	}
	common.ApiSuccess(c, gin.H{
		"token_id": token.Id,
		"group":    requestedGroup,
		"cleared":  cleared,
	})
}

func GetTokenAutoGroups(c *gin.Context) {
	userGroup, err := getTokenRequestUserGroup(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"groups":    service.GetUserAutoGroup(userGroup),
		"max_count": setting.GetMaxTokenAutoGroups(),
	})
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
	tokenID := c.GetInt("token_id")
	if tokenID <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": common.TranslateMessage(c, i18n.MsgTokenInvalid),
		})
		return
	}

	// TokenAuthReadOnly already normalizes API-key suffixes and authenticates the
	// token. Resolve by that authenticated ID instead of parsing the header again.
	token, err := model.GetTokenById(tokenID)
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
		"data": buildTokenUsageData(
			token,
			common.GetContextKeyInt(c, constant.ContextKeyUserQuota),
			expiredAt,
			buildTokenUsageLabels(c),
		),
	})
}

func buildTokenUsageLabels(c *gin.Context) gin.H {
	return gin.H{
		"account_balance": i18n.T(c, "usage.account_balance"),
		"key_quota":       i18n.T(c, "usage.key_quota"),
		"api_key":         i18n.T(c, "usage.api_key"),
	}
}

func buildTokenUsageData(token *model.Token, accountQuota int, expiredAt int64, labels gin.H) gin.H {
	return gin.H{
		"object":         "token_usage",
		"labels":         labels,
		"quota_per_unit": common.QuotaPerUnit,
		"account": gin.H{
			"total_available": accountQuota,
		},
		"name":                 token.Name,
		"total_granted":        token.RemainQuota + token.UsedQuota,
		"total_used":           token.UsedQuota,
		"total_available":      token.RemainQuota,
		"unlimited_quota":      token.UnlimitedQuota,
		"model_limits":         token.GetModelLimitsMap(),
		"model_limits_enabled": token.ModelLimitsEnabled,
		"expires_at":           expiredAt,
	}
}

func AddToken(c *gin.Context) {
	request := tokenRequest{}
	err := c.ShouldBindJSON(&request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token := request.Token
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
	if token.Group == "auto" {
		if !setTokenAutoGroups(c, &token, request.AutoGroups.Groups) {
			return
		}
	} else {
		token.CrossGroupRetry = false
		_ = token.SetAutoGroups(nil)
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
		AutoGroups:         token.AutoGroups,
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
	request := tokenRequest{}
	err := c.ShouldBindJSON(&request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token := request.Token
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
		if token.Group != "auto" {
			cleanToken.CrossGroupRetry = false
			_ = cleanToken.SetAutoGroups(nil)
		} else if request.AutoGroups.Set {
			if !setTokenAutoGroups(c, cleanToken, request.AutoGroups.Groups) {
				return
			}
		}
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
