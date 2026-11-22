package openai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The next upstream read stays blocked until the scanner closes its body.
// The channels let the downstream writer force cancellation during the final
// callback without depending on sleeps or goroutine scheduling.
type responsesLifecycleBody struct {
	data      *strings.Reader
	waiting   chan struct{}
	closed    chan struct{}
	readOnce  sync.Once
	closeOnce sync.Once
	readErr   error
	closeErr  error
}

func TestOaiResponsesStreamHandlerFiltersOnlyConfirmedAssistantPlaceholders(t *testing.T) {
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 3
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })

	for _, tc := range []struct {
		name       string
		id         string
		text       string
		enabled    bool
		interleave bool
		incomplete bool
		drop       bool
	}{
		{name: "disabled preserves the matching message", id: "msg_ack_ack_1", text: " "},
		{name: "EasyAPI placeholder", id: "msg_ack_ack_1", text: " ", enabled: true, drop: true},
		{name: "OneBool placeholder", id: "item_fake_ttft_1", text: " ", enabled: true, drop: true},
		{name: "single blank message with a new ID format", id: "a1d8eec9-52d9-4119-8662-b040aa7bb4b7", text: " ", enabled: true, drop: true},
		{name: "assistant message with regular text", id: "msg_1", text: " text", enabled: true},
		{name: "message with two spaces remains intact", id: "msg_1", text: "  ", enabled: true},
		{name: "message without a stable ID remains intact", text: " ", enabled: true},
		{name: "interleaved tool must stay ordered", id: "msg_ack_ack_1", text: " ", enabled: true, interleave: true},
		{name: "unconfirmed item on EOF", id: "msg_ack_ack_1", text: " ", enabled: true, incomplete: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			item := fmt.Sprintf(`{"id":%q,"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":%q}]}`, tc.id, tc.text)
			added := fmt.Sprintf(`{"type":"response.output_item.added","output_index":0,"item":{"id":%q,"type":"message","role":"assistant","status":"in_progress","content":[]}}`, tc.id)
			part := fmt.Sprintf(`{"type":"response.content_part.added","item_id":%q,"output_index":0,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}`, tc.id)
			delta := fmt.Sprintf(`{"type":"response.output_text.delta","item_id":%q,"output_index":0,"content_index":0,"delta":%q}`, tc.id, tc.text)
			done := fmt.Sprintf(`{"type":"response.output_item.done","output_index":0,"item":%s}`, item)
			tool := `{"id":"fc_1","type":"function_call","name":"exec_command","call_id":"call_1","arguments":"{}","status":"completed"}`
			toolEvent := fmt.Sprintf(`{"type":"response.output_item.done","output_index":1,"item":%s}`, tool)
			tail := fmt.Sprintf(`{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":7,"output_tokens":5,"total_tokens":12},"output":[%s,%s]}}`, item, tool)
			frames := []string{added, part, delta, done, toolEvent, tail}
			if tc.interleave {
				frames = []string{added, part, toolEvent, delta, done, tail}
			}
			if tc.incomplete {
				frames = frames[:3]
			}

			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			info := &relaycommon.RelayInfo{
				OriginModelName: "gpt-6.2-sol", StartTime: time.Now(),
				RelayFormat: types.RelayFormatOpenAIResponses,
				ChannelMeta: &relaycommon.ChannelMeta{
					UpstreamModelName:    "gpt-6.2-sol",
					ChannelOtherSettings: dto.ChannelOtherSettings{FilterBlankResponsesMessages: tc.enabled},
				},
			}
			sse := "data: " + strings.Join(frames, "\n\ndata: ") + "\n\n"
			usage, apiErr := OaiResponsesStreamHandler(c, info, &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(sse)),
			})
			require.Nil(t, apiErr)
			got := recorder.Body.String()
			if tc.incomplete {
				require.Contains(t, got, added)
				require.Contains(t, got, delta)
				require.NotEqual(t, string(relaycommon.ResponseOutcomeCompleted), info.StreamStatus.ResponseOutcome())
				return
			}
			require.Equal(t, 12, usage.TotalTokens)
			require.Equal(t, string(relaycommon.ResponseOutcomeCompleted), info.StreamStatus.ResponseOutcome())
			if tc.drop {
				require.NotContains(t, got, tc.id)
				require.NotContains(t, got, "event: keepalive")
				require.Contains(t, got, strings.Replace(toolEvent, `"output_index":1`, `"output_index":0`, 1))
				require.Contains(t, got, `"output":[`+tool+`]`)
				return
			}
			require.Contains(t, got, done)
			require.Contains(t, got, toolEvent)
			require.Contains(t, got, tail)
			require.NotContains(t, got, "event: keepalive")
			if tc.interleave {
				require.Less(t, strings.Index(got, toolEvent), strings.Index(got, done))
			}
		})
	}
}

