package zhipu_4v

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesRequestUsesProviderEndpoint(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		want    string
	}{
		{
			name:    "standard GLM endpoint",
			baseURL: "https://open.bigmodel.cn",
			want:    "https://open.bigmodel.cn/api/v1/responses",
		},
		{
			name:    "GLM coding plan endpoint",
			baseURL: "glm-coding-plan",
			want:    "https://open.bigmodel.cn/api/coding/paas/v4/responses",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				RelayMode:   relayconstant.RelayModeResponses,
				ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: test.baseURL},
			}

			requestURL, err := (&Adaptor{}).GetRequestURL(info)

			require.NoError(t, err)
			assert.Equal(t, test.want, requestURL)
		})
	}
}

func TestResponsesRequestPassesThroughNativePayload(t *testing.T) {
	request := dto.OpenAIResponsesRequest{Model: "glm-4.5"}

	converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(nil, nil, request)

	require.NoError(t, err)
	assert.Equal(t, request, converted)
}
