package openai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func withCustomErrorResponseSetting(t *testing.T, setting operation_setting.ErrorResponseSetting) {
	t.Helper()
	current := operation_setting.GetErrorResponseSetting()
	original := *current
	original.Rules = append([]operation_setting.CustomErrorResponseRule(nil), current.Rules...)
	*current = setting
	operation_setting.RefreshErrorResponseSnapshot()
	originalStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 1
	t.Cleanup(func() {
		*current = original
		operation_setting.RefreshErrorResponseSnapshot()
		constant.StreamingTimeout = originalStreamingTimeout
	})
}

func TestOaiResponsesStreamHandlerReturnsMatchingFailedEventWithoutApplyingCustomResponse(t *testing.T) {
	withCustomErrorResponseSetting(t, operation_setting.ErrorResponseSetting{
		Enabled: true,
		Rules: []operation_setting.CustomErrorResponseRule{
			{
				Name:               "context limit",
				Enabled:            true,
				MessageContains:    "context limit",
				MessageMatchMode:   operation_setting.CustomErrorMessageMatchContains,
				ResponseStatusCode: http.StatusTooManyRequests,
				ResponseMessage:    "上下文长度超限",
			},
		},
	})

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body: io.NopCloser(strings.NewReader(
			"data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"context limit exceeded\",\"type\":\"invalid_request_error\",\"code\":\"400\"}}}\n\n",
		)),
	}

	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-test"}}
	_, apiErr := OaiResponsesStreamHandler(c, info, resp)

	require.NotNil(t, apiErr)
	require.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
	require.Equal(t, "context limit exceeded", apiErr.Error())
	require.True(t, types.IsStreamEventError(apiErr))
	require.True(t, types.IsSkipRetryError(apiErr))
	require.Empty(t, recorder.Body.String())
}

func TestOaiResponsesStreamHandlerReturnsUnmatchedFailedEvent(t *testing.T) {
	withCustomErrorResponseSetting(t, operation_setting.ErrorResponseSetting{
		Enabled: true,
		Rules: []operation_setting.CustomErrorResponseRule{
			{
				Enabled:            true,
				MessageContains:    "different error",
				ResponseStatusCode: http.StatusBadRequest,
				ResponseMessage:    "不会命中",
			},
		},
	})

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body: io.NopCloser(strings.NewReader(
			"data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"context limit exceeded\",\"type\":\"invalid_request_error\"}}}\n\n",
		)),
	}

	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-test"}}
	_, apiErr := OaiResponsesStreamHandler(c, info, resp)

	require.NotNil(t, apiErr)
	require.Equal(t, http.StatusBadGateway, apiErr.StatusCode)
	require.Equal(t, "context limit exceeded", apiErr.Error())
	require.True(t, types.IsStreamEventError(apiErr))
	require.True(t, types.IsSkipRetryError(apiErr))
	require.Empty(t, recorder.Body.String())
}

func TestOaiResponsesStreamHandlerReturnsCompatibleErrorEvents(t *testing.T) {
	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldStreamingTimeout })
	for _, eventType := range []string{"response.error", "error"} {
		t.Run(eventType, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
				Body: io.NopCloser(strings.NewReader(
					"data: {\"type\":\"" + eventType + "\",\"error\":{\"message\":\"stream read failed\",\"type\":\"upstream_error\"}}\n\n",
				)),
			}

			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-test"}}
			_, apiErr := OaiResponsesStreamHandler(c, info, resp)

			require.NotNil(t, apiErr)
			require.Equal(t, http.StatusBadGateway, apiErr.StatusCode)
			require.Equal(t, "stream read failed", apiErr.Error())
			require.True(t, types.IsStreamEventError(apiErr))
			require.Empty(t, recorder.Body.String())
		})
	}
}

func TestOaiResponsesStreamHandlerMarksTransientFailedEventForFailover(t *testing.T) {
	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldStreamingTimeout })
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body: io.NopCloser(strings.NewReader(
			"data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_retry\"}}\n\n" +
				"data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"server overloaded\",\"type\":\"server_error\",\"code\":\"server_is_overloaded\"}}}\n\n",
		)),
	}

	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-test"}}
	_, apiErr := OaiResponsesStreamHandler(c, info, resp)

	require.NotNil(t, apiErr)
	require.Equal(t, http.StatusBadGateway, apiErr.StatusCode)
	require.True(t, types.IsStreamEventError(apiErr))
	require.False(t, types.IsSkipRetryError(apiErr))
	require.Empty(t, recorder.Body.String())
}

func TestOaiResponsesStreamHandlerRejectsPreambleOnlyStream(t *testing.T) {
	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldStreamingTimeout })
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		Body: io.NopCloser(strings.NewReader(
			"data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_incomplete\"}}\n\n" +
				"data: [DONE]\n\n",
		)),
	}

	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-test"}}
	_, apiErr := OaiResponsesStreamHandler(c, info, resp)

	require.NotNil(t, apiErr)
	require.Equal(t, http.StatusBadGateway, apiErr.StatusCode)
	require.True(t, types.IsStreamEventError(apiErr))
	require.Empty(t, recorder.Body.String())
}