func TestResponsesBlankMessageFilterKeepsIndexesAlignedWhenLaterCandidateHasText(t *testing.T) {
	filter := responsesBlankMessageFilter{removed: map[int]string{0: "msg_ack_ack_1"}}
	var sent []string
	frames := []string{
		`{"type":"response.output_item.added","output_index":1,"item":{"type":"message","role":"assistant","id":"msg_2","content":[]}}`,
		`{"type":"response.output_text.delta","output_index":1,"item_id":"msg_2","content_index":0,"delta":" "}`,
		`{"type":"response.output_text.delta","output_index":1,"item_id":"msg_2","content_index":0,"delta":"hello"}`,
	}
	for _, data := range frames {
		var event dto.ResponsesStreamResponse
		require.NoError(t, common.UnmarshalJsonStr(data, &event))
		require.NoError(t, filter.forward(event, responsesSSEFrame{event: event.Type, data: data}, func(frame responsesSSEFrame) error {
			sent = append(sent, frame.data)
			return nil
		}))
	}
	for i, frame := range frames {
		frames[i] = strings.Replace(frame, `"output_index":1`, `"output_index":0`, 1)
	}
	require.Equal(t, frames, sent)
}

func (b *responsesLifecycleBody) Read(p []byte) (int, error) {
	if b.data.Len() > 0 {
		return b.data.Read(p)
	}
	b.readOnce.Do(func() { close(b.waiting) })
	if b.readErr != nil {
		return 0, b.readErr
	}
	<-b.closed
	return 0, b.closeErr
}

func (b *responsesLifecycleBody) Close() error {
	b.closeOnce.Do(func() { close(b.closed) })
	return nil
}

type responsesLifecycleWriter struct {
	*httptest.ResponseRecorder
	body              *responsesLifecycleBody
	cancel            context.CancelFunc
	cancelBeforeFlush bool
	waitForCleanup    bool
	failWrite         int
	writeErr          error
	flushErr          error
	writes            int
	needle            string
}

func (w *responsesLifecycleWriter) Write(p []byte) (int, error) {
	w.writes++
	if w.writes == w.failWrite {
		return 0, w.writeErr
	}
	n, err := w.ResponseRecorder.Write(p)
	if w.cancelBeforeFlush && strings.Contains(w.Body.String(), w.needle) {
		<-w.body.waiting
		w.cancel()
		<-w.body.closed
	}
	return n, err
}

func (w *responsesLifecycleWriter) Flush() {
	w.ResponseRecorder.Flush()
	if !strings.Contains(w.Body.String(), w.needle) || w.body == nil {
		return
	}
	<-w.body.waiting
	if w.cancel != nil {
		w.cancel()
	}
	if w.waitForCleanup {
		<-w.body.closed
	}
}

func (w *responsesLifecycleWriter) FlushError() error {
	return w.flushErr
}

