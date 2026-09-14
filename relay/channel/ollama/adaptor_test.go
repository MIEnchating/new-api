package ollama

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetRequestURLRoutesProtocols(t *testing.T) {
	tests := []struct {
		name        string
		relayFormat types.RelayFormat
		relayMode   int
		want        string
	}{
		{name: "OpenAI Chat Completions", relayMode: relayconstant.RelayModeChatCompletions, want: "http://localhost:11434/api/chat"},
		{name: "Claude Messages", relayFormat: types.RelayFormatClaude, want: "http://localhost:11434/v1/messages"},
		{name: "OpenAI Responses", relayMode: relayconstant.RelayModeResponses, want: "http://localhost:11434/v1/responses"},
		{name: "OpenAI Responses compaction", relayMode: relayconstant.RelayModeResponsesCompact, want: "http://localhost:11434/v1/responses/compact"},
		{name: "OpenAI Completions", relayMode: relayconstant.RelayModeCompletions, want: "http://localhost:11434/api/generate"},
		{name: "OpenAI Embeddings", relayMode: relayconstant.RelayModeEmbeddings, want: "http://localhost:11434/api/embed"},
	}

	for _, test := range tests {
		for _, openAIChat := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/openai_chat=%t", test.name, openAIChat), func(t *testing.T) {
				info := &relaycommon.RelayInfo{
					RelayFormat: test.relayFormat,
					RelayMode:   test.relayMode,
					ChannelMeta: &relaycommon.ChannelMeta{
						ChannelType:          constant.ChannelTypeOllama,
						ChannelBaseUrl:       "http://localhost:11434",
						ChannelOtherSettings: dto.ChannelOtherSettings{OllamaOpenAIChat: openAIChat},
					},
				}

				requestURL, err := (&Adaptor{}).GetRequestURL(info)

				require.NoError(t, err)
				want := test.want
				if openAIChat && test.relayMode == relayconstant.RelayModeChatCompletions {
					want = "http://localhost:11434/v1/chat/completions"
				}
				assert.Equal(t, want, requestURL)
			})
		}
	}
}

func TestOllamaOpenAIChatPreservesRequest(t *testing.T) {
	const body = `{
		"model":"qwen3",
		"stream":true,
		"stream_options":{"include_usage":true},
		"temperature":0,
		"top_p":0,
		"seed":0,
		"max_tokens":64,
		"parallel_tool_calls":false,
		"tools":[{"type":"function","function":{"name":"get_weather","description":"Weather","parameters":{"type":"object","properties":{"days":{"type":"integer"}}}}}],
		"messages":[
			{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\"days\":0}"}}]},
			{"role":"tool","tool_call_id":"call_1","content":"sunny"}
		]
	}`
	var request dto.GeneralOpenAIRequest
	require.NoError(t, common.UnmarshalJsonStr(body, &request))
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{
		RelayFormat: types.RelayFormatOpenAI,
		RelayMode:   relayconstant.RelayModeChatCompletions,
		IsStream:    true,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:          constant.ChannelTypeOllama,
			UpstreamModelName:    "qwen3",
			SupportStreamOptions: true,
			ChannelOtherSettings: dto.ChannelOtherSettings{OllamaOpenAIChat: true},
		},
	}

	converted, err := (&Adaptor{}).ConvertOpenAIRequest(c, info, &request)
	require.NoError(t, err)
	encoded, err := common.Marshal(converted)
	require.NoError(t, err)
	assert.JSONEq(t, body, string(encoded))
}

func TestOllamaOpenAIChatResponsePreservesToolsAndUsage(t *testing.T) {
	previousTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })

	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%t", stream), func(t *testing.T) {
			body := `{"id":"chatcmpl_1","object":"chat.completion","model":"qwen3","choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\"days\":0}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":123,"completion_tokens":17,"total_tokens":140}}`
			contentType := "application/json"
			if stream {
				contentType = "text/event-stream"
				body = strings.Join([]string{
					`data: {"id":"chatcmpl_1","object":"chat.completion.chunk","model":"qwen3","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\"days\":"}}]}}]}`,
					``,
					`data: {"id":"chatcmpl_1","object":"chat.completion.chunk","model":"qwen3","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"0}"}}]}}]}`,
					``,
					`data: {"id":"chatcmpl_1","object":"chat.completion.chunk","model":"qwen3","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
					``,
					`data: {"id":"chatcmpl_1","object":"chat.completion.chunk","model":"qwen3","choices":[],"usage":{"prompt_tokens":123,"completion_tokens":17,"total_tokens":140}}`,
					``,
					`data: [DONE]`,
					``,
				}, "\n")
			}
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			info := &relaycommon.RelayInfo{
				RelayFormat:        types.RelayFormatOpenAI,
				RelayMode:          relayconstant.RelayModeChatCompletions,
				IsStream:           stream,
				ShouldIncludeUsage: true,
				DisablePing:        true,
				ChannelMeta: &relaycommon.ChannelMeta{
					ChannelType:          constant.ChannelTypeOllama,
					UpstreamModelName:    "qwen3",
					ChannelOtherSettings: dto.ChannelOtherSettings{OllamaOpenAIChat: true},
				},
			}
			adaptor := &Adaptor{}
			adaptor.Init(info)

			usage, apiErr := adaptor.DoResponse(c, &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{contentType}},
				Body:       io.NopCloser(strings.NewReader(body)),
			}, info)

			require.Nil(t, apiErr)
			assert.Equal(t, &dto.Usage{PromptTokens: 123, CompletionTokens: 17, TotalTokens: 140}, usage)
			if !stream {
				assert.JSONEq(t, body, recorder.Body.String())
				return
			}
			var argumentParts strings.Builder
			var calls []dto.ToolCallResponse
			var finishReason string
			var streamUsage *dto.Usage
			for line := range strings.SplitSeq(recorder.Body.String(), "\n") {
				data, ok := strings.CutPrefix(line, "data: ")
				if !ok || data == "[DONE]" {
					continue
				}
				var chunk dto.ChatCompletionsStreamResponse
				require.NoError(t, common.UnmarshalJsonStr(data, &chunk))
				if chunk.Usage != nil {
					streamUsage = chunk.Usage
				}
				for _, choice := range chunk.Choices {
					calls = append(calls, choice.Delta.ToolCalls...)
					for _, call := range choice.Delta.ToolCalls {
						argumentParts.WriteString(call.Function.Arguments)
					}
					if choice.FinishReason != nil {
						finishReason = *choice.FinishReason
					}
				}
			}
			require.Len(t, calls, 2)
			assert.Equal(t, "call_1", calls[0].ID)
			assert.Equal(t, "get_weather", calls[0].Function.Name)
			for _, call := range calls {
				require.NotNil(t, call.Index)
				assert.Zero(t, *call.Index)
			}
			assert.JSONEq(t, `{"days":0}`, argumentParts.String())
			assert.Equal(t, "tool_calls", finishReason)
			assert.Equal(t, usage, streamUsage)
			assert.Contains(t, recorder.Body.String(), "data: [DONE]")
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
