package controller

import (
	"fmt"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
)

var completionRatioMetaOptionKeys = []string{
	"ModelPrice",
	"ModelRatio",
	"CompletionRatio",
	"CacheRatio",
	"CreateCacheRatio",
	"ImageRatio",
	"AudioRatio",
	"AudioCompletionRatio",
}

func isPaymentComplianceOptionKey(key string) bool {
	return strings.HasPrefix(key, "payment_setting.compliance_")
}

func isPositiveOptionValue(value string) bool {
	intValue, err := strconv.Atoi(strings.TrimSpace(value))
	if err == nil {
		return intValue > 0
	}
	floatValue, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	return err == nil && floatValue > 0
}

func collectModelNamesFromOptionValue(raw string, modelNames map[string]struct{}) {
	if strings.TrimSpace(raw) == "" {
		return
	}

	var parsed map[string]any
	if err := common.UnmarshalJsonStr(raw, &parsed); err != nil {
		return
	}

	for modelName := range parsed {
		modelNames[modelName] = struct{}{}
	}
}

func buildCompletionRatioMetaValue(optionValues map[string]string) string {
	modelNames := make(map[string]struct{})
	for _, key := range completionRatioMetaOptionKeys {
		collectModelNamesFromOptionValue(optionValues[key], modelNames)
	}

	meta := make(map[string]ratio_setting.CompletionRatioInfo, len(modelNames))
	for modelName := range modelNames {
		meta[modelName] = ratio_setting.GetCompletionRatioInfo(modelName)
	}

	jsonBytes, err := common.Marshal(meta)
	if err != nil {
		return "{}"
	}
	return string(jsonBytes)
}

func GetOptions(c *gin.Context) {
	var options []*model.Option
	optionValues := make(map[string]string)
	common.OptionMapRWMutex.Lock()
	for k, v := range common.OptionMap {
		if k == "theme.frontend" || k == "billing_setting.billing_mode" || k == "billing_setting.billing_expr" {
			continue
		}
		value := common.Interface2String(v)
		isSensitiveKey := strings.HasSuffix(k, "Token") ||
			strings.HasSuffix(k, "Secret") ||
			strings.HasSuffix(k, "Key") ||
			strings.HasSuffix(k, "secret") ||
			strings.HasSuffix(k, "api_key")
		if isSensitiveKey {
			continue
		}
		options = append(options, &model.Option{
			Key:   k,
			Value: value,
		})
		if slices.Contains(completionRatioMetaOptionKeys, k) {
			optionValues[k] = value
		}
	}
	common.OptionMapRWMutex.Unlock()
	// Display the same effective expressions used by pricing and settlement,
	// including built-in defaults absent from persisted administrator options.
	for key, values := range map[string]map[string]string{
		"billing_setting.billing_mode": billing_setting.GetBillingModeCopy(),
		"billing_setting.billing_expr": billing_setting.GetBillingExprCopy(),
	} {
		encoded, err := common.Marshal(values)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		options = append(options, &model.Option{Key: key, Value: string(encoded)})
	}
	options = append(options, &model.Option{
		Key:   "CompletionRatioMeta",
		Value: buildCompletionRatioMetaValue(optionValues),
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    options,
	})
}

type OptionUpdateRequest struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}

type OptionBulkUpdateRequest struct {
	Options []OptionUpdateRequest `json:"options"`
}

type GroupSettingsUpdateRequest struct {
	Options []OptionUpdateRequest `json:"options"`
	Renames []service.GroupRename `json:"renames"`
}

var routingReliabilityBulkOptionKeys = map[string]struct{}{
	"RetryTimes":                                {},
	"ChannelRouteCooldownEnabled":               {},
	"ChannelRouteCooldownSeconds":               {},
	"ChannelRouteCooldownExcludedGroups":        {},
	"ChannelRouteSameChannelRetries":            {},
	"ChannelRouteGroupExclusionsEnabled":        {},
	"ChannelRouteGroupExclusions":               {},
	"ChannelDisableThreshold":                   {},
	"AutomaticDisableChannelEnabled":            {},
	"AutomaticEnableChannelEnabled":             {},
	"AutomaticDisableKeywords":                  {},
	"AutomaticDisableStatusCodes":               {},
	"AutomaticRetryStatusCodes":                 {},
	"monitor_setting.auto_test_channel_enabled": {},
	"monitor_setting.auto_test_channel_minutes": {},
	"monitor_setting.channel_test_mode":         {},
	"error_response_setting.enabled":            {},
	"error_response_setting.rules":              {},
	"request_error_routing_setting.enabled":     {},
	"request_error_routing_setting.rules":       {},
	"smart_routing_setting.enabled":             {},
	"smart_routing_setting.templates":           {},
}