func TestOaiResponsesStreamHandlerCompletionLifecycle(t *testing.T) {
	oldMode, oldTimeout := gin.Mode(), constant.StreamingTimeout
	gin.SetMode(gin.TestMode)
	constant.StreamingTimeout = 1
	t.Cleanup(func() {
		gin.SetMode(oldMode)
		constant.StreamingTimeout = oldTimeout
	})

	for _, tc := range []struct {
		name              string
		event             string
		responseStatus    string
		cancel            bool
		cancelBeforeFlush bool
		closeEOF          bool
		eof               bool
		scannerError      bool
		priorError        bool
		failWrite         int
		failFlush         bool
		wantEnd           relaycommon.StreamEndReason
		wantError         bool
	}{
		{name: "completed without upstream EOF", event: "response.completed", responseStatus: "completed", wantEnd: relaycommon.StreamEndReasonDone},
		{name: "done alias without upstream EOF", event: "response.done", responseStatus: "completed", wantEnd: relaycommon.StreamEndReasonDone},
		{name: "disconnect during terminal flush", event: "response.completed", responseStatus: "completed", cancel: true, wantEnd: relaycommon.StreamEndReasonDone},
		{name: "completion then cancellation and cleanup EOF", event: "response.completed", responseStatus: "completed", cancel: true, closeEOF: true, wantEnd: relaycommon.StreamEndReasonDone},
		{name: "midstream disconnect", event: "response.output_text.delta", cancel: true, wantEnd: relaycommon.StreamEndReasonClientGone, wantError: true},
		{name: "midstream disconnect followed by cleanup EOF", event: "response.output_text.delta", cancel: true, closeEOF: true, wantEnd: relaycommon.StreamEndReasonClientGone, wantError: true},
		{name: "cancellation before flush", event: "response.completed", responseStatus: "completed", cancel: true, cancelBeforeFlush: true, wantEnd: relaycommon.StreamEndReasonClientGone, wantError: true},
		{name: "event write failure", event: "response.completed", responseStatus: "completed", failWrite: 1, wantEnd: relaycommon.StreamEndReasonHandlerStop, wantError: true},
		{name: "data write failure", event: "response.completed", responseStatus: "completed", failWrite: 2, wantEnd: relaycommon.StreamEndReasonHandlerStop, wantError: true},
		{name: "delimiter write failure", event: "response.completed", responseStatus: "completed", failWrite: 3, wantEnd: relaycommon.StreamEndReasonHandlerStop, wantError: true},
		{name: "flush failure", event: "response.completed", responseStatus: "completed", failFlush: true, wantEnd: relaycommon.StreamEndReasonHandlerStop, wantError: true},
		{name: "protocol error before completion", event: "response.completed", responseStatus: "completed", priorError: true, cancel: true, wantEnd: relaycommon.StreamEndReasonClientGone, wantError: true},
		{name: "upstream read failure before handler returns", event: "response.completed", responseStatus: "completed", scannerError: true, wantEnd: relaycommon.StreamEndReasonScannerErr, wantError: true},
		{name: "done with failed response", event: "response.done", responseStatus: "failed", eof: true, wantEnd: relaycommon.StreamEndReasonEOF, wantError: true},
		{name: "done with incomplete response", event: "response.done", responseStatus: "incomplete", eof: true, wantEnd: relaycommon.StreamEndReasonEOF},
	} {
		t.Run(tc.name, func(t *testing.T) {
			payload := fmt.Sprintf(`{"type":%q,"response":{"status":%q,"usage":{"input_tokens":7,"output_tokens":5,"total_tokens":12},"output":[{"id":"img_1","type":"image_generation_call","status":"completed","result":"image-data"}]}}`, tc.event, tc.responseStatus)
			if tc.responseStatus == "" {
				payload = `{"type":"response.output_text.delta","delta":"hello"}`
			}
			sse := "data: " + payload + "\n\n"
			if tc.priorError {
				sse = "data: invalid JSON\n\n" + sse
			}
			body := &responsesLifecycleBody{data: strings.NewReader(sse), waiting: make(chan struct{}), closed: make(chan struct{}), closeErr: io.ErrClosedPipe}
			if tc.closeEOF {
				body.closeErr = io.EOF
			}
			if tc.scannerError {
				body.readErr = io.ErrUnexpectedEOF
			}
			t.Cleanup(func() { require.NoError(t, body.Close()) })
			ctx, cancel := context.WithCancel(context.Background())
			t.Cleanup(cancel)
			writer := &responsesLifecycleWriter{
				ResponseRecorder: httptest.NewRecorder(), body: body, needle: payload + "\n\n",
				cancelBeforeFlush: tc.cancelBeforeFlush, waitForCleanup: tc.cancel || tc.scannerError,
				failWrite: tc.failWrite, writeErr: errors.New("downstream write failed"),
			}
			if tc.cancel {
				writer.cancel = cancel
			}
			if tc.failFlush {
				writer.flushErr = writer.writeErr
			}
			var upstream io.ReadCloser = body
			if tc.eof {
				upstream = io.NopCloser(strings.NewReader(sse))
				writer.body = nil
			}
			c, _ := gin.CreateTestContext(writer)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(ctx)
			info := &relaycommon.RelayInfo{
				OriginModelName: "gpt-4o", IsStream: true, DisablePing: true, StartTime: time.Now(),
				RelayFormat: types.RelayFormatOpenAIResponses,
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-4o"},
			}
			info.SetEstimatePromptTokens(7)
			resp := &http.Response{StatusCode: http.StatusOK, Body: upstream, Header: http.Header{"Content-Type": {"text/event-stream"}}}
			usage, apiErr := OaiResponsesStreamHandler(c, info, resp)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			require.NotNil(t, info.StreamStatus)
			assert.Equal(t, tc.wantEnd, info.StreamStatus.EndReason)
			assert.Equal(t, tc.responseStatus, info.StreamStatus.ResponseOutcome())
			log := service.GenerateTextOtherInfo(c, info, 1, 1, 1, 0, 1, 0, 1).Snapshot()["stream_status"].(map[string]any)
			assert.Equal(t, tc.wantError, log["status"] == "error")
			if tc.responseStatus != "" {
				assert.Equal(t, 7, usage.PromptTokens)
				assert.Equal(t, 5, usage.CompletionTokens)
				assert.Equal(t, 12, usage.TotalTokens)
				require.NotNil(t, info.ResponsesUsageInfo)
				require.Contains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolImageGeneration)
				assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
			}
			if tc.failWrite == 0 {
				assert.Contains(t, writer.Body.String(), payload+"\n\n")
			} else {
				assert.ErrorIs(t, info.StreamStatus.EndError, writer.writeErr)
			}
			if tc.failFlush {
				assert.ErrorIs(t, info.StreamStatus.EndError, writer.flushErr)
			}
			if !tc.eof {
				select {
				case <-body.closed:
				default:
					t.Fatal("upstream body was not closed")
				}
			}
		})
	}
}

