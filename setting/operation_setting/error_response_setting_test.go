package operation_setting

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/stretchr/testify/require"
)

func TestApplyCustomErrorResponse_StatusCodeOnly(t *testing.T) {
	orig := errorResponseSetting
	t.Cleanup(func() { errorResponseSetting = orig })

	errorResponseSetting = ErrorResponseSetting{
		Enabled: true,
		Rules: []CustomErrorResponseRule{
			{
				Enabled:               true,
				MatchMode:             CustomErrorResponseMatchAny,
				StatusCodes:           "500-599",
				ResponseStatusCode:    429,
				ResponseMessage:       "当前模型繁忙，请稍后重试",
				PassThroughStatusCode: false,
				PassThroughMessage:    false,
			},
		},
	}

	apiErr := types.NewOpenAIError(errors.New("upstream overloaded"), types.ErrorCodeBadResponse, 500)

	ApplyCustomErrorResponse(apiErr)

	require.Equal(t, 429, apiErr.StatusCode)
	require.Equal(t, "当前模型繁忙，请稍后重试", apiErr.ToOpenAIError().Message)
}

func TestApplyCustomErrorResponse_MessageOnly(t *testing.T) {
	orig := errorResponseSetting
	t.Cleanup(func() { errorResponseSetting = orig })

	errorResponseSetting = ErrorResponseSetting{
		Enabled: true,
		Rules: []CustomErrorResponseRule{
			{
				Enabled:               true,
				MessageContains:       "quota exceeded",
				ResponseStatusCode:    402,
				ResponseMessage:       "上游额度不足",
				PassThroughStatusCode: false,
				PassThroughMessage:    false,
			},
		},
	}

	apiErr := types.NewOpenAIError(errors.New("Quota Exceeded"), types.ErrorCodeBadResponse, 500)

	ApplyCustomErrorResponse(apiErr)

	require.Equal(t, 402, apiErr.StatusCode)
	require.Equal(t, "上游额度不足", apiErr.ToOpenAIError().Message)
}

func TestApplyCustomErrorResponse_ExactMessageMatch(t *testing.T) {
	orig := errorResponseSetting
	t.Cleanup(func() { errorResponseSetting = orig })

	errorResponseSetting = ErrorResponseSetting{
		Enabled: true,
		Rules: []CustomErrorResponseRule{
			{
				Enabled:            true,
				MessageContains:    "quota exceeded",
				MessageMatchMode:   CustomErrorMessageMatchExact,
				ResponseStatusCode: 402,
				ResponseMessage:    "精准命中",
			},
		},
	}

	partial := types.NewOpenAIError(errors.New("upstream quota exceeded"), types.ErrorCodeBadResponse, 500)
	ApplyCustomErrorResponse(partial)
	require.Equal(t, 500, partial.StatusCode)

	exact := types.NewOpenAIError(errors.New("Quota Exceeded"), types.ErrorCodeBadResponse, 500)
	require.True(t, ApplyCustomErrorResponse(exact))
	require.Equal(t, 402, exact.StatusCode)
	require.Equal(t, "精准命中", exact.ToOpenAIError().Message)
}

func TestApplyCustomErrorResponse_LegacyEmptyMessageModeUsesContains(t *testing.T) {
	orig := errorResponseSetting
	t.Cleanup(func() { errorResponseSetting = orig })

	errorResponseSetting = ErrorResponseSetting{
		Enabled: true,
		Rules: []CustomErrorResponseRule{
			{
				Enabled:            true,
				MessageContains:    "quota exceeded",
				ResponseStatusCode: 402,
				ResponseMessage:    "旧规则仍然命中",
			},
		},
	}

	apiErr := types.NewOpenAIError(errors.New("upstream quota exceeded temporarily"), types.ErrorCodeBadResponse, 500)
	require.True(t, ApplyCustomErrorResponse(apiErr))
	require.Equal(t, "旧规则仍然命中", apiErr.ToOpenAIError().Message)
}

func TestApplyCustomErrorResponse_UsesLowestPriorityFirst(t *testing.T) {
	orig := errorResponseSetting
	t.Cleanup(func() { errorResponseSetting = orig })

	errorResponseSetting = ErrorResponseSetting{
		Enabled: true,
		Rules: []CustomErrorResponseRule{
			{
				Name:               "fallback",
				Priority:           100,
				Enabled:            true,
				StatusCodes:        "500",
				ResponseStatusCode: 500,
				ResponseMessage:    "低优先级规则",
			},
			{
				Name:               "preferred",
				Priority:           10,
				Enabled:            true,
				StatusCodes:        "500",
				ResponseStatusCode: 503,
				ResponseMessage:    "高优先级规则",
			},
		},
	}

	apiErr := types.NewOpenAIError(errors.New("upstream error"), types.ErrorCodeBadResponse, 500)
	require.True(t, ApplyCustomErrorResponse(apiErr))
	require.Equal(t, 503, apiErr.StatusCode)
	require.Equal(t, "高优先级规则", apiErr.ToOpenAIError().Message)
}

