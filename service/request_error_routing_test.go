package service

import (
	"errors"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type mutableRoutingError struct {
	message string
}

func (err *mutableRoutingError) Error() string {
	return err.message
}

func TestResolveRequestErrorRoutingForContextCachesEachFailureDecision(t *testing.T) {
	current := operation_setting.GetRequestErrorRoutingSetting()
	original := *current
	original.Rules = append([]operation_setting.RequestErrorRoutingRule(nil), current.Rules...)
	t.Cleanup(func() {
		*current = original
		operation_setting.RefreshRequestErrorRoutingSnapshot()
	})

	*current = operation_setting.RequestErrorRoutingSetting{
		Enabled: true,
		Rules: []operation_setting.RequestErrorRoutingRule{
			{
				Name:          "first decision",
				Enabled:       true,
				StatusCodes:   "502",
				SwitchChannel: true,
			},
		},
	}
	operation_setting.RefreshRequestErrorRoutingSnapshot()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	firstFailure := types.NewOpenAIError(errors.New("first failure"), types.ErrorCodeBadResponse, http.StatusBadGateway)

	firstActions, firstMatched := ResolveRequestErrorRoutingForContext(c, firstFailure)
	require.True(t, firstMatched)
	require.True(t, firstActions.SwitchChannel)
	require.False(t, firstActions.SwitchGroup)

	// A setting update must not make different routing stages disagree about
	// one failed attempt that is already being processed.
	current.Rules[0].SwitchChannel = false
	current.Rules[0].SwitchGroup = true
	operation_setting.RefreshRequestErrorRoutingSnapshot()
	cachedActions, cachedMatched := ResolveRequestErrorRoutingForContext(c, firstFailure)
	require.True(t, cachedMatched)
	require.Equal(t, firstActions, cachedActions)

	// The cache is request-local even when the same error pointer is observed.
	otherContext, _ := gin.CreateTestContext(nil)
	otherActions, otherMatched := ResolveRequestErrorRoutingForContext(otherContext, firstFailure)
	require.True(t, otherMatched)
	require.False(t, otherActions.SwitchChannel)
	require.True(t, otherActions.SwitchGroup)

	// Reusing a pointer after changing its routing-relevant contents is a new
	// failure decision, not a cache hit.
	current.Rules[0].StatusCodes = "503"
	operation_setting.RefreshRequestErrorRoutingSnapshot()
	firstFailure.StatusCode = http.StatusServiceUnavailable
	firstFailure.SetResponseMessage("mutated failure")
	mutatedActions, mutatedMatched := ResolveRequestErrorRoutingForContext(c, firstFailure)
	require.True(t, mutatedMatched)
	require.False(t, mutatedActions.SwitchChannel)
	require.True(t, mutatedActions.SwitchGroup)
}

func TestResolveRequestErrorRoutingForContextInvalidatesWhenInternalErrorChanges(t *testing.T) {
	current := operation_setting.GetRequestErrorRoutingSetting()
	original := *current
	original.Rules = append([]operation_setting.RequestErrorRoutingRule(nil), current.Rules...)
	t.Cleanup(func() {
		*current = original
		operation_setting.RefreshRequestErrorRoutingSnapshot()
	})

	*current = operation_setting.RequestErrorRoutingSetting{
		Enabled: true,
		Rules: []operation_setting.RequestErrorRoutingRule{
			{Name: "first", Enabled: true, MessagePatterns: "first raw failure", SwitchChannel: true},
			{Name: "second", Enabled: true, MessagePatterns: "second raw failure", SwitchGroup: true},
		},
	}
	operation_setting.RefreshRequestErrorRoutingSnapshot()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	internalErr := &mutableRoutingError{message: "first raw failure"}
	apiErr := types.NewError(
		internalErr,
		types.ErrorCodeDoRequestFailed,
		types.ErrOptionWithHideErrMsg("upstream error: do request failed"),
	)

	actions, matched := ResolveRequestErrorRoutingForContext(c, apiErr)
	require.True(t, matched)
	require.True(t, actions.SwitchChannel)

	internalErr.message = "second raw failure"
	actions, matched = ResolveRequestErrorRoutingForContext(c, apiErr)
	require.True(t, matched)
	require.False(t, actions.SwitchChannel)
	require.True(t, actions.SwitchGroup)
}
