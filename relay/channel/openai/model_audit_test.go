package openai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOaiResponsesHandlerAuditsModelWithoutChangingResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := `{"id":"resp_1","model":"gpt-5.6-terra","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}`
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-5.6-sol"}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}

	_, apiErr := OaiResponsesHandler(c, info, resp)

	require.Nil(t, apiErr)
	assert.Equal(t, "gpt-5.6-terra", info.ActualResponseModel())
	assert.Equal(t, body, recorder.Body.String())
}

func TestOaiResponsesStreamHandlerAuditsCompletedEventModel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })

	body := strings.Join([]string{
		`data: {"type":"response.output_item.done","item":{"type":"message","model":"gpt-5.6-terra"}}`,
		``,
		`data: {"type":"response.completed","response":{"model":"gpt-5.6-terra","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}`,
		``,
		`data: [DONE]`,
		``,
	}, "\n")
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-5.6-sol", IsStream: true}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
	}

	_, apiErr := OaiResponsesStreamHandler(c, info, resp)

	require.Nil(t, apiErr)
	assert.Equal(t, "gpt-5.6-terra", info.ActualResponseModel())
	assert.Contains(t, recorder.Body.String(), `"model":"gpt-5.6-terra"`)
}

func TestOaiResponsesHandlerLeavesAuditEmptyWhenModelIsMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := `{"id":"resp_2","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}`
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-5.6-sol"}
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
	}

	_, apiErr := OaiResponsesHandler(c, info, resp)

	require.Nil(t, apiErr)
	assert.Empty(t, info.ActualResponseModel())
	assert.Equal(t, body, recorder.Body.String())
}
