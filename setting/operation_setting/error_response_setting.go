package operation_setting

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/types"
)

const (
	CustomErrorResponseMatchAny = "any"
	CustomErrorResponseMatchAll = "all"
)

type CustomErrorResponseRule struct {
	Enabled               bool   `json:"enabled"`
	MatchMode             string `json:"match_mode"`
	StatusCodes           string `json:"status_codes"`
	MessageContains       string `json:"message_contains"`
	ResponseStatusCode    int    `json:"response_status_code"`
	ResponseMessage       string `json:"response_message"`
	PassThroughStatusCode bool   `json:"pass_through_status_code"`
	PassThroughMessage    bool   `json:"pass_through_message"`
}

type ErrorResponseSetting struct {
	Enabled bool                      `json:"enabled"`
	Rules   []CustomErrorResponseRule `json:"rules"`
}

var errorResponseSetting = ErrorResponseSetting{
	Enabled: false,
	Rules:   []CustomErrorResponseRule{},
}

func init() {
	config.GlobalConfig.Register("error_response_setting", &errorResponseSetting)
}

func GetErrorResponseSetting() *ErrorResponseSetting {
	return &errorResponseSetting
}

func ValidateCustomErrorResponseRulesJSON(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "[]"
	}

	var rules []CustomErrorResponseRule
	if err := json.Unmarshal([]byte(raw), &rules); err != nil {
		return errors.New("自定义错误返回规则必须是 JSON 数组")
	}
	return ValidateCustomErrorResponseRules(rules)
}

func ValidateCustomErrorResponseRules(rules []CustomErrorResponseRule) error {
	for index, rule := range rules {
		if !rule.Enabled {
			continue
		}

		ruleNo := index + 1
		matchMode := normalizeCustomErrorResponseMatchMode(rule.MatchMode)
		if rule.MatchMode != "" && matchMode != rule.MatchMode {
			return fmt.Errorf("第 %d 条自定义错误返回规则的匹配模式无效", ruleNo)
		}

		hasStatusCondition := strings.TrimSpace(rule.StatusCodes) != ""
		hasMessageCondition := strings.TrimSpace(rule.MessageContains) != ""
		if !hasStatusCondition && !hasMessageCondition {
			return fmt.Errorf("第 %d 条自定义错误返回规则至少需要一个匹配条件", ruleNo)
		}

		if hasStatusCondition {
			if _, err := ParseHTTPStatusCodeRanges(rule.StatusCodes); err != nil {
				return fmt.Errorf("第 %d 条自定义错误返回规则状态码无效: %w", ruleNo, err)
			}
		}

		if !rule.PassThroughStatusCode && !isHTTPStatusCode(rule.ResponseStatusCode) {
			return fmt.Errorf("第 %d 条自定义错误返回规则需要设置 100-599 的返回状态码，或开启透传上游状态码", ruleNo)
		}

		if !rule.PassThroughMessage && strings.TrimSpace(rule.ResponseMessage) == "" {
			return fmt.Errorf("第 %d 条自定义错误返回规则需要设置返回消息，或开启透传上游错误信息", ruleNo)
		}
	}

	return nil
}

func ApplyCustomErrorResponse(err *types.NewAPIError) {
	if err == nil || !errorResponseSetting.Enabled {
		return
	}

	for _, rule := range errorResponseSetting.Rules {
		if !rule.Enabled || !matchCustomErrorResponseRule(rule, err) {
			continue
		}

		if !rule.PassThroughStatusCode && isHTTPStatusCode(rule.ResponseStatusCode) {
			err.StatusCode = rule.ResponseStatusCode
		}
		if !rule.PassThroughMessage {
			message := strings.TrimSpace(rule.ResponseMessage)
			if message != "" {
				err.SetResponseMessage(message)
			}
		}
		return
	}
}

func matchCustomErrorResponseRule(rule CustomErrorResponseRule, err *types.NewAPIError) bool {
	hasStatusCondition := strings.TrimSpace(rule.StatusCodes) != ""
	hasMessageCondition := strings.TrimSpace(rule.MessageContains) != ""
	if !hasStatusCondition && !hasMessageCondition {
		return false
	}

	statusMatched := false
	if hasStatusCondition {
		ranges, parseErr := ParseHTTPStatusCodeRanges(rule.StatusCodes)
		if parseErr != nil {
			return false
		}
		statusMatched = shouldMatchStatusCodeRanges(ranges, err.StatusCode)
	}

	messageMatched := false
	if hasMessageCondition {
		messageMatched = containsErrorMessage(err, rule.MessageContains)
	}

	if normalizeCustomErrorResponseMatchMode(rule.MatchMode) == CustomErrorResponseMatchAll {
		if hasStatusCondition && !statusMatched {
			return false
		}
		if hasMessageCondition && !messageMatched {
			return false
		}
		return true
	}

	return statusMatched || messageMatched
}

func containsErrorMessage(err *types.NewAPIError, keyword string) bool {
	keyword = strings.ToLower(strings.TrimSpace(keyword))
	if keyword == "" {
		return false
	}

	for _, message := range collectErrorMessages(err) {
		if strings.Contains(strings.ToLower(message), keyword) {
			return true
		}
	}
	return false
}

func collectErrorMessages(err *types.NewAPIError) []string {
	if err == nil {
		return nil
	}

	messages := []string{err.Error()}
	switch relayError := err.RelayError.(type) {
	case types.OpenAIError:
		messages = append(messages, relayError.Message, relayError.Type, fmt.Sprint(relayError.Code))
	case *types.OpenAIError:
		if relayError != nil {
			messages = append(messages, relayError.Message, relayError.Type, fmt.Sprint(relayError.Code))
		}
	case types.ClaudeError:
		messages = append(messages, relayError.Message, relayError.Type)
	case *types.ClaudeError:
		if relayError != nil {
			messages = append(messages, relayError.Message, relayError.Type)
		}
	default:
		if relayError != nil {
			messages = append(messages, fmt.Sprint(relayError))
		}
	}
	return messages
}

func normalizeCustomErrorResponseMatchMode(mode string) string {
	if strings.TrimSpace(mode) == CustomErrorResponseMatchAll {
		return CustomErrorResponseMatchAll
	}
	return CustomErrorResponseMatchAny
}

func isHTTPStatusCode(code int) bool {
	return code >= 100 && code <= 599
}
