package controller

import (
	"fmt"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
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
	// 指针区分“未传”和显式 false：新建时未传即开启，更新时未传则保留原值。
	AllowUserQuotaQuery *bool   `json:"allow_user_quota_query"`
	RoutingTemplateID   *string `json:"routing_template_id"`
}

type tokenResponse struct {
	RoutingTemplateName string `json:"routing_template_name"`
	*model.Token
	AutoGroups               []string `json:"auto_groups"`
	RoutingTemplateAvailable bool     `json:"routing_template_available"`
}

func maxTokenQuota() int {
	quota, err := common.WalletQuotaFromDecimalStrict(
		decimal.NewFromInt(1_000_000_000).Mul(decimal.NewFromFloat(common.QuotaPerUnit)),
	)
	if err != nil {
		return common.MaxWalletQuota
	}
	return quota
}

func buildMaskedTokenResponse(token *model.Token) *tokenResponse {
	if token == nil {
		return nil
	}
	effective, resolveErr := token.ResolveRoutingTemplate()
	if resolveErr != nil {
		fallback := *token
		fallback.Group, fallback.GroupRouteConfig, fallback.ModelLimits = "", "", ""
		fallback.ModelLimitsEnabled = true
		effective = &fallback
	}
	maskedToken := *effective
	maskedToken.Key = token.GetMaskedKey()
	autoGroups, err := effective.GetAutoGroups()
	if err != nil {
		common.SysError(common.LogText("failed to parse auto groups for token %d: %v", token.Id, err))
		autoGroups = nil
	}
	if len(autoGroups) == 0 {
		autoGroups = nil
	}
	response := &tokenResponse{Token: &maskedToken, AutoGroups: autoGroups, RoutingTemplateAvailable: resolveErr == nil}
	if token.RoutingTemplateID != "" {
		if templates, userErr := getUserRoutingTemplates(token.UserId); userErr == nil {
			for _, template := range templates {
				if template.ID == token.RoutingTemplateID {
					response.RoutingTemplateName = template.Name
					return response
				}
			}
		}
		for _, template := range operation_setting.CurrentSmartRoutingSetting().Templates {
			if template.ID == token.RoutingTemplateID {
				response.RoutingTemplateName = template.Name
				break
			}
		}
	}
	return response
}

func buildMaskedTokenResponses(tokens []*model.Token) []*tokenResponse {
	maskedTokens := make([]*tokenResponse, 0, len(tokens))
	for _, token := range tokens {
		maskedTokens = append(maskedTokens, buildMaskedTokenResponse(token))
	}
	return maskedTokens
}