func TestOaiResponsesHandlerCountsOutputCallsNotDeclarations(t *testing.T) {
	gin.SetMode(gin.TestMode)
	operation_setting.SetToolPriceForTest("priced_fn", 5.0)
	t.Cleanup(func() {
		operation_setting.DeleteToolPriceForTest("priced_fn")
	})

	body, err := common.Marshal(dto.OpenAIResponsesResponse{
		Tools: []map[string]any{
			{"type": "web_search_preview"},
			{"type": "file_search"},
		},
		Output: []dto.ResponsesOutput{
			{Type: dto.BuildInCallWebSearchCall},
			{Type: dto.BuildInCallWebSearchCall},
			{Type: dto.BuildInCallFunctionCall, Name: "priced_fn"},
			{Type: dto.BuildInCallFunctionCall, Name: "unpriced_fn"},
		},
		Usage: &dto.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2},
	})
	require.NoError(t, err)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)

	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.1",
		ChannelMeta:     &relaycommon.ChannelMeta{},
		ResponsesUsageInfo: &relaycommon.ResponsesUsageInfo{
			BuiltInTools: map[string]*relaycommon.BuildInToolInfo{
				dto.BuildInToolWebSearchPreview: {ToolName: dto.BuildInToolWebSearchPreview, CallCount: 0},
				dto.BuildInToolFileSearch:       {ToolName: dto.BuildInToolFileSearch, CallCount: 0},
			},
		},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}

	usage, apiErr := OaiResponsesHandler(c, info, resp)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, 2, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview].CallCount)
	assert.Equal(t, 0, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolFileSearch].CallCount)
	require.Contains(t, info.ResponsesUsageInfo.BuiltInTools, "priced_fn")
	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools["priced_fn"].CallCount)
	assert.NotContains(t, info.ResponsesUsageInfo.BuiltInTools, "unpriced_fn")
}

func TestOaiResponsesHandlerDeclaredToolsWithoutOutputCountZero(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, err := common.Marshal(dto.OpenAIResponsesResponse{
		Tools: []map[string]any{
			{"type": "web_search_preview"},
			{"type": "file_search"},
		},
		Output: []dto.ResponsesOutput{
			{Type: "message", Role: "assistant"},
		},
		Usage: &dto.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2},
	})
	require.NoError(t, err)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)

	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.1",
		ChannelMeta:     &relaycommon.ChannelMeta{},
		ResponsesUsageInfo: &relaycommon.ResponsesUsageInfo{
			BuiltInTools: map[string]*relaycommon.BuildInToolInfo{
				dto.BuildInToolWebSearchPreview: {ToolName: dto.BuildInToolWebSearchPreview, CallCount: 0},
				dto.BuildInToolFileSearch:       {ToolName: dto.BuildInToolFileSearch, CallCount: 0},
			},
		},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}

	_, apiErr := OaiResponsesHandler(c, info, resp)
	require.Nil(t, apiErr)
	assert.Equal(t, 0, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview].CallCount)
	assert.Equal(t, 0, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolFileSearch].CallCount)
}