func optionValueToString(value any) string {
	switch typedValue := value.(type) {
	case bool:
		return common.Interface2String(typedValue)
	case float64:
		return common.Interface2String(typedValue)
	case int:
		return common.Interface2String(typedValue)
	default:
		return fmt.Sprintf("%v", value)
	}
}

func validateRoutingReliabilityOption(key string, value string) error {
	switch key {
	case "AutomaticDisableStatusCodes", "AutomaticRetryStatusCodes":
		_, err := operation_setting.ParseHTTPStatusCodeRanges(value)
		return err
	case "ChannelRouteCooldownSeconds":
		seconds, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || seconds < 0 || seconds > 31536000 {
			return fmt.Errorf("渠道路由冷却时间必须在 0 到 31536000 秒之间")
		}
	case "ChannelRouteCooldownExcludedGroups":
		_, err := setting.ParseChannelRouteCooldownExcludedGroups(value)
		return err
	case "ChannelRouteSameChannelRetries":
		retries, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || retries < 0 || retries > 10 {
			return fmt.Errorf("同渠道重试次数必须在 0 到 10 之间")
		}
	case "ChannelRouteGroupExclusions":
		_, err := setting.ParseChannelRouteGroupExclusions(value)
		return err
	case "error_response_setting.rules":
		return operation_setting.ValidateCustomErrorResponseRulesJSON(value)
	case "request_error_routing_setting.rules":
		return operation_setting.ValidateRequestErrorRoutingRulesJSON(value)
	case "smart_routing_setting.templates":
		return operation_setting.ValidateSmartRoutingTemplatesJSON(value)
	}
	return nil
}

func prepareRoutingReliabilityOptionUpdates(options []OptionUpdateRequest) (map[string]string, error) {
	if len(options) == 0 {
		return nil, fmt.Errorf("至少需要提交一项设置")
	}
	if len(options) > len(routingReliabilityBulkOptionKeys) {
		return nil, fmt.Errorf("一次提交的设置项过多")
	}

	updates := make(map[string]string, len(options))
	for _, option := range options {
		if _, allowed := routingReliabilityBulkOptionKeys[option.Key]; !allowed {
			return nil, fmt.Errorf("设置项 %s 不支持批量更新", option.Key)
		}
		if _, duplicated := updates[option.Key]; duplicated {
			return nil, fmt.Errorf("设置项 %s 重复提交", option.Key)
		}
		value := optionValueToString(option.Value)
		if err := validateRoutingReliabilityOption(option.Key, value); err != nil {
			return nil, fmt.Errorf("设置项 %s 无效: %w", option.Key, err)
		}
		updates[option.Key] = value
	}
	return updates, nil
}

// optionAuditValueKeys is deliberately allowlisted: only non-sensitive routing
// values may be persisted in audit metadata.
var optionAuditValueKeys = map[string]struct{}{
	"RetryTimes":                         {},
	"AutomaticRetryStatusCodes":          {},
	"ChannelRouteCooldownEnabled":        {},
	"ChannelRouteCooldownSeconds":        {},
	"ChannelRouteCooldownExcludedGroups": {},
	"ChannelRouteSameChannelRetries":     {},
	"ChannelRouteGroupExclusionsEnabled": {},
	"ChannelRouteGroupExclusions":        {},
}

func buildOptionAuditParams(key string, previousValue string, currentValue string) map[string]interface{} {
	params := map[string]interface{}{
		"key": key,
	}
	if _, ok := optionAuditValueKeys[key]; ok {
		params["from"] = previousValue
		params["to"] = currentValue
	}
	return params
}

