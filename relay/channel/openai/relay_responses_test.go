package openai

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type responseFlushSignalWriter struct {
	gin.ResponseWriter
	flushed chan struct{}
}

func (w *responseFlushSignalWriter) Flush() {
	w.ResponseWriter.Flush()
	select {
	case w.flushed <- struct{}{}:
	default:
	}
}

func TestOaiResponsesStreamHandler_CompletedEndsWithoutDoneOrEOF(t *testing.T) {
	setResponsesStreamTestTimeout(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pr, pw := io.Pipe()
	t.Cleanup(func() {
		_ = pr.Close()
		_ = pw.Close()
	})

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(ctx)
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       pr,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
	}
	info := &relaycommon.RelayInfo{
		IsStream:    true,
		DisablePing: true,
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-test"},
	}

	type streamResult struct {
		usage  *dto.Usage
		apiErr *types.NewAPIError
	}
	resultCh := make(chan streamResult, 1)
	go func() {
		usage, apiErr := OaiResponsesStreamHandler(c, info, resp)
		resultCh <- streamResult{usage: usage, apiErr: apiErr}
	}()

	completed := `{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":11,"output_tokens":7,"total_tokens":18,"input_tokens_details":{"cached_tokens":3}}}}`
	_, err := fmt.Fprintf(pw, "data: %s\n", completed)
	require.NoError(t, err)

	var result streamResult
	select {
	case result = <-resultCh:
	case <-time.After(2 * time.Second):
		t.Fatal("handler waited for [DONE] or EOF after response.completed")
	}

	require.Nil(t, result.apiErr)
	require.NotNil(t, result.usage)
	require.Equal(t, 11, result.usage.PromptTokens)
	require.Equal(t, 7, result.usage.CompletionTokens)
	require.Equal(t, 18, result.usage.TotalTokens)
	require.Equal(t, 3, result.usage.PromptTokensDetails.CachedTokens)
	require.NotNil(t, info.StreamStatus)
	require.Equal(t, relaycommon.StreamEndReasonDone, info.StreamStatus.EndReason)
	require.NoError(t, info.StreamStatus.EndError)
	require.Contains(t, recorder.Body.String(), `event: response.completed`)

	cancel()
	require.Equal(t, relaycommon.StreamEndReasonDone, info.StreamStatus.EndReason)
}

func TestOaiResponsesStreamHandler_IncompleteIsTerminal(t *testing.T) {
	setResponsesStreamTestTimeout(t)

	pr, pw := io.Pipe()
	t.Cleanup(func() {
		_ = pr.Close()
		_ = pw.Close()
	})

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	resp := &http.Response{StatusCode: http.StatusOK, Body: pr}
	info := &relaycommon.RelayInfo{
		IsStream:    true,
		DisablePing: true,
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-test"},
	}

	type streamResult struct {
		usage  *dto.Usage
		apiErr *types.NewAPIError
	}
	resultCh := make(chan streamResult, 1)
	go func() {
		usage, apiErr := OaiResponsesStreamHandler(c, info, resp)
		resultCh <- streamResult{usage: usage, apiErr: apiErr}
	}()

	incomplete := `{"type":"response.incomplete","response":{"status":"incomplete","usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}}`
	_, err := fmt.Fprintf(pw, "data: %s\n", incomplete)
	require.NoError(t, err)

	select {
	case result := <-resultCh:
		require.Nil(t, result.apiErr)
		require.Equal(t, 7, result.usage.TotalTokens)
	case <-time.After(2 * time.Second):
		t.Fatal("handler waited for EOF after response.incomplete")
	}

	require.Equal(t, relaycommon.StreamEndReasonDone, info.StreamStatus.EndReason)
	require.Contains(t, recorder.Body.String(), `event: response.incomplete`)
}

