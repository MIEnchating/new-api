package channel

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	channelconstant "github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestApplyClaudeCodeClientHeaders_ChannelAndProtocolIsolation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		channelType int
		relayFormat types.RelayFormat
		requestPath string
		enabled     bool
		wantSpoofed bool
	}{
		{
			name:        "anthropic converted request",
			channelType: channelconstant.ChannelTypeAnthropic,
			relayFormat: types.RelayFormatOpenAI,
			enabled:     true,
			wantSpoofed: true,
		},
		{
			name:        "sub2api claude request",
			channelType: channelconstant.ChannelTypeSub2API,
			relayFormat: types.RelayFormatClaude,
			enabled:     true,
			wantSpoofed: true,
		},
		{
			name:        "new api claude path",
			channelType: channelconstant.ChannelTypeNewAPI,
			relayFormat: types.RelayFormatOpenAI,
			requestPath: "/v1/messages/",
			enabled:     true,
			wantSpoofed: true,
		},
		{
			name:        "sub2api openai request",
			channelType: channelconstant.ChannelTypeSub2API,
			relayFormat: types.RelayFormatOpenAIResponses,
			requestPath: "/v1/responses",
			enabled:     true,
			wantSpoofed: false,
		},
		{
			name:        "new api openai request",
			channelType: channelconstant.ChannelTypeNewAPI,
			relayFormat: types.RelayFormatOpenAI,
			requestPath: "/v1/chat/completions",
			enabled:     true,
			wantSpoofed: false,
		},
		{
			name:        "unsupported channel",
			channelType: channelconstant.ChannelTypeOpenAI,
			relayFormat: types.RelayFormatClaude,
			requestPath: "/v1/messages",
			enabled:     true,
			wantSpoofed: false,
		},
		{
			name:        "disabled",
			channelType: channelconstant.ChannelTypeAnthropic,
			relayFormat: types.RelayFormatClaude,
			enabled:     false,
			wantSpoofed: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			info := &relaycommon.RelayInfo{
				RelayFormat:    tt.relayFormat,
				RequestURLPath: tt.requestPath,
				ChannelMeta: &relaycommon.ChannelMeta{
					ChannelType: tt.channelType,
					ChannelOtherSettings: dto.ChannelOtherSettings{
						ClaudeCodeClientSpoofing: tt.enabled,
					},
				},
			}
			req := httptest.NewRequest(http.MethodPost, "https://upstream.example", nil)

			applyClaudeCodeClientHeaders(req, info)

			if tt.wantSpoofed {
				require.Equal(t, claudeCodeUserAgent, req.Header.Get("User-Agent"))
				require.Equal(t, "cli", req.Header.Get("X-App"))
				require.Equal(t, claudeCodeBetaHeader, req.Header.Get("Anthropic-Beta"))
				require.Equal(t, "2023-06-01", req.Header.Get("Anthropic-Version"))
				return
			}
			require.NotEqual(t, claudeCodeUserAgent, req.Header.Get("User-Agent"))
			require.Empty(t, req.Header.Get("X-App"))
		})
	}
}

func TestApplyClaudeCodeClientBody_InjectsStrictSub2APIIdentity(t *testing.T) {
	t.Parallel()

	info := &relaycommon.RelayInfo{
		UserId:      7,
		TokenId:     11,
		RelayFormat: types.RelayFormatOpenAI,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: channelconstant.ChannelTypeAnthropic,
			ChannelId:   98,
			ChannelOtherSettings: dto.ChannelOtherSettings{
				ClaudeCodeClientSpoofing: true,
			},
		},
	}
	original := `{"model":"claude-sonnet-4-5","max_tokens":64,"system":"Keep the original instructions.","messages":[{"role":"user","content":"hello"}]}`

	reader, size, err := applyClaudeCodeClientBody(strings.NewReader(original), info)
	require.NoError(t, err)
	bodyBytes, err := io.ReadAll(reader)
	require.NoError(t, err)
	require.Equal(t, int64(len(bodyBytes)), size)

	var body map[string]any
	require.NoError(t, json.Unmarshal(bodyBytes, &body))
	system, ok := body["system"].([]any)
	require.True(t, ok)
	require.Len(t, system, 2)
	identityBlock, ok := system[0].(map[string]any)
	require.True(t, ok)
	require.Equal(t, claudeCodeSystemPrompt, identityBlock["text"])
	originalBlock, ok := system[1].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "Keep the original instructions.", originalBlock["text"])

	metadata, ok := body["metadata"].(map[string]any)
	require.True(t, ok)
	metadataUserID, ok := metadata["user_id"].(string)
	require.True(t, ok)
	var identity map[string]string
	require.NoError(t, json.Unmarshal([]byte(metadataUserID), &identity))
	require.Len(t, identity["device_id"], 64)
	_, err = uuid.Parse(identity["account_uuid"])
	require.NoError(t, err)
	_, err = uuid.Parse(identity["session_id"])
	require.NoError(t, err)
	require.Equal(t, metadataUserID, claudeCodeMetadataUserID(info))
}

