package service

import (
	"errors"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestShouldDisableChannelIgnoresDeterministicRequestFailure(t *testing.T) {
	originalEnabled := common.AutomaticDisableChannelEnabled
	originalRanges := append([]operation_setting.StatusCodeRange(nil), operation_setting.AutomaticDisableStatusCodeRanges...)
	t.Cleanup(func() {
		common.AutomaticDisableChannelEnabled = originalEnabled
		operation_setting.AutomaticDisableStatusCodeRanges = originalRanges
	})
	common.AutomaticDisableChannelEnabled = true
	operation_setting.AutomaticDisableStatusCodeRanges = []operation_setting.StatusCodeRange{{Start: http.StatusBadGateway, End: http.StatusBadGateway}}

	contextWindowErr := types.WithOpenAIError(types.OpenAIError{
		Message: "Your input exceeds the context window of this model. Please adjust your input and try again.",
		Type:    "upstream_error",
	}, http.StatusBadGateway)
	require.False(t, ShouldDisableChannel(contextWindowErr))

	genericGatewayErr := types.NewOpenAIError(
		errors.New("temporary upstream failure"),
		types.ErrorCodeBadResponseStatusCode,
		http.StatusBadGateway,
	)
	require.True(t, ShouldDisableChannel(genericGatewayErr))
}