func TestOaiResponsesStreamHandler_FailureEventsAreTerminals(t *testing.T) {
	setResponsesStreamTestTimeout(t)

	tests := []struct {
		eventType string
		payload   string
		wantUsage dto.Usage
	}{
		{
			eventType: "response.failed",
			payload:   `{"type":"response.failed","response":{"status":"failed","usage":{"input_tokens":9,"output_tokens":2,"total_tokens":11,"input_tokens_details":{"cached_tokens":4}}}}`,
			wantUsage: dto.Usage{PromptTokens: 9, CompletionTokens: 2, TotalTokens: 11, PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 4}},
		},
		{
			eventType: "response.error",
			payload:   `{"type":"response.error"}`,
		},
	}

	for _, test := range tests {
		t.Run(test.eventType, func(t *testing.T) {
			pr, pw := io.Pipe()
			t.Cleanup(func() {
				_ = pr.Close()
				_ = pw.Close()
			})

			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			resp := &http.Response{StatusCode: http.StatusOK, Body: pr}
			info := &relaycommon.RelayInfo{
				IsStream:    true,
				DisablePing: true,
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-test"},
			}

			type streamResult struct {
				usage  *dto.Usage
				apiErr *types.NewAPIError
			}
			resultCh := make(chan streamResult, 1)
			go func() {
				usage, apiErr := OaiResponsesStreamHandler(c, info, resp)
				resultCh <- streamResult{usage: usage, apiErr: apiErr}
			}()

			_, err := fmt.Fprintf(pw, "data: %s\n", test.payload)
			require.NoError(t, err)

			select {
			case result := <-resultCh:
				require.Nil(t, result.apiErr)
				require.Equal(t, test.wantUsage, *result.usage)
			case <-time.After(2 * time.Second):
				t.Fatalf("handler waited for EOF after %s", test.eventType)
			}

			require.Equal(t, relaycommon.StreamEndReasonUpstreamTerminalErr, info.StreamStatus.EndReason)
			require.ErrorContains(t, info.StreamStatus.EndError, test.eventType)
			require.True(t, info.StreamStatus.HasErrors())
			require.Contains(t, recorder.Body.String(), "event: "+test.eventType)
		})
	}
}

func setResponsesStreamTestTimeout(t *testing.T) {
	t.Helper()
	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() {
		constant.StreamingTimeout = oldStreamingTimeout
	})
}

func TestOaiResponsesStreamHandler_ClientCancelBeforeTerminalKeepsClientGoneAndZeroUsage(t *testing.T) {
	setResponsesStreamTestTimeout(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pr, pw := io.Pipe()
	t.Cleanup(func() {
		_ = pr.Close()
		_ = pw.Close()
	})

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(ctx)
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       pr,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
	}
	info := &relaycommon.RelayInfo{
		StartTime:   time.Now(),
		IsStream:    true,
		DisablePing: true,
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-test"},
	}

	type streamResult struct {
		usage  *dto.Usage
		apiErr *types.NewAPIError
	}
	started := make(chan struct{})
	resultCh := make(chan streamResult, 1)
	go func() {
		close(started)
		usage, apiErr := OaiResponsesStreamHandler(c, info, resp)
		resultCh <- streamResult{usage: usage, apiErr: apiErr}
	}()

	<-started
	time.Sleep(50 * time.Millisecond)
	cancel()

	var result streamResult
	select {
	case result = <-resultCh:
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not return after client cancellation")
	}

	require.Nil(t, result.apiErr)
	require.NotNil(t, result.usage)
	require.Zero(t, result.usage.PromptTokens)
	require.Zero(t, result.usage.CompletionTokens)
	require.Zero(t, result.usage.TotalTokens)
	require.NotNil(t, info.StreamStatus)
	require.Equal(t, relaycommon.StreamEndReasonClientGone, info.StreamStatus.EndReason)
	require.ErrorIs(t, info.StreamStatus.EndError, context.Canceled)
	require.Empty(t, recorder.Body.String())
}

func TestOaiResponsesStreamHandler_EOFBeforeFirstEventReturnsRetryableError(t *testing.T) {
	setResponsesStreamTestTimeout(t)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader("")),
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
	}
	info := &relaycommon.RelayInfo{
		StartTime:   time.Now(),
		IsStream:    true,
		DisablePing: true,
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-test"},
	}

	usage, apiErr := OaiResponsesStreamHandler(c, info, resp)

	require.NotNil(t, usage)
	require.Zero(t, usage.TotalTokens)
	require.NotNil(t, apiErr)
	require.Equal(t, http.StatusBadGateway, apiErr.StatusCode)
	require.Equal(t, types.ErrorCodeReadResponseBodyFailed, apiErr.GetErrorCode())
	require.NotNil(t, info.StreamStatus)
	require.Equal(t, relaycommon.StreamEndReasonMissingTerminal, info.StreamStatus.EndReason)
	require.ErrorIs(t, info.StreamStatus.EndError, io.ErrUnexpectedEOF)
	require.Empty(t, recorder.Body.String())
}