func TestOaiResponsesHandlerCountsCompletedImageGenerationOutputs(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, err := common.Marshal(dto.OpenAIResponsesResponse{
		Status: []byte(`"completed"`),
		Output: []dto.ResponsesOutput{
			{
				Type:   dto.ResponsesOutputTypeImageGenerationCall,
				ID:     "img_1",
				Status: "completed",
				Result: "base64-a",
			},
			{
				Type:   dto.ResponsesOutputTypeImageGenerationCall,
				ID:     "img_2",
				Status: "completed",
				Result: "base64-b",
			},
			{
				Type:   dto.ResponsesOutputTypeImageGenerationCall,
				ID:     "img_empty",
				Status: "completed",
				Result: "",
			},
		},
		Usage: &dto.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2},
	})
	require.NoError(t, err)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.1",
		ChannelMeta:     &relaycommon.ChannelMeta{},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}

	_, apiErr := OaiResponsesHandler(c, info, resp)
	require.Nil(t, apiErr)
	require.Contains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolImageGeneration)
	assert.Equal(t, 2, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
	assert.False(t, c.GetBool("image_generation_call"))
}

func TestOaiResponsesHandlerCountsImageGenerationOnIncompleteStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, err := common.Marshal(dto.OpenAIResponsesResponse{
		Status: []byte(`"incomplete"`),
		Output: []dto.ResponsesOutput{
			{
				Type:   dto.ResponsesOutputTypeImageGenerationCall,
				ID:     "img_1",
				Status: "completed",
				Result: "base64-a",
			},
		},
		Usage: &dto.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2},
	})
	require.NoError(t, err)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.1",
		ChannelMeta:     &relaycommon.ChannelMeta{},
		ResponsesUsageInfo: &relaycommon.ResponsesUsageInfo{
			BuiltInTools: map[string]*relaycommon.BuildInToolInfo{
				dto.BuildInToolImageGeneration: {ToolName: dto.BuildInToolImageGeneration, CallCount: 0},
			},
		},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}

	_, apiErr := OaiResponsesHandler(c, info, resp)
	require.Nil(t, apiErr)
	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
}

func runResponsesImageBillingStream(t *testing.T, events ...string) *relaycommon.RelayInfo {
	t.Helper()
	gin.SetMode(gin.TestMode)
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() {
		constant.StreamingTimeout = oldTimeout
	})

	var body strings.Builder
	for _, event := range events {
		body.WriteString("data: ")
		body.WriteString(event)
		body.WriteString("\n\n")
	}
	body.WriteString("data: [DONE]\n\n")

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Set(common.RequestIdKey, "responses-image-billing-test")
	info := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.1",
		DisablePing:     true,
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gpt-5.1",
		},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(body.String())),
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
	}

	_, apiErr := OaiResponsesStreamHandler(c, info, resp)
	require.Nil(t, apiErr)
	require.NotNil(t, info.ResponsesUsageInfo)
	require.Contains(t, info.ResponsesUsageInfo.BuiltInTools, dto.BuildInToolImageGeneration)
	return info
}

func TestOaiResponsesStreamHandlerDeduplicatesCompletedImageOutput(t *testing.T) {
	item := `{"type":"image_generation_call","id":"img_1","call_id":"call_1","status":"completed","result":"base64-a"}`
	info := runResponsesImageBillingStream(
		t,
		`{"type":"response.output_item.done","output_index":0,"item":`+item+`}`,
		`{"type":"response.completed","response":{"status":"completed","output":[`+item+`],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}`,
	)

	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
}

func TestOaiResponsesStreamHandlerCountsImageOutputOnIncomplete(t *testing.T) {
	info := runResponsesImageBillingStream(
		t,
		`{"type":"response.output_item.done","output_index":0,"item":{"type":"image_generation_call","id":"img_1","status":"completed","result":"base64-a"}}`,
		`{"type":"response.incomplete","response":{"status":"incomplete"}}`,
	)

	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
}

func TestOaiResponsesStreamHandlerDoesNotCountPartialImageEvent(t *testing.T) {
	info := runResponsesImageBillingStream(
		t,
		`{"type":"response.image_generation_call.partial_image","output_index":0,"partial_image_b64":"partial-bytes"}`,
		`{"type":"response.completed","response":{"status":"completed","output":[]}}`,
	)

	assert.Equal(t, 0, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolImageGeneration].CallCount)
}