func UpdateOption(c *gin.Context) {
	var option OptionUpdateRequest
	err := common.DecodeJson(c.Request.Body, &option)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "无效的参数",
		})
		return
	}
	option.Value = optionValueToString(option.Value)
	if option.Key == "TrustedSiteOrigins" {
		normalized, normalizeErr := service.NormalizeTrustedSiteOrigins(option.Value.(string))
		if normalizeErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": normalizeErr.Error(),
			})
			return
		}
		option.Value = normalized
	}
	if err = validateRoutingReliabilityOption(option.Key, option.Value.(string)); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	switch option.Key {
	case "QuotaForInviter", "QuotaForInvitee", "InviteRechargeRebateRatio":
		if isPositiveOptionValue(option.Value.(string)) && !operation_setting.IsPaymentComplianceConfirmed() {
			common.ApiErrorI18n(c, i18n.MsgPaymentComplianceRequired)
			return
		}
	default:
		if isPaymentComplianceOptionKey(option.Key) {
			common.ApiErrorMsg(c, "合规确认字段不允许通过通用设置接口修改")
			return
		}
	}
	if option.Key == "TaskPublicAddress" && option.Value.(string) != "" {
		if err := service.ValidateTaskArtifactBaseURL(option.Value.(string)); err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
	}
	switch option.Key {
	case "GitHubOAuthEnabled":
		if option.Value == "true" && common.GitHubClientId == "" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无法启用 GitHub OAuth，请先填入 GitHub Client Id 以及 GitHub Client Secret！",
			})
			return
		}
	case "discord.enabled":
		if option.Value == "true" && system_setting.GetDiscordSettings().ClientId == "" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无法启用 Discord OAuth，请先填入 Discord Client Id 以及 Discord Client Secret！",
			})
			return
		}
	case "oidc.enabled":
		if option.Value == "true" && system_setting.GetOIDCSettings().ClientId == "" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无法启用 OIDC 登录，请先填入 OIDC Client Id 以及 OIDC Client Secret！",
			})
			return
		}
	case "LinuxDOOAuthEnabled":
		if option.Value == "true" && common.LinuxDOClientId == "" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无法启用 LinuxDO OAuth，请先填入 LinuxDO Client Id 以及 LinuxDO Client Secret！",
			})
			return
		}
	case "EmailDomainRestrictionEnabled":
		if option.Value == "true" && len(common.EmailDomainWhitelist) == 0 {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无法启用邮箱域名限制，请先填入限制的邮箱域名！",
			})
			return
		}
	case "WeChatAuthEnabled":
		if option.Value == "true" && common.WeChatServerAddress == "" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无法启用微信登录，请先填入微信登录相关配置信息！",
			})
			return
		}
	case "TurnstileCheckEnabled":
		if option.Value == "true" && common.TurnstileSiteKey == "" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无法启用 Turnstile 校验，请先填入 Turnstile 校验相关配置信息！",
			})

			return
		}
	case "TelegramOAuthEnabled":
		if option.Value == "true" && common.TelegramBotToken == "" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无法启用 Telegram OAuth，请先填入 Telegram Bot Token！",
			})
			return
		}
	case "theme.frontend":
		if option.Value != "default" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "Classic 前端已移除，主题只能设置为 default",
			})
			return
		}
	case "GroupRatio":
		err = ratio_setting.CheckGroupRatio(option.Value.(string))
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	case ratio_setting.GroupRatioScheduleOptionKey:
		if err = ratio_setting.CheckGroupRatioSchedule(option.Value.(string)); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	case "GroupOrder":
		if _, err = setting.ParseGroupOrder(option.Value.(string)); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	case "GroupDescriptions":
		if _, err = setting.ParseGroupDescriptions(option.Value.(string)); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	case "gemini.safety_settings":
		err = model_setting.ValidateGeminiSafetySettings(option.Value.(string))
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	case "claude.default_max_tokens":
		err = model_setting.ValidateClaudeDefaultMaxTokens(option.Value.(string))
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	case operation_setting.ToolPriceOptionKey:
		err = operation_setting.ValidateToolPricesJSON(option.Value.(string))
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	case "ImageRatio":
		err = ratio_setting.UpdateImageRatioByJSONString(option.Value.(string))
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "图片倍率设置失败: " + err.Error(),
			})
			return
		}
	case "AudioRatio":
		err = ratio_setting.UpdateAudioRatioByJSONString(option.Value.(string))
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "音频倍率设置失败: " + err.Error(),
			})
			return
		}
	case "AudioCompletionRatio":
		err = ratio_setting.UpdateAudioCompletionRatioByJSONString(option.Value.(string))
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "音频补全倍率设置失败: " + err.Error(),
			})
			return
		}
	case "CreateCacheRatio":
		err = ratio_setting.UpdateCreateCacheRatioByJSONString(option.Value.(string))
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "缓存创建倍率设置失败: " + err.Error(),
			})
			return
		}
	case "ModelRequestRateLimitGroup":
		err = setting.CheckModelRequestRateLimitGroup(option.Value.(string))
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	case "perf_metrics_setting.cache_hit_rate_baseline":
		baseline, parseErr := strconv.Atoi(strings.TrimSpace(option.Value.(string)))
		if parseErr != nil || validateCacheHitRateBaseline(baseline) != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "缓存命中率基线必须在 0 到 100 之间",
			})
			return
		}
	case "billing_setting.billing_expr":
		expressions := make(map[string]string)
		if err = common.UnmarshalJsonStr(option.Value.(string), &expressions); err != nil {
			common.ApiErrorMsg(c, "计费表达式配置必须是模型到表达式的 JSON 对象: "+err.Error())
			return
		}
		models := make([]string, 0, len(expressions))
		for modelName := range expressions {
			models = append(models, modelName)
		}
		sort.Strings(models)
		generation := jsplugin.DefaultRegistry.Generation()
		for _, modelName := range models {
			expression := expressions[modelName]
			if plugin, ok := generation.GetByModel(modelName); ok {
				err = billing_setting.SmokeTestTaskExpr(expression, plugin.Meta.UsageSchema)
			} else if target, resolved := model.ResolveTaskModelAlias(generation, modelName); resolved {
				if plugin, ok := generation.Get(target.PluginKey); ok {
					err = billing_setting.SmokeTestTaskExpr(expression, plugin.Meta.UsageSchema)
				} else {
					err = billing_setting.SmokeTestExpr(expression)
				}
			} else {
				err = billing_setting.SmokeTestExpr(expression)
			}
			if err != nil {
				common.ApiErrorMsg(c, fmt.Sprintf("模型 %s 的计费表达式无效: %v", modelName, err))
				return
			}
		}
	case "console_setting.api_info":
		err = console_setting.ValidateConsoleSettings(option.Value.(string), "ApiInfo")
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	case "console_setting.announcements":
		err = console_setting.ValidateConsoleSettings(option.Value.(string), "Announcements")
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	case "console_setting.faq":
		err = console_setting.ValidateConsoleSettings(option.Value.(string), "FAQ")
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	case "console_setting.uptime_kuma_groups":
		err = console_setting.ValidateConsoleSettings(option.Value.(string), "UptimeKumaGroups")
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	}
	previousValue := ""
	if _, ok := optionAuditValueKeys[option.Key]; ok {
		common.OptionMapRWMutex.RLock()
		previousValue = common.OptionMap[option.Key]
		common.OptionMapRWMutex.RUnlock()
	}
	currentValue := option.Value.(string)
	err = model.UpdateOption(option.Key, currentValue)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 仅白名单中的非敏感路由配置记录前后值，其余配置只记录名称。
	recordManageAudit(c, "option.update", buildOptionAuditParams(option.Key, previousValue, currentValue))
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

