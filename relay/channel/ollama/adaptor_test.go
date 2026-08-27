package ollama

import (
	"net/http"
	"net/http/httptest"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetRequestURLRoutesNativeProtocols(t *testing.T) {
	tests := []struct {
		name        string
		relayFormat types.RelayFormat
		relayMode   int
		want        string
	}{
		{name: "Claude Messages", relayFormat: types.RelayFormatClaude, want: "http://localhost:11434/v1/messages"},
		{name: "OpenAI Responses", relayMode: relayconstant.RelayModeResponses, want: "http://localhost:11434/v1/responses"},
		{name: "OpenAI Responses compaction", relayMode: relayconstant.RelayModeResponsesCompact, want: "http://localhost:11434/v1/responses/compact"},
		{name: "OpenAI Completions", relayMode: relayconstant.RelayModeCompletions, want: "http://localhost:11434/api/generate"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				RelayFormat: test.relayFormat,
				RelayMode:   test.relayMode,
				ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: "http://localhost:11434"},
			}

			requestURL, err := (&Adaptor{}).GetRequestURL(info)

			require.NoError(t, err)
			assert.Equal(t, test.want, requestURL)
		})
	}
}

func TestClaudeMessagesPassThroughRequestAndHeaders(t *testing.T) {
	request := &dto.ClaudeRequest{Model: "qwen3"}
	info := &relaycommon.RelayInfo{
		RelayFormat: types.RelayFormatClaude,
		ChannelMeta: &relaycommon.ChannelMeta{ApiKey: "ollama-key"},
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	c.Request.Header.Set("anthropic-version", "2026-08-27")
	c.Request.Header.Set("anthropic-beta", "test-feature")

	converted, err := (&Adaptor{}).ConvertClaudeRequest(c, info, request)
	require.NoError(t, err)
	assert.Same(t, request, converted)

	header := http.Header{}
	require.NoError(t, (&Adaptor{}).SetupRequestHeader(c, &header, info))
	assert.Equal(t, "Bearer ollama-key", header.Get("Authorization"))
	assert.Equal(t, "2026-08-27", header.Get("anthropic-version"))
	assert.Equal(t, "test-feature", header.Get("anthropic-beta"))
}