// The 12h cache-write split reaches billing from JSON, stream and compaction
// responses. The usage is the OpenAI prompt caching guide example.
func TestOaiResponsesHandlersKeepCacheWriteTTLSplit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() {
		constant.StreamingTimeout = oldTimeout
	})

	const usage = `"usage":{"input_tokens":12000,"output_tokens":0,"total_tokens":12000,"input_tokens_details":{"cached_tokens":4000,"cache_write_tokens":7000,"cache_creation_input_tokens":6500,"cache_write_tokens_details":{"ttl_30m_tokens":3000,"ttl_12h_tokens":4000}}}`
	const response = `{"id":"resp_1","object":"response","model":"gpt-6-astra","status":"completed","output":[],` + usage + `}`
	for _, tt := range []struct {
		name, contentType, body string
	}{
		{"json", "application/json", response},
		{"stream", "text/event-stream", `data: {"type":"response.completed","response":` + response + "}\n\ndata: [DONE]\n\n"},
		{"compaction", "application/json", `{"id":"cmp_1","object":"response.compaction","output":[],` + usage + `}`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			info := &relaycommon.RelayInfo{
				RelayFormat:     types.RelayFormatOpenAIResponses,
				OriginModelName: "gpt-6-astra",
				IsStream:        tt.name == "stream",
				DisablePing:     true,
				ChannelMeta:     &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeOpenAI, UpstreamModelName: "gpt-6-astra"},
			}
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(tt.body)),
				Header:     http.Header{"Content-Type": []string{tt.contentType}},
			}
			var usage *dto.Usage
			var apiErr *types.NewAPIError
			switch tt.name {
			case "json":
				usage, apiErr = OaiResponsesHandler(c, info, resp)
			case "stream":
				usage, apiErr = OaiResponsesStreamHandler(c, info, resp)
			default:
				usage, apiErr = OaiResponsesCompactionHandler(c, info, resp)
			}
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, 12000, usage.PromptTokens)
			assert.Equal(t, 4000, usage.PromptTokensDetails.CachedTokens)
			assert.Equal(t, 6500, usage.PromptTokensDetails.CacheCreationInputTokens)
			assert.Equal(t, 7000, usage.PromptTokensDetails.CacheCreationTokensTotal())
			assert.Equal(t, 4000, usage.PromptTokensDetails.CacheWrite12hTokens())
		})
	}
}

func TestOaiResponsesHandlerRewritesSGLangCreatedAtToInt(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)

	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeSGLang},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(`{"id":"resp_1","object":"response","created_at":1786588600.0,"status":"completed","output":[]}`)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}

	_, apiErr := OaiResponsesHandler(c, info, resp)
	require.Nil(t, apiErr)
	assert.Contains(t, w.Body.String(), `"created_at":1786588600`)
	assert.NotContains(t, w.Body.String(), `1786588600.0`)
}

func TestOaiResponsesStreamHandlerRewritesSGLangCreatedAtToInt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() {
		constant.StreamingTimeout = oldTimeout
	})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Set(common.RequestIdKey, "sglang-created-at-test")

	info := &relaycommon.RelayInfo{
		DisablePing: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeSGLang,
			UpstreamModelName: "served-model",
		},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body: io.NopCloser(strings.NewReader(
			"data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\",\"created_at\":1.7865886E9,\"status\":\"completed\",\"output\":[]}}\n\n" +
				"data: [DONE]\n\n",
		)),
		Header: http.Header{"Content-Type": []string{"text/event-stream"}},
	}

	_, apiErr := OaiResponsesStreamHandler(c, info, resp)
	require.Nil(t, apiErr)
	assert.Contains(t, w.Body.String(), `"created_at":1786588600`)
	assert.NotContains(t, w.Body.String(), `1.7865886E9`)
	assert.NotContains(t, w.Body.String(), `1786588600.0`)
}

func TestOaiResponsesStreamHandlerKeepsNonSGLangCreatedAt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() {
		constant.StreamingTimeout = oldTimeout
	})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Set(common.RequestIdKey, "openai-created-at-test")

	info := &relaycommon.RelayInfo{
		DisablePing: true,
		ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeOpenAI, UpstreamModelName: "gpt-test"},
	}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body: io.NopCloser(strings.NewReader(
			"data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\",\"created_at\":1786588600.0,\"status\":\"completed\",\"output\":[]}}\n\n" +
				"data: [DONE]\n\n",
		)),
		Header: http.Header{"Content-Type": []string{"text/event-stream"}},
	}

	_, apiErr := OaiResponsesStreamHandler(c, info, resp)
	require.Nil(t, apiErr)
	assert.Contains(t, w.Body.String(), `1786588600.0`)
}