func TestApplyCustomErrorResponse_AllModeRequiresBothConditions(t *testing.T) {
	orig := errorResponseSetting
	t.Cleanup(func() { errorResponseSetting = orig })

	errorResponseSetting = ErrorResponseSetting{
		Enabled: true,
		Rules: []CustomErrorResponseRule{
			{
				Enabled:               true,
				MatchMode:             CustomErrorResponseMatchAll,
				StatusCodes:           "429",
				MessageContains:       "rate limit",
				ResponseStatusCode:    429,
				ResponseMessage:       "触发上游限速",
				PassThroughStatusCode: false,
				PassThroughMessage:    false,
			},
		},
	}

	notMatchedErr := types.NewOpenAIError(errors.New("rate limit"), types.ErrorCodeBadResponse, 500)
	ApplyCustomErrorResponse(notMatchedErr)
	require.Equal(t, 500, notMatchedErr.StatusCode)
	require.Equal(t, "rate limit", notMatchedErr.ToOpenAIError().Message)

	matchedErr := types.NewOpenAIError(errors.New("rate limit"), types.ErrorCodeBadResponse, 429)
	ApplyCustomErrorResponse(matchedErr)
	require.Equal(t, 429, matchedErr.StatusCode)
	require.Equal(t, "触发上游限速", matchedErr.ToOpenAIError().Message)
}

func TestApplyCustomErrorResponse_PassThroughStatusAndMessage(t *testing.T) {
	orig := errorResponseSetting
	t.Cleanup(func() { errorResponseSetting = orig })

	errorResponseSetting = ErrorResponseSetting{
		Enabled: true,
		Rules: []CustomErrorResponseRule{
			{
				Enabled:               true,
				StatusCodes:           "500",
				ResponseStatusCode:    400,
				ResponseMessage:       "不会使用",
				PassThroughStatusCode: true,
				PassThroughMessage:    true,
			},
		},
	}

	apiErr := types.NewOpenAIError(errors.New("upstream raw message"), types.ErrorCodeBadResponse, 500)

	ApplyCustomErrorResponse(apiErr)

	require.Equal(t, 500, apiErr.StatusCode)
	require.Equal(t, "upstream raw message", apiErr.ToOpenAIError().Message)
}

func TestApplyCustomErrorResponse_EmptyConditionRuleDoesNotMatch(t *testing.T) {
	orig := errorResponseSetting
	t.Cleanup(func() { errorResponseSetting = orig })

	errorResponseSetting = ErrorResponseSetting{
		Enabled: true,
		Rules: []CustomErrorResponseRule{
			{
				Enabled:               true,
				ResponseStatusCode:    418,
				ResponseMessage:       "不应命中",
				PassThroughStatusCode: false,
				PassThroughMessage:    false,
			},
		},
	}

	apiErr := types.NewOpenAIError(errors.New("any error"), types.ErrorCodeBadResponse, 500)

	ApplyCustomErrorResponse(apiErr)

	require.Equal(t, 500, apiErr.StatusCode)
	require.Equal(t, "any error", apiErr.ToOpenAIError().Message)
}

func TestValidateCustomErrorResponseRulesJSON(t *testing.T) {
	valid := `[
		{
			"enabled": true,
			"match_mode": "all",
			"status_codes": "429,500-599",
			"message_contains": "rate limit",
			"response_status_code": 429,
			"response_message": "当前模型繁忙，请稍后重试",
			"pass_through_status_code": false,
			"pass_through_message": false
		}
	]`

	require.NoError(t, ValidateCustomErrorResponseRulesJSON(valid))
	require.Error(t, ValidateCustomErrorResponseRulesJSON(`{"enabled": true}`))
	require.Error(t, ValidateCustomErrorResponseRulesJSON(`[{"enabled":true}]`))
	require.Error(t, ValidateCustomErrorResponseRulesJSON(`[{"enabled":true,"status_codes":"99","response_status_code":429,"response_message":"x"}]`))
	require.Error(t, ValidateCustomErrorResponseRulesJSON(`[{"enabled":true,"status_codes":"500","response_message":"x"}]`))
	require.Error(t, ValidateCustomErrorResponseRulesJSON(`[{"enabled":true,"status_codes":"500","response_status_code":429}]`))
	require.Error(t, ValidateCustomErrorResponseRulesJSON(`[{"enabled":true,"message_contains":"x","message_match_mode":"regex","response_status_code":429,"response_message":"x"}]`))
	require.NoError(t, ValidateCustomErrorResponseRulesJSON(`[{"enabled":false}]`))
}
