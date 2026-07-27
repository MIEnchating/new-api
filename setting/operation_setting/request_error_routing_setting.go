package operation_setting

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/config"
)

const (
	RequestErrorRoutingMatchAny = "any"
	RequestErrorRoutingMatchAll = "all"

	RequestErrorMessageMatchContains = "contains"
	RequestErrorMessageMatchExact    = "exact"
)

type RequestErrorRoutingRule struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Description      string `json:"description"`
	Priority         int    `json:"priority"`
	Enabled          bool   `json:"enabled"`
	MatchMode        string `json:"match_mode"`
	StatusCodes      string `json:"status_codes"`
	ErrorCodes       string `json:"error_codes"`
	MessagePatterns  string `json:"message_patterns"`
	MessageMatchMode string `json:"message_match_mode"`
	RetrySameChannel bool   `json:"retry_same_channel"`
	SwitchChannel    bool   `json:"switch_channel"`
	SwitchGroup      bool   `json:"switch_group"`
	Cooldown         bool   `json:"cooldown"`
}

type RequestErrorRoutingSetting struct {
	Enabled bool                      `json:"enabled"`
	Rules   []RequestErrorRoutingRule `json:"rules"`
}

type RequestErrorRoutingActions struct {
	RetrySameChannel bool
	SwitchChannel    bool
	SwitchGroup      bool
	Cooldown         bool
}

var requestErrorRoutingSetting = RequestErrorRoutingSetting{
	Enabled: true,
	Rules: []RequestErrorRoutingRule{
		{
			ID:               "context-window-exceeded",
			Name:             "Context window exceeded",
			Description:      "Do not resend an unchanged oversized request to the same channel; continue with other candidates without marking the route unhealthy.",
			Priority:         0,
			Enabled:          true,
			MatchMode:        RequestErrorRoutingMatchAny,
			ErrorCodes:       "context_length_exceeded,input_too_long,prompt_too_long",
			MessagePatterns:  strings.Join(defaultContextLimitMessagePatterns, "\n"),
			MessageMatchMode: RequestErrorMessageMatchContains,
			RetrySameChannel: false,
			SwitchChannel:    true,
			SwitchGroup:      true,
			Cooldown:         false,
		},
	},
}

var requestErrorRoutingRuntime atomic.Pointer[RequestErrorRoutingSetting]
var requestErrorRoutingSettingMutex sync.Mutex

var defaultContextLimitMessagePatterns = []string{
	"exceeds the context window",
	"exceed the context window",
	"maximum context length",
	"context length exceeded",
	"context window exceeded",
	"input is too long",
	"input too long",
	"prompt is too long",
	"prompt too long",
	"上下文长度超出",
	"超出上下文窗口",
	"输入内容过长",
	"提示词过长",
}

func init() {
	RefreshRequestErrorRoutingSnapshot()
	config.GlobalConfig.Register("request_error_routing_setting", &requestErrorRoutingSetting)
}

// GetRequestErrorRoutingSetting returns the mutable configuration object used
// by the option loader. Request processing reads the immutable runtime snapshot
// instead, so a settings refresh cannot race with failure handling.
func GetRequestErrorRoutingSetting() *RequestErrorRoutingSetting {
	return &requestErrorRoutingSetting
}

func cloneRequestErrorRoutingSetting(setting RequestErrorRoutingSetting) *RequestErrorRoutingSetting {
	clone := setting
	clone.Rules = append([]RequestErrorRoutingRule(nil), setting.Rules...)
	return &clone
}

func publishRequestErrorRoutingSnapshot(setting RequestErrorRoutingSetting) {
	requestErrorRoutingRuntime.Store(cloneRequestErrorRoutingSetting(setting))
}

// UpdateRequestErrorRoutingSetting serializes updates to the mutable config
// object and publishes the resulting immutable runtime view before unlocking.
func UpdateRequestErrorRoutingSetting(configMap map[string]string) error {
	requestErrorRoutingSettingMutex.Lock()
	defer requestErrorRoutingSettingMutex.Unlock()

	if err := config.UpdateConfigFromMap(&requestErrorRoutingSetting, configMap); err != nil {
		return err
	}
	publishRequestErrorRoutingSnapshot(requestErrorRoutingSetting)
	return nil
}

