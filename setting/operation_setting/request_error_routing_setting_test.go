package operation_setting

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/stretchr/testify/require"
)

func withRequestErrorRoutingSetting(t *testing.T, setting RequestErrorRoutingSetting) {
	t.Helper()
	current := GetRequestErrorRoutingSetting()
	original := *current
	original.Rules = append([]RequestErrorRoutingRule(nil), current.Rules...)
	*current = setting
	RefreshRequestErrorRoutingSnapshot()
	t.Cleanup(func() {
		*current = original
		RefreshRequestErrorRoutingSnapshot()
	})
}

func TestDefaultRequestErrorRoutingRuleHandlesContextLimit(t *testing.T) {
	err := types.WithOpenAIError(types.OpenAIError{
		Message: "Your input exceeds the context window of this model. Please adjust your input and try again.",
		Type:    "upstream_error",
	}, http.StatusBadGateway)

	actions, matched := ResolveRequestErrorRouting(err)

	require.True(t, matched)
	require.False(t, actions.RetrySameChannel)
	require.True(t, actions.SwitchChannel)
	require.True(t, actions.SwitchGroup)
	require.False(t, actions.Cooldown)
}

func TestRequestErrorRoutingRuleSupportsAllConditionsAndPriority(t *testing.T) {
	withRequestErrorRoutingSetting(t, RequestErrorRoutingSetting{
		Enabled: true,
		Rules: []RequestErrorRoutingRule{
			{
				ID:               "later",
				Name:             "later",
				Priority:         20,
				Enabled:          true,
				MatchMode:        RequestErrorRoutingMatchAny,
				StatusCodes:      "502",
				RetrySameChannel: true,
			},
			{
				ID:               "first",
				Name:             "first",
				Priority:         10,
				Enabled:          true,
				MatchMode:        RequestErrorRoutingMatchAll,
				StatusCodes:      "500-503",
				ErrorCodes:       "context_length_exceeded",
				MessagePatterns:  "context window",
				MessageMatchMode: RequestErrorMessageMatchContains,
				SwitchChannel:    true,
			},
		},
	})
	err := types.WithOpenAIError(types.OpenAIError{
		Message: "context window exceeded",
		Type:    "invalid_request_error",
		Code:    "context_length_exceeded",
	}, http.StatusBadGateway)

	actions, matched := ResolveRequestErrorRouting(err)

	require.True(t, matched)
	require.False(t, actions.RetrySameChannel)
	require.True(t, actions.SwitchChannel)
}

func TestRequestErrorRoutingSettingCanBeDisabled(t *testing.T) {
	withRequestErrorRoutingSetting(t, RequestErrorRoutingSetting{
		Enabled: false,
		Rules:   append([]RequestErrorRoutingRule(nil), requestErrorRoutingSetting.Rules...),
	})
	err := types.WithOpenAIError(types.OpenAIError{
		Message: "context length exceeded",
	}, http.StatusBadGateway)

	_, matched := ResolveRequestErrorRouting(err)

	require.False(t, matched)
}

func TestRequestErrorRoutingMatchesHiddenInternalErrorMessage(t *testing.T) {
	withRequestErrorRoutingSetting(t, RequestErrorRoutingSetting{
		Enabled: true,
		Rules: []RequestErrorRoutingRule{
			{
				Name:             "hidden upstream detail",
				Enabled:          true,
				MessagePatterns:  "raw context window exceeded",
				MessageMatchMode: RequestErrorMessageMatchContains,
				SwitchGroup:      true,
			},
		},
	})
	err := types.NewError(
		errors.New("raw context window exceeded at upstream"),
		types.ErrorCodeDoRequestFailed,
		types.ErrOptionWithHideErrMsg("upstream error: do request failed"),
	)

	actions, matched := ResolveRequestErrorRouting(err)

	require.True(t, matched)
	require.True(t, actions.SwitchGroup)
}

func TestRequestErrorRoutingRuntimeSnapshotConcurrentPublishAndResolve(t *testing.T) {
	current := GetRequestErrorRoutingSetting()
	original := *current
	original.Rules = append([]RequestErrorRoutingRule(nil), current.Rules...)
	t.Cleanup(func() {
		*current = original
		RefreshRequestErrorRoutingSnapshot()
	})

	channelSetting := RequestErrorRoutingSetting{
		Enabled: true,
		Rules: []RequestErrorRoutingRule{
			{Name: "channel", Enabled: true, StatusCodes: "502", SwitchChannel: true},
		},
	}
	groupSetting := RequestErrorRoutingSetting{
		Enabled: true,
		Rules: []RequestErrorRoutingRule{
			{Name: "group", Enabled: true, StatusCodes: "502", SwitchGroup: true},
		},
	}
	err := types.NewOpenAIError(errors.New("upstream failed"), types.ErrorCodeBadResponse, http.StatusBadGateway)
	updateSetting := func(setting RequestErrorRoutingSetting) {
		rules, marshalErr := json.Marshal(setting.Rules)
		require.NoError(t, marshalErr)
		require.NoError(t, UpdateRequestErrorRoutingSetting(map[string]string{
			"enabled": strconv.FormatBool(setting.Enabled),
			"rules":   string(rules),
		}))
	}
	updateSetting(channelSetting)

	var invalid atomic.Bool
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for index := 0; index < 5_000; index++ {
			if index%2 == 0 {
				updateSetting(channelSetting)
			} else {
				updateSetting(groupSetting)
			}
		}
	}()
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 5_000 {
				actions, matched := ResolveRequestErrorRouting(err)
				if !matched || actions.SwitchChannel == actions.SwitchGroup {
					invalid.Store(true)
					return
				}
			}
		}()
	}
	wg.Wait()

	require.False(t, invalid.Load(), "readers must observe one complete immutable setting")
}

func TestValidateRequestErrorRoutingRules(t *testing.T) {
	require.NoError(t, ValidateRequestErrorRoutingRulesJSON(`[{"id":"ok","name":"context","enabled":true,"match_mode":"any","error_codes":"context_length_exceeded","message_match_mode":"contains","switch_channel":true}]`))
	require.NoError(t, ValidateRequestErrorRoutingRulesJSON(`[{"enabled":false,"name":"","description":"","match_mode":"invalid","status_codes":"invalid","message_match_mode":"invalid"}]`))
	require.Error(t, ValidateRequestErrorRoutingRulesJSON(`[{"name":"","enabled":true,"error_codes":"context_length_exceeded"}]`))
	require.Error(t, ValidateRequestErrorRoutingRulesJSON(`[{"name":"empty","enabled":true}]`))
	require.Error(t, ValidateRequestErrorRoutingRulesJSON(`[{"name":"status","enabled":true,"status_codes":"700"}]`))
}