// A converted hosted web search reaches Azure and Xinference Chat Completions
// as web_search_options, like OpenAI; the upstream decides whether it applies.
// Azure Responses bills web search by tool_usage.web_search.num_requests (Bing
// transactions) under bing_web_search, and the explicit zeros silence the
// web_search_call items, which leaves one surcharge row.
func TestAzureHostedWebSearch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() {
		constant.StreamingTimeout = oldTimeout
	})

	t.Run("Claude to Chat", func(t *testing.T) {
		const body = `{"model":"gpt-5.1","max_tokens":64,"messages":[{"role":"user","content":"Weather?"}],"tools":[{"type":"web_search_20250305","name":"web_search"}]}`
		for _, channelType := range []int{constant.ChannelTypeAzure, constant.ChannelTypeXinference, constant.ChannelTypeOpenAI} {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{
				RelayFormat: types.RelayFormatClaude,
				ChannelMeta: &relaycommon.ChannelMeta{ChannelType: channelType, UpstreamModelName: "gpt-5.1"},
			}
			adaptor := &Adaptor{}
			adaptor.Init(info)
			var request dto.ClaudeRequest
			require.NoError(t, common.UnmarshalJsonStr(body, &request))
			converted, err := adaptor.ConvertClaudeRequest(c, info, &request)
			require.NoError(t, err)
			wire, err := common.Marshal(converted)
			require.NoError(t, err)
			assert.True(t, strings.Contains(string(wire), `"web_search_options"`), channelType)
			var codes []string
			for _, diagnostic := range info.ConversionDiagnostics() {
				codes = append(codes, diagnostic.Code)
			}
			assert.False(t, slices.Contains(codes, "hosted_web_search_omitted"), channelType)
		}
	})

	const searchCall = `{"type":"web_search_call","status":"completed","action":{"type":"search","query":"go"}}`
	const usage = `"usage":{"input_tokens":10,"output_tokens":3,"total_tokens":13},"tool_usage":{"web_search":{"num_requests":5}}`
	output := strings.Repeat(searchCall+",", 3) + `{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Go 1.25"}]}`
	tests := []struct {
		name        string
		contentType string
		body        string
	}{
		{
			name:        "json",
			contentType: "application/json",
			body:        `{"id":"resp_1","object":"response","model":"gpt-5.1","status":"completed","output":[` + output + `],` + usage + `}`,
		},
		{
			name:        "stream",
			contentType: "text/event-stream",
			body: strings.Repeat(`data: {"type":"response.output_item.done","output_index":0,"item":`+searchCall+"}\n\n", 3) +
				`data: {"type":"response.completed","response":{"id":"resp_1","object":"response","model":"gpt-5.1","status":"completed","output":[` + output + `],` + usage + "}}\n\ndata: [DONE]\n\n",
		},
	}
	for _, tt := range tests {
		t.Run("Responses "+tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			info := &relaycommon.RelayInfo{
				RelayMode:       relayconstant.RelayModeResponses,
				RelayFormat:     types.RelayFormatOpenAIResponses,
				OriginModelName: "gpt-5.1",
				IsStream:        tt.name == "stream",
				DisablePing:     true,
				ChannelMeta:     &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAzure, UpstreamModelName: "gpt-5.1"},
			}
			adaptor := &Adaptor{}
			adaptor.Init(info)
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(tt.body)),
				Header:     http.Header{"Content-Type": []string{tt.contentType}},
			}
			var apiErr *types.NewAPIError
			if info.IsStream {
				_, apiErr = OaiResponsesStreamHandler(c, info, resp)
			} else {
				_, apiErr = OaiResponsesHandler(c, info, resp)
			}
			require.Nil(t, apiErr)
			billed := map[string]int{}
			for name, tool := range info.ResponsesUsageInfo.BuiltInTools {
				if tool.CallCount > 0 {
					billed[name] = tool.CallCount
				}
			}
			assert.Equal(t, map[string]int{"bing_web_search": 5}, billed)
		})
	}
}