// RefreshRequestErrorRoutingSnapshot publishes the option loader's latest
// values as one immutable unit. Call this after updating either registered
// request_error_routing_setting field.
func RefreshRequestErrorRoutingSnapshot() {
	requestErrorRoutingSettingMutex.Lock()
	defer requestErrorRoutingSettingMutex.Unlock()
	publishRequestErrorRoutingSnapshot(requestErrorRoutingSetting)
}

func currentRequestErrorRoutingSetting() *RequestErrorRoutingSetting {
	setting := requestErrorRoutingRuntime.Load()
	if setting != nil {
		return setting
	}
	// init publishes the default snapshot; retain a defensive fallback for tests
	// that reset package globals directly.
	return cloneRequestErrorRoutingSetting(requestErrorRoutingSetting)
}

func ValidateRequestErrorRoutingRulesJSON(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "[]"
	}

	var rules []RequestErrorRoutingRule
	if err := common.UnmarshalJsonStr(raw, &rules); err != nil {
		return errors.New("请求错误路由规则必须是 JSON 数组")
	}
	return ValidateRequestErrorRoutingRules(rules)
}

func ValidateRequestErrorRoutingRules(rules []RequestErrorRoutingRule) error {
	for index, rule := range rules {
		ruleNo := index + 1
		if !rule.Enabled {
			continue
		}
		name := strings.TrimSpace(rule.Name)
		if name == "" {
			return fmt.Errorf("第 %d 条请求错误路由规则需要填写名称", ruleNo)
		}
		if len([]rune(name)) > 100 {
			return fmt.Errorf("第 %d 条请求错误路由规则名称不能超过 100 个字符", ruleNo)
		}
		if len([]rune(strings.TrimSpace(rule.Description))) > 500 {
			return fmt.Errorf("第 %d 条请求错误路由规则描述不能超过 500 个字符", ruleNo)
		}

		matchMode := normalizeRequestErrorRoutingMatchMode(rule.MatchMode)
		if rule.MatchMode != "" && matchMode != rule.MatchMode {
			return fmt.Errorf("第 %d 条请求错误路由规则的条件组合方式无效", ruleNo)
		}
		messageMatchMode := normalizeRequestErrorMessageMatchMode(rule.MessageMatchMode)
		if rule.MessageMatchMode != "" && messageMatchMode != rule.MessageMatchMode {
			return fmt.Errorf("第 %d 条请求错误路由规则的错误信息匹配方式无效", ruleNo)
		}

		hasStatus := strings.TrimSpace(rule.StatusCodes) != ""
		hasCode := len(splitRequestErrorRoutingValues(rule.ErrorCodes)) > 0
		hasMessage := len(splitRequestErrorRoutingValues(rule.MessagePatterns)) > 0
		if !hasStatus && !hasCode && !hasMessage {
			return fmt.Errorf("第 %d 条请求错误路由规则至少需要一个匹配条件", ruleNo)
		}
		if hasStatus {
			if _, err := ParseHTTPStatusCodeRanges(rule.StatusCodes); err != nil {
				return fmt.Errorf("第 %d 条请求错误路由规则状态码无效: %w", ruleNo, err)
			}
		}
	}
	return nil
}

func ResolveRequestErrorRouting(err *types.NewAPIError) (RequestErrorRoutingActions, bool) {
	setting := currentRequestErrorRoutingSetting()
	if err == nil || !setting.Enabled {
		return RequestErrorRoutingActions{}, false
	}

	rules := append([]RequestErrorRoutingRule(nil), setting.Rules...)
	sort.SliceStable(rules, func(i, j int) bool {
		return rules[i].Priority < rules[j].Priority
	})
	for _, rule := range rules {
		if !rule.Enabled || !matchRequestErrorRoutingRule(rule, err) {
			continue
		}
		return RequestErrorRoutingActions{
			RetrySameChannel: rule.RetrySameChannel,
			SwitchChannel:    rule.SwitchChannel,
			SwitchGroup:      rule.SwitchGroup,
			Cooldown:         rule.Cooldown,
		}, true
	}
	return RequestErrorRoutingActions{}, false
}