func TestApplyClaudeCodeClientBody_RejectsInvalidJSON(t *testing.T) {
	t.Parallel()

	info := &relaycommon.RelayInfo{
		RelayFormat: types.RelayFormatClaude,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: channelconstant.ChannelTypeSub2API,
			ChannelOtherSettings: dto.ChannelOtherSettings{
				ClaudeCodeClientSpoofing: true,
			},
		},
	}
	_, _, err := applyClaudeCodeClientBody(strings.NewReader(`{"model":`), info)
	require.Error(t, err)
}

func TestClaudeCodeClientHeaders_ExplicitOverrideWins(t *testing.T) {
	t.Parallel()

	info := &relaycommon.RelayInfo{
		RelayFormat: types.RelayFormatClaude,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: channelconstant.ChannelTypeAnthropic,
			ChannelOtherSettings: dto.ChannelOtherSettings{
				ClaudeCodeClientSpoofing: true,
			},
		},
	}
	req := httptest.NewRequest(http.MethodPost, "https://upstream.example", nil)
	applyClaudeCodeClientHeaders(req, info)
	applyHeaderOverrideToRequest(req, map[string]string{
		"user-agent": "custom-client/1.0",
		"x-app":      "custom",
	})

	require.Equal(t, "custom-client/1.0", req.Header.Get("User-Agent"))
	require.Equal(t, "custom", req.Header.Get("X-App"))
}

func TestProcessHeaderOverride_ChannelTestSkipsPassthroughRules(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"*": "",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Empty(t, headers)
}

func TestProcessHeaderOverride_ChannelTestSkipsClientHeaderPlaceholder(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Upstream-Trace": "{client_header:X-Trace-Id}",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	_, ok := headers["x-upstream-trace"]
	require.False(t, ok)
}

func TestProcessHeaderOverride_NonTestKeepsClientHeaderPlaceholder(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Upstream-Trace": "{client_header:X-Trace-Id}",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "trace-123", headers["x-upstream-trace"])
}

func TestProcessHeaderOverride_RuntimeOverrideIsFinalHeaderMap(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	info := &relaycommon.RelayInfo{
		IsChannelTest:             false,
		UseRuntimeHeadersOverride: true,
		RuntimeHeadersOverride: map[string]any{
			"x-static":  "runtime-value",
			"x-runtime": "runtime-only",
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Static": "legacy-value",
				"X-Legacy": "legacy-only",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "runtime-value", headers["x-static"])
	require.Equal(t, "runtime-only", headers["x-runtime"])
	_, exists := headers["x-legacy"]
	require.False(t, exists)
}

func TestProcessHeaderOverride_PassthroughSkipsAcceptEncoding(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")
	ctx.Request.Header.Set("Accept-Encoding", "gzip")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"*": "",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "trace-123", headers["x-trace-id"])

	_, hasAcceptEncoding := headers["accept-encoding"]
	require.False(t, hasAcceptEncoding)
}

func TestProcessHeaderOverride_PassHeadersTemplateSetsRuntimeHeaders(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	ctx.Request.Header.Set("Originator", "Codex CLI")
	ctx.Request.Header.Set("Session_id", "sess-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		RequestHeaders: map[string]string{
			"Originator": "Codex CLI",
			"Session_id": "sess-123",
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			ParamOverride: map[string]any{
				"operations": []any{
					map[string]any{
						"mode":  "pass_headers",
						"value": []any{"Originator", "Session_id", "X-Codex-Beta-Features"},
					},
				},
			},
			HeadersOverride: map[string]any{
				"X-Static": "legacy-value",
			},
		},
	}

	_, err := relaycommon.ApplyParamOverrideWithRelayInfo([]byte(`{"model":"gpt-4.1"}`), info)
	require.NoError(t, err)
	require.True(t, info.UseRuntimeHeadersOverride)
	require.Equal(t, "Codex CLI", info.RuntimeHeadersOverride["originator"])
	require.Equal(t, "sess-123", info.RuntimeHeadersOverride["session_id"])
	_, exists := info.RuntimeHeadersOverride["x-codex-beta-features"]
	require.False(t, exists)
	require.Equal(t, "legacy-value", info.RuntimeHeadersOverride["x-static"])

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "Codex CLI", headers["originator"])
	require.Equal(t, "sess-123", headers["session_id"])
	_, exists = headers["x-codex-beta-features"]
	require.False(t, exists)

	upstreamReq := httptest.NewRequest(http.MethodPost, "https://example.com/v1/responses", nil)
	applyHeaderOverrideToRequest(upstreamReq, headers)
	require.Equal(t, "Codex CLI", upstreamReq.Header.Get("Originator"))
	require.Equal(t, "sess-123", upstreamReq.Header.Get("Session_id"))
	require.Empty(t, upstreamReq.Header.Get("X-Codex-Beta-Features"))
}