func UpdateOptionsBulk(c *gin.Context) {
	var request OptionBulkUpdateRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "无效的参数",
		})
		return
	}

	updates, err := prepareRoutingReliabilityOptionUpdates(request.Options)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	previousValues := make(map[string]string, len(updates))
	common.OptionMapRWMutex.RLock()
	for key := range updates {
		previousValues[key] = common.OptionMap[key]
	}
	common.OptionMapRWMutex.RUnlock()

	if err = model.UpdateOptionsBulk(updates); err != nil {
		common.ApiError(c, err)
		return
	}

	for _, option := range request.Options {
		recordManageAudit(c, "option.update", buildOptionAuditParams(
			option.Key,
			previousValues[option.Key],
			updates[option.Key],
		))
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

func UpdateGroupSettings(c *gin.Context) {
	var request GroupSettingsUpdateRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorMsg(c, "invalid group settings request")
		return
	}

	submitted := make(map[string]string, len(request.Options))
	for _, option := range request.Options {
		if !service.IsGroupSettingsOptionKey(option.Key) {
			common.ApiErrorMsg(c, fmt.Sprintf("option %s is not a group setting", option.Key))
			return
		}
		if _, duplicated := submitted[option.Key]; duplicated {
			common.ApiErrorMsg(c, fmt.Sprintf("option %s is duplicated", option.Key))
			return
		}
		submitted[option.Key] = optionValueToString(option.Value)
	}

	updates, renames, err := service.PrepareGroupSettingsUpdate(submitted, request.Renames)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	previousValues := make(map[string]string, len(submitted))
	common.OptionMapRWMutex.RLock()
	for key := range submitted {
		previousValues[key] = common.OptionMap[key]
	}
	common.OptionMapRWMutex.RUnlock()

	if err := model.UpdateGroupSettingsAndReferences(updates, renames); err != nil {
		common.ApiError(c, err)
		return
	}
	for _, option := range request.Options {
		recordManageAudit(c, "option.update", buildOptionAuditParams(
			option.Key,
			previousValues[option.Key],
			updates[option.Key],
		))
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}