func TestOaiResponsesStreamHandler_PartialSSEThenEOFReportsMissingTerminal(t *testing.T) {
	setResponsesStreamTestTimeout(t)

	partial := `data: {"type":"response.created","response":{"status":"in_progress"}}` + "\n"
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(partial)),
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
	}
	info := &relaycommon.RelayInfo{
		StartTime:   time.Now(),
		IsStream:    true,
		DisablePing: true,
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-test"},
	}

	usage, apiErr := OaiResponsesStreamHandler(c, info, resp)

	require.Nil(t, apiErr, "partial SSE cannot be replaced with a JSON retry response")
	require.NotNil(t, usage)
	require.Zero(t, usage.TotalTokens)
	require.NotNil(t, info.StreamStatus)
	require.Equal(t, relaycommon.StreamEndReasonMissingTerminal, info.StreamStatus.EndReason)
	require.ErrorIs(t, info.StreamStatus.EndError, io.ErrUnexpectedEOF)
	require.Contains(t, recorder.Body.String(), `event: response.created`)
	require.Contains(t, recorder.Body.String(), `"status":"in_progress"`)
}

func TestOaiResponsesStreamHandler_MultipleDeltasThenEOFKeepEstimatedUsageAndError(t *testing.T) {
	setResponsesStreamTestTimeout(t)

	body := strings.Join([]string{
		`data: {"type":"response.output_text.delta","delta":"first "}`,
		`data: {"type":"response.output_text.delta","delta":"second "}`,
		`data: {"type":"response.output_text.delta","delta":"third"}`,
	}, "\n") + "\n"
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
	}
	info := &relaycommon.RelayInfo{
		StartTime:   time.Now(),
		IsStream:    true,
		DisablePing: true,
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "local-test-model"},
	}
	info.SetEstimatePromptTokens(123)

	usage, apiErr := OaiResponsesStreamHandler(c, info, resp)

	require.Nil(t, apiErr)
	require.Equal(t, 123, usage.PromptTokens)
	require.Positive(t, usage.CompletionTokens)
	require.Equal(t, usage.PromptTokens+usage.CompletionTokens, usage.TotalTokens)
	require.Equal(t, relaycommon.StreamEndReasonMissingTerminal, info.StreamStatus.EndReason)
	require.False(t, info.StreamStatus.IsNormalEnd(), "estimated tokens must not turn a truncated stream into success")
	require.Equal(t, 3, info.SendResponseCount)
}

func TestOaiResponsesStreamHandler_MultipleDeltasThenClientCancelKeepsClientGone(t *testing.T) {
	setResponsesStreamTestTimeout(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pr, pw := io.Pipe()
	t.Cleanup(func() {
		_ = pr.Close()
		_ = pw.Close()
	})

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	flushes := make(chan struct{}, 8)
	c.Writer = &responseFlushSignalWriter{ResponseWriter: c.Writer, flushed: flushes}
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(ctx)
	resp := &http.Response{StatusCode: http.StatusOK, Body: pr}
	info := &relaycommon.RelayInfo{
		StartTime:   time.Now(),
		IsStream:    true,
		DisablePing: true,
		ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "local-test-model"},
	}
	info.SetEstimatePromptTokens(123)

	type streamResult struct {
		usage  *dto.Usage
		apiErr *types.NewAPIError
	}
	resultCh := make(chan streamResult, 1)
	go func() {
		usage, apiErr := OaiResponsesStreamHandler(c, info, resp)
		resultCh <- streamResult{usage: usage, apiErr: apiErr}
	}()

	for _, delta := range []string{"first ", "second ", "third"} {
		_, err := fmt.Fprintf(pw, "data: {\"type\":\"response.output_text.delta\",\"delta\":%q}\n", delta)
		require.NoError(t, err)
	}
	for range 3 {
		select {
		case <-flushes:
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for downstream flush")
		}
	}
	cancel()

	select {
	case result := <-resultCh:
		require.Nil(t, result.apiErr)
		require.Equal(t, 123, result.usage.PromptTokens)
		require.Positive(t, result.usage.CompletionTokens)
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not return after client cancellation")
	}

	require.Equal(t, relaycommon.StreamEndReasonClientGone, info.StreamStatus.EndReason)
	require.ErrorIs(t, info.StreamStatus.EndError, context.Canceled)
	require.False(t, info.StreamStatus.IsNormalEnd())
	require.Equal(t, 3, info.SendResponseCount)
}