func matchRequestErrorRoutingRule(rule RequestErrorRoutingRule, err *types.NewAPIError) bool {
	hasStatus := strings.TrimSpace(rule.StatusCodes) != ""
	errorCodes := splitRequestErrorRoutingValues(rule.ErrorCodes)
	messagePatterns := splitRequestErrorRoutingValues(rule.MessagePatterns)
	hasCode := len(errorCodes) > 0
	hasMessage := len(messagePatterns) > 0
	if !hasStatus && !hasCode && !hasMessage {
		return false
	}

	statusMatched := false
	if hasStatus {
		ranges, parseErr := ParseHTTPStatusCodeRanges(rule.StatusCodes)
		if parseErr != nil {
			return false
		}
		statusMatched = shouldMatchStatusCodeRanges(ranges, err.StatusCode)
	}

	codeMatched := hasCode && matchesRequestErrorCode(err, errorCodes)
	messageMatched := hasMessage && matchesRequestErrorMessage(
		err,
		messagePatterns,
		rule.MessageMatchMode,
	)

	if normalizeRequestErrorRoutingMatchMode(rule.MatchMode) == RequestErrorRoutingMatchAll {
		return (!hasStatus || statusMatched) &&
			(!hasCode || codeMatched) &&
			(!hasMessage || messageMatched)
	}
	return statusMatched || codeMatched || messageMatched
}

func matchesRequestErrorCode(err *types.NewAPIError, expected []string) bool {
	if err == nil {
		return false
	}
	actual := []string{string(err.GetErrorCode())}
	switch relayErr := err.RelayError.(type) {
	case types.OpenAIError:
		actual = append(actual, fmt.Sprint(relayErr.Code), relayErr.Type)
	case *types.OpenAIError:
		if relayErr != nil {
			actual = append(actual, fmt.Sprint(relayErr.Code), relayErr.Type)
		}
	case types.ClaudeError:
		actual = append(actual, relayErr.Type)
	case *types.ClaudeError:
		if relayErr != nil {
			actual = append(actual, relayErr.Type)
		}
	}

	for _, candidate := range actual {
		candidate = strings.ToLower(strings.TrimSpace(candidate))
		for _, value := range expected {
			if candidate != "" && candidate == strings.ToLower(value) {
				return true
			}
		}
	}
	return false
}

func matchesRequestErrorMessage(err *types.NewAPIError, patterns []string, mode string) bool {
	matchMode := normalizeRequestErrorMessageMatchMode(mode)
	for _, message := range collectErrorMessages(err) {
		candidate := strings.ToLower(strings.TrimSpace(message))
		for _, pattern := range patterns {
			pattern = strings.ToLower(strings.TrimSpace(pattern))
			if pattern == "" {
				continue
			}
			if matchMode == RequestErrorMessageMatchExact && candidate == pattern {
				return true
			}
			if matchMode == RequestErrorMessageMatchContains && strings.Contains(candidate, pattern) {
				return true
			}
		}
	}
	return false
}

func splitRequestErrorRoutingValues(raw string) []string {
	raw = strings.NewReplacer("\r\n", "\n", "，", ",").Replace(raw)
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '\n'
	})
	values := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		normalized := strings.ToLower(value)
		if value == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		values = append(values, value)
	}
	return values
}

func normalizeRequestErrorRoutingMatchMode(mode string) string {
	if strings.TrimSpace(mode) == RequestErrorRoutingMatchAll {
		return RequestErrorRoutingMatchAll
	}
	return RequestErrorRoutingMatchAny
}

func normalizeRequestErrorMessageMatchMode(mode string) string {
	if strings.TrimSpace(mode) == RequestErrorMessageMatchExact {
		return RequestErrorMessageMatchExact
	}
	return RequestErrorMessageMatchContains
}
