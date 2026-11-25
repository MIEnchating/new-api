package qqbot

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
)

const (
	ChatSourceDisabled      = "disabled"
	ChatSourceBuiltin       = "builtin"
	ChatSourceExternal      = "external"
	ChatProtocolCompletions = "chat_completions"
	ChatProtocolResponses   = "responses"
	ChatProtocolMessages    = "messages"
	maxJSONResponse         = 128 << 10
)

func ChatPath(protocol string) string {
	switch protocol {
	case "", ChatProtocolCompletions:
		return "/v1/chat/completions"
	case ChatProtocolResponses:
		return "/v1/responses"
	case ChatProtocolMessages:
		return "/v1/messages"
	default:
		return ""
	}
}

func parseExternalBaseURL(raw string) (*url.URL, error) {
	errURL := common.NewMessage("Enter a public HTTPS API base URL.")
	if len(raw) > 2048 || strings.ContainsAny(raw, "?#") {
		return nil, errURL
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil ||
		strings.EqualFold(strings.TrimSuffix(u.Hostname(), "."), "localhost") {
		return nil, errURL
	}
	if ip := net.ParseIP(u.Hostname()); ip != nil {
		policy := &common.SSRFProtection{}
		if !policy.IsIPAccessAllowed(ip) {
			return nil, errURL
		}
	}
	if u.Path == "" {
		u.Path = "/v1"
	}
	return u, nil
}

func chatHeaders(protocol, key string) map[string]string {
	if protocol == ChatProtocolMessages {
		return map[string]string{"anthropic-version": "2023-06-01", "x-api-key": key}
	}
	if key == "" {
		return nil
	}
	return map[string]string{"Authorization": "Bearer " + key}
}

// builtinChatTransport dispatches the same authenticated request as a regular
// gateway client, carrying the group in process so it cannot be spoofed over HTTP.
type builtinChatTransport struct {
	gateway          http.Handler
	ownerID, tokenID int
	group            string
}

func (t builtinChatTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Body != nil {
		defer req.Body.Close()
	}
	if t.gateway == nil {
		return nil, errors.New("local gateway unavailable")
	}
	token, err := model.GetTokenByIds(t.tokenID, t.ownerID)
	if err != nil || token.Key == "" {
		return nil, errors.New("selected API key no longer exists")
	}
	local := req.Clone(middleware.WithQQBotTokenGroup(req.Context(), t.tokenID, t.group))
	local.RemoteAddr = "127.0.0.1:0"
	local.RequestURI = req.URL.RequestURI()
	if req.URL.Path == "/v1/messages" {
		local.Header.Set("x-api-key", token.Key)
	} else {
		local.Header.Set("Authorization", "Bearer "+token.Key)
	}
	output := &gatewayResponseWriter{header: make(http.Header), limit: maxJSONResponse}
	t.gateway.ServeHTTP(output, local)
	if output.truncated {
		return nil, errors.New("gateway response exceeded the QQ bot limit")
	}
	if output.status == 0 {
		output.status = http.StatusOK
	}
	return &http.Response{
		StatusCode: output.status, Header: output.header,
		Body: io.NopCloser(bytes.NewReader(output.body.Bytes())), Request: req,
	}, nil
}

type gatewayResponseWriter struct {
	header    http.Header
	body      bytes.Buffer
	limit     int
	status    int
	truncated bool
}

func (w *gatewayResponseWriter) Header() http.Header { return w.header }

func (w *gatewayResponseWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}

func (w *gatewayResponseWriter) Write(data []byte) (int, error) {
	w.WriteHeader(http.StatusOK)
	if len(data) > w.limit-w.body.Len() {
		w.truncated = true
		return 0, errors.New("gateway response exceeded the QQ bot limit")
	}
	return w.body.Write(data)
}

func (w *gatewayResponseWriter) Flush() { w.WriteHeader(http.StatusOK) }

func (b *Bot) chat(ctx context.Context, text string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 28*time.Second)
	defer cancel()
	request := map[string]any{"model": b.chatModel}
	if b.chatProtocol == ChatProtocolResponses {
		request["input"] = text
	} else {
		request["messages"] = []map[string]string{{"role": "user", "content": text}}
	}
	if b.chatProtocol == ChatProtocolMessages {
		request["max_tokens"] = 1024
	}
	type textPart struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Output []struct {
			Type    string     `json:"type"`
			Content []textPart `json:"content"`
		} `json:"output"`
		Content []textPart `json:"content"`
	}
	if _, err := postJSON(ctx, b.chatClient, b.chatURL, chatHeaders(b.chatProtocol, b.chatKey), request, &result); err != nil {
		return "", err
	}
	var answer strings.Builder
	switch b.chatProtocol {
	case ChatProtocolResponses:
		for _, item := range result.Output {
			if item.Type != "message" {
				continue
			}
			for _, part := range item.Content {
				if part.Type == "output_text" {
					answer.WriteString(part.Text)
				}
			}
		}
	case ChatProtocolMessages:
		for _, part := range result.Content {
			if part.Type == "text" {
				answer.WriteString(part.Text)
			}
		}
	default:
		if len(result.Choices) > 0 {
			answer.WriteString(result.Choices[0].Message.Content)
		}
	}
	if value := strings.TrimSpace(answer.String()); value != "" {
		return value, nil
	}
	return "", errors.New("gateway returned no chat text")
}