func applyTokenRoutingTemplate(token *model.Token) error {
	if token.RoutingTemplateID == "" {
		return nil
	}
	effective, err := token.ResolveRoutingTemplate()
	if err != nil {
		return err
	}
	if _, err := normalizeTokenGroupRouteConfigForUser(token.UserId, effective.GroupRouteConfig); err != nil {
		return err
	}
	*token = *effective
	return nil
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

func GetTokenSmartRoutingTemplates(c *gin.Context) {
	userID := c.GetInt("id")
	userGroup, err := model.GetUserGroup(userID, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	userTemplates, err := getUserRoutingTemplates(userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if c.Query("owned") == "true" {
		common.ApiSuccess(c, gin.H{
			"templates":          userTemplates,
			"max_user_templates": userSmartRoutingTemplateLimit(),
		})
		return
	}

	templates := make([]operation_setting.SmartRoutingTemplate, 0, len(userTemplates))
	for _, template := range userTemplates {
		if !template.Enabled || len(template.GroupRoutes) == 0 || !userTemplateUsesUsableGroups(userGroup, template) {
			continue
		}
		templates = append(templates, template)
	}
	setting := operation_setting.CurrentSmartRoutingSetting()
	if !setting.Enabled {
		common.ApiSuccess(c, templates)
		return
	}
	for _, template := range setting.Templates {
		if !template.Enabled || len(template.GroupRoutes) == 0 {
			continue
		}
		if userTemplateUsesUsableGroups(userGroup, template) {
			templates = append(templates, template)
		}
	}

	common.ApiSuccess(c, templates)
}

func userSmartRoutingTemplateLimit() int {
	limit := operation_setting.CurrentSmartRoutingSetting().MaxUserTemplates
	if limit < 1 {
		return operation_setting.DefaultMaxUserSmartRoutingTemplates
	}
	return limit
}

func getUserRoutingTemplates(userID int) ([]operation_setting.SmartRoutingTemplate, error) {
	settings, err := model.GetUserSetting(userID, false)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(settings.SmartRoutingTemplates) == "" {
		return []operation_setting.SmartRoutingTemplate{}, nil
	}
	var templates []operation_setting.SmartRoutingTemplate
	if err := common.UnmarshalJsonStr(settings.SmartRoutingTemplates, &templates); err != nil {
		return nil, fmt.Errorf("用户路由模板格式错误: %w", err)
	}
	for index := range templates {
		templates[index].UserOwned = true
	}
	return templates, nil
}

func userTemplateUsesUsableGroups(userGroup string, template operation_setting.SmartRoutingTemplate) bool {
	for _, route := range template.GroupRoutes {
		if route.IsEnabled() && !service.IsUserSelectableGroup(userGroup, route.Group) {
			return false
		}
	}
	return true
}

func UpdateUserSmartRoutingTemplates(c *gin.Context) {
	var request struct {
		Templates []operation_setting.SmartRoutingTemplate `json:"templates"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := operation_setting.ValidateSmartRoutingTemplates(request.Templates); err != nil {
		common.ApiError(c, err)
		return
	}
	if len(request.Templates) > userSmartRoutingTemplateLimit() {
		common.ApiErrorT(c, "A user can create at most {{max}} routing templates", map[string]any{
			"max": userSmartRoutingTemplateLimit(),
		})
		return
	}
	userID := c.GetInt("id")
	userGroup, err := model.GetUserGroup(userID, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	global := operation_setting.CurrentSmartRoutingSetting()
	globalIDs := make(map[string]struct{}, len(global.Templates))
	for _, template := range global.Templates {
		globalIDs[template.ID] = struct{}{}
	}
	for index := range request.Templates {
		template := &request.Templates[index]
		template.UserOwned = false
		if _, exists := globalIDs[template.ID]; exists {
			common.ApiErrorT(c, "Template identifiers must be unique")
			return
		}
		for _, route := range template.GroupRoutes {
			if route.IsEnabled() && !service.IsUserSelectableGroup(userGroup, route.Group) {
				common.ApiErrorT(c, "No permission to access {{group}} group", map[string]any{"group": route.Group})
				return
			}
		}
	}
	encoded, err := common.Marshal(request.Templates)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	settings, err := model.GetUserSetting(userID, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	settings.SmartRoutingTemplates = string(encoded)
	if err := model.UpdateUserSetting(userID, settings); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, request.Templates)
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
		common.ApiErrorT(c, "A token can select at most {{max}} Auto groups", map[string]any{"max": maxCount})
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
			common.ApiErrorT(c, "Auto group {{group}} is duplicated", map[string]any{"group": group})
			return false
		}
		seen[group] = struct{}{}
		if !service.IsUserSelectableGroup(userGroup, group) {
			common.ApiErrorT(c, "Auto group {{group}} is unavailable or unauthorized", map[string]any{"group": group})
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
	effective, err := token.ResolveRoutingTemplate()
	if err != nil {
		return nil, err
	}
	token = effective
	if token.RoutingTemplateID != "" {
		if _, err := normalizeTokenGroupRouteConfigForUser(token.UserId, token.GroupRouteConfig); err != nil {
			return nil, err
		}
	}
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
	token, err = token.ResolveRoutingTemplate()
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

type updateTokenGroupRoutesRequest struct {
	GroupRouteConfig string `json:"group_route_config"`
}

func UpdateTokenGroupRoutes(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	request := updateTokenGroupRoutesRequest{}
	if err = c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}

	userID := c.GetInt("id")
	token, err := model.GetTokenByIds(id, userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if token.RoutingTemplateID != "" {
		common.ApiErrorT(c, "Detach the routing template before editing routes")
		return
	}
	normalized, err := normalizeTokenGroupRouteConfigForUser(userID, request.GroupRouteConfig)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if normalized == "" {
		common.ApiErrorMsg(c, "请至少添加一条分组路由规则")
		return
	}

	token.GroupRouteConfig = normalized
	if err = token.UpdateGroupRouteConfig(); err != nil {
		common.ApiError(c, err)
		return
	}
	service.ClearTokenGroupRouteState(token.Id)
	common.ApiSuccess(c, buildMaskedTokenResponse(token))
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
	params := tokenAuditParams(c)
	params["id"], params["name"] = token.Id, token.Name
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, gin.H{
		"key": token.GetFullKey(),
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
		common.SysError(common.LogText("failed to get token by key: %s", err.Error()))
		common.ApiErrorI18n(c, i18n.MsgTokenGetInfoFailed)
		return
	}

	expiredAt := token.ExpiredTime
	if expiredAt == -1 {
		expiredAt = 0
	}

	var userQuota, userUsedQuota int
	// 用户额度只在令牌允许时返回；IP 白名单已由 TokenAuthReadOnly 检查。
	if token.AllowUserQuotaQuery {
		userQuota, err = model.GetUserQuota(token.UserId, false)
		if err == nil {
			userUsedQuota, err = model.GetUserUsedQuota(token.UserId)
		}
		if err != nil {
			common.SysError(common.LogText("failed to get user quota: %s", err.Error()))
			common.ApiErrorI18n(c, i18n.MsgTokenGetInfoFailed)
			return
		}
	}
	data := buildTokenUsageData(token, userQuota, expiredAt, buildTokenUsageLabels(c))
	if token.AllowUserQuotaQuery {
		data["user_quota"] = gin.H{
			"total_available": userQuota,
			"total_used":      userUsedQuota,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    true,
		"message": "ok",
		"data":    data,
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
	if effective, err := token.ResolveRoutingTemplate(); err == nil {
		token = effective
	} else {
		unavailable := *token
		unavailable.ModelLimitsEnabled, unavailable.ModelLimits = true, ""
		token = &unavailable
	}
	data := gin.H{
		"object":               "token_usage",
		"labels":               labels,
		"quota_per_unit":       common.QuotaPerUnit,
		"name":                 token.Name,
		"total_granted":        token.RemainQuota + token.UsedQuota,
		"total_used":           token.UsedQuota,
		"total_available":      token.RemainQuota,
		"unlimited_quota":      token.UnlimitedQuota,
		"model_limits":         token.GetModelLimitsMap(),
		"model_limits_enabled": token.ModelLimitsEnabled,
		"expires_at":           expiredAt,
	}
	// Keep the legacy account field behind the same permission as user_quota.
	if token.AllowUserQuotaQuery {
		data["account"] = gin.H{"total_available": accountQuota}
	}
	return data
}

func AddToken(c *gin.Context) {
	request := tokenRequest{}
	err := c.ShouldBindJSON(&request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token := request.Token
	token.UserId = c.GetInt("id")
	if request.RoutingTemplateID != nil {
		token.RoutingTemplateID = *request.RoutingTemplateID
	}
	if err := applyTokenRoutingTemplate(&token); err != nil {
		common.ApiError(c, err)
		return
	}
	if len(token.Name) > 50 {
		common.ApiErrorT(c, "Token name is too long")
		return
	}
	params := tokenAuditParams(c)
	params["name"] = token.Name
	// 非无限额度时，检查额度值是否超出有效范围
	if !token.UnlimitedQuota {
		if token.RemainQuota < 0 {
			common.ApiErrorT(c, "Quota value cannot be negative")
			return
		}
		maxQuotaValue := maxTokenQuota()
		if token.RemainQuota > maxQuotaValue {
			common.ApiErrorT(c, "Quota value exceeds valid range, maximum is {{max}}", map[string]any{"max": logger.FormatQuota(maxQuotaValue)})
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
		common.ApiErrorT(c, "Maximum number of tokens reached ({{max}})", map[string]any{"max": maxTokens})
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
		common.ApiErrorT(c, "Failed to generate token")
		common.SysLog(common.LogText("failed to generate token key: %s", err.Error()))
		return
	}
	cleanToken := model.Token{
		UserId:             c.GetInt("id"),
		RoutingTemplateID:  token.RoutingTemplateID,
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
	cleanToken.AllowUserQuotaQuery = request.AllowUserQuotaQuery == nil || *request.AllowUserQuotaQuery
	err = cleanToken.Insert()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	params["id"] = cleanToken.Id
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

func DeleteToken(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	token, err := model.GetTokenByIds(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	params := tokenAuditParams(c)
	params["id"], params["name"] = token.Id, token.Name
	err = token.Delete()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	service.ClearTokenGroupRouteState(id)
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
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
	params := tokenAuditParams(c)
	if token.Id > 0 {
		params["id"] = token.Id
	}
	if len(token.Name) > 50 {
		common.ApiErrorT(c, "Token name is too long")
		return
	}
	if !token.UnlimitedQuota {
		if token.RemainQuota < 0 {
			common.ApiErrorT(c, "Quota value cannot be negative")
			return
		}
		maxQuotaValue := maxTokenQuota()
		if token.RemainQuota > maxQuotaValue {
			common.ApiErrorT(c, "Quota value exceeds valid range, maximum is {{max}}", map[string]any{"max": logger.FormatQuota(maxQuotaValue)})
			return
		}
	}
	cleanToken, err := model.GetTokenByIds(token.Id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	params["name"] = cleanToken.Name
	previous := *cleanToken
	if token.Status == common.TokenStatusEnabled {
		if cleanToken.Status == common.TokenStatusExpired && cleanToken.ExpiredTime <= common.GetTimestamp() && cleanToken.ExpiredTime != -1 {
			common.ApiErrorT(c, "Token has expired and cannot be enabled. Please modify the expiration time or set it to never expire")
			return
		}
		if cleanToken.Status == common.TokenStatusExhausted && cleanToken.RemainQuota <= 0 && !cleanToken.UnlimitedQuota {
			common.ApiErrorT(c, "Token quota is exhausted and cannot be enabled. Please modify the remaining quota or set it to unlimited")
			return
		}
	}
	if statusOnly != "" {
		cleanToken.Status = token.Status
	} else {
		token.UserId = userId
		token.RoutingTemplateID = cleanToken.RoutingTemplateID
		if request.RoutingTemplateID != nil {
			token.RoutingTemplateID = *request.RoutingTemplateID
		}
		if err := applyTokenRoutingTemplate(&token); err != nil {
			common.ApiError(c, err)
			return
		}
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
		if request.AllowUserQuotaQuery != nil {
			cleanToken.AllowUserQuotaQuery = *request.AllowUserQuotaQuery
		}
		cleanToken.Group = token.Group
		cleanToken.CrossGroupRetry = token.CrossGroupRetry
		cleanToken.RoutingTemplateID = token.RoutingTemplateID
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
	params["name"] = cleanToken.Name
	if statusOnly != "" {
		params["from"], params["to"] = previous.Status, cleanToken.Status
	} else {
		changedFields := []string{}
		for _, field := range []struct {
			name    string
			changed bool
		}{
			{"name", previous.Name != cleanToken.Name},
			{"expired_time", previous.ExpiredTime != cleanToken.ExpiredTime},
			{"remain_quota", previous.RemainQuota != cleanToken.RemainQuota},
			{"unlimited_quota", previous.UnlimitedQuota != cleanToken.UnlimitedQuota},
			{"model_limits_enabled", previous.ModelLimitsEnabled != cleanToken.ModelLimitsEnabled},
			{"model_limits", previous.ModelLimits != cleanToken.ModelLimits},
			{"allow_ips", (previous.AllowIps == nil) != (cleanToken.AllowIps == nil) ||
				(previous.AllowIps != nil && cleanToken.AllowIps != nil && *previous.AllowIps != *cleanToken.AllowIps)},
			{"allow_user_quota_query", previous.AllowUserQuotaQuery != cleanToken.AllowUserQuotaQuery},
			{"group", previous.Group != cleanToken.Group},
			{"routing_template_id", previous.RoutingTemplateID != cleanToken.RoutingTemplateID},
			{"cross_group_retry", previous.CrossGroupRetry != cleanToken.CrossGroupRetry},
			{"auto_groups", previous.AutoGroups != cleanToken.AutoGroups},
		} {
			if field.changed {
				changedFields = append(changedFields, field.name)
			}
		}
		params["changed_fields"] = changedFields
		service.ClearTokenGroupRouteState(cleanToken.Id)
	}
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    buildMaskedTokenResponse(cleanToken),
	})
}

type TokenBatch struct {
	Ids []int `json:"ids"`
}

type tokenBatchUpdateFields struct {
	RoutingTemplateID   *string              `json:"routing_template_id"`
	Name                *string              `json:"name"`
	Status              *int                 `json:"status"`
	ExpiredTime         *int64               `json:"expired_time"`
	RemainQuota         *int                 `json:"remain_quota"`
	UnlimitedQuota      *bool                `json:"unlimited_quota"`
	ModelLimitsEnabled  *bool                `json:"model_limits_enabled"`
	ModelLimits         *string              `json:"model_limits"`
	AllowIps            *string              `json:"allow_ips"`
	AllowUserQuotaQuery *bool                `json:"allow_user_quota_query"`
	Group               *string              `json:"group"`
	CrossGroupRetry     *bool                `json:"cross_group_retry"`
	GroupRouteConfig    *string              `json:"group_route_config"`
	GroupRouteSticky    *bool                `json:"group_route_sticky"`
	AutoGroups          tokenAutoGroupsInput `json:"auto_groups"`
}

func UpdateTokenBatch(c *gin.Context) {
	// Reject simple content types even though Gin's JSON binder accepts them.
	if c.ContentType() != "application/json" {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var request struct {
		Ids     []int                  `json:"ids"`
		Updates tokenBatchUpdateFields `json:"updates"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	params := tokenBatchAuditParams(c, request.Ids)
	if len(request.Ids) == 0 || c.GetInt("id") <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if len(request.Ids) > 100 {
		common.ApiErrorT(c, "Too many items in batch request, maximum is {{max}}", map[string]any{"max": 100})
		return
	}
	for _, id := range request.Ids {
		if id <= 0 {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
	}
	patch := request.Updates
	updates := make(map[string]any)
	if patch.Name != nil {
		if strings.TrimSpace(*patch.Name) == "" || len(*patch.Name) > 50 {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		updates["name"] = *patch.Name
	}
	if patch.Status != nil {
		if *patch.Status != common.TokenStatusEnabled && *patch.Status != common.TokenStatusDisabled {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		updates["status"] = *patch.Status
	}
	if patch.ExpiredTime != nil {
		if *patch.ExpiredTime < -1 {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		updates["expired_time"] = *patch.ExpiredTime
	}
	if patch.RemainQuota != nil {
		if *patch.RemainQuota < 0 || *patch.RemainQuota > maxTokenQuota() {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		updates["remain_quota"] = *patch.RemainQuota
	}
	if patch.UnlimitedQuota != nil {
		updates["unlimited_quota"] = *patch.UnlimitedQuota
	}
	if patch.ModelLimitsEnabled != nil || patch.ModelLimits != nil {
		if patch.ModelLimitsEnabled == nil || patch.ModelLimits == nil || (*patch.ModelLimitsEnabled && strings.TrimSpace(*patch.ModelLimits) == "") {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		updates["model_limits_enabled"], updates["model_limits"] = *patch.ModelLimitsEnabled, *patch.ModelLimits
	}
	if patch.AllowIps != nil {
		updates["allow_ips"] = *patch.AllowIps
	}
	if patch.AllowUserQuotaQuery != nil {
		updates["allow_user_quota_query"] = *patch.AllowUserQuotaQuery
	}
	if patch.Group != nil || patch.GroupRouteConfig != nil || patch.CrossGroupRetry != nil || patch.GroupRouteSticky != nil || patch.AutoGroups.Set {
		if patch.Group == nil || patch.GroupRouteConfig == nil || patch.CrossGroupRetry == nil || patch.GroupRouteSticky == nil || !patch.AutoGroups.Set {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		config, err := normalizeTokenGroupRouteConfigForUser(c.GetInt("id"), *patch.GroupRouteConfig)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		token := model.Token{GroupRouteConfig: config}
		if config != "" {
			token.GroupRouteSticky = *patch.GroupRouteSticky
		} else {
			token.Group, err = normalizeTokenGroupForUser(c.GetInt("id"), *patch.Group)
			if err != nil {
				common.ApiError(c, err)
				return
			}
			if token.Group == "auto" {
				token.CrossGroupRetry = *patch.CrossGroupRetry
				if !setTokenAutoGroups(c, &token, patch.AutoGroups.Groups) {
					return
				}
			}
		}
		updates["routing_template_id"] = ""
		updates["group"], updates["group_route_config"], updates["group_route_sticky"] = token.Group, token.GroupRouteConfig, token.GroupRouteSticky
		updates["auto_groups"], updates["cross_group_retry"] = token.AutoGroups, token.CrossGroupRetry
	}
	if patch.RoutingTemplateID != nil {
		token := model.Token{UserId: c.GetInt("id"), RoutingTemplateID: *patch.RoutingTemplateID}
		if token.RoutingTemplateID != "" {
			if err := applyTokenRoutingTemplate(&token); err != nil {
				common.ApiError(c, err)
				return
			}
			updates["group"], updates["auto_groups"], updates["cross_group_retry"] = "", "", false
			updates["group_route_config"], updates["group_route_sticky"] = token.GroupRouteConfig, token.GroupRouteSticky
		}
		updates["routing_template_id"] = token.RoutingTemplateID
	}
	if len(updates) == 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	fields := make([]string, 0, len(updates))
	for field := range updates {
		fields = append(fields, field)
	}
	slices.Sort(fields)
	params["changed_fields"] = fields
	count, err := model.BatchUpdateTokens(request.Ids, c.GetInt("id"), updates)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for _, id := range request.Ids {
		service.ClearTokenGroupRouteState(id)
	}
	params["count"] = count
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, count)
}

func DeleteTokenBatch(c *gin.Context) {
	tokenBatch := TokenBatch{}
	if err := c.ShouldBindJSON(&tokenBatch); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	params := tokenBatchAuditParams(c, tokenBatch.Ids)
	if len(tokenBatch.Ids) == 0 {
		common.ApiErrorT(c, "Invalid parameters")
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
	params["count"] = count
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    count,
	})
}
func GetTokenKeysBatch(c *gin.Context) {
	var tokenBatch struct {
		Ids               []int  `json:"ids"`
		RoutingTemplateID string `json:"routing_template_id"`
	}
	if c.ContentType() != "application/json" {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := c.ShouldBindJSON(&tokenBatch); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	params := tokenBatchAuditParams(c, tokenBatch.Ids)
	if len(tokenBatch.Ids) == 0 && tokenBatch.RoutingTemplateID == "" {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if len(tokenBatch.Ids) > 100 {
		common.ApiErrorT(c, "Too many items in batch request, maximum is {{max}}", map[string]any{"max": 100})
		return
	}
	userId := c.GetInt("id")
	var tokens []model.Token
	var err error
	if tokenBatch.RoutingTemplateID != "" {
		if len(tokenBatch.Ids) != 0 || len(tokenBatch.RoutingTemplateID) > 64 {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		params["routing_template_id"] = tokenBatch.RoutingTemplateID
		tokens, err = model.GetTokenKeysByTemplate(tokenBatch.RoutingTemplateID, userId)
	} else {
		tokens, err = model.GetTokenKeysByIds(tokenBatch.Ids, userId)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	keysMap := make(map[int]string)
	returnedIDs := make([]int, 0, len(tokens))
	for _, t := range tokens {
		keysMap[t.Id] = t.GetFullKey()
		returnedIDs = append(returnedIDs, t.Id)
	}
	params["count"] = len(tokens)
	params["returned_ids"] = returnedIDs[:min(len(returnedIDs), 100)]
	if len(returnedIDs) > 100 {
		params["returned_ids_truncated"] = true
	}
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, gin.H{"keys": keysMap})
}
