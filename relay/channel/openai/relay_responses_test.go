package openai

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestOaiResponsesStreamHandler_CompletedEndsWithoutDoneOrEOF(t *testing.T) {
	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() {
		constant.StreamingTimeout = oldStreamingTimeout
	})

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
