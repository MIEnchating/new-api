package xai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestXAIStreamPreservesUsageDetailsForSettlementAndClient(t *testing.T) {
	previousTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{IsStream: true, DisablePing: true}
	const frame = `{"id":"chat-1","object":"chat.completion.chunk","model":"grok-4","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":10,"total_tokens":130,"prompt_tokens_details":{"cached_tokens":60,"text_tokens":40},"completion_tokens_details":{"reasoning_tokens":20,"text_tokens":10}}}`
	response := &http.Response{Body: io.NopCloser(strings.NewReader("data: " + frame + "\n\ndata: [DONE]\n\n"))}
	usage, apiErr := xAIStreamHandler(c, info, response)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, 100, usage.PromptTokens)
	assert.Equal(t, 30, usage.CompletionTokens)
	assert.Equal(t, 130, usage.TotalTokens)
	assert.Equal(t, 60, usage.PromptTokensDetails.CachedTokens)
	assert.Equal(t, 20, usage.CompletionTokenDetails.ReasoningTokens)

	var forwarded *dto.Usage
	for line := range strings.SplitSeq(recorder.Body.String(), "\n") {
		payload, ok := strings.CutPrefix(line, "data: ")
		if !ok || payload == "[DONE]" {
			continue
		}
		var chunk dto.ChatCompletionsStreamResponse
		require.NoError(t, common.UnmarshalJsonStr(payload, &chunk))
		if chunk.Usage != nil {
			forwarded = chunk.Usage
		}
	}
	require.NotNil(t, forwarded)
	assert.Equal(t, usage, forwarded)
	assert.Contains(t, recorder.Body.String(), "data: [DONE]")
}
