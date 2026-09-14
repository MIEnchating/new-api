package openai

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

func OaiResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	// read response body
	var responsesResponse dto.OpenAIResponsesResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	info.ObserveActualResponseModel(responseBody)
	err = common.Unmarshal(responseBody, &responsesResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := responsesResponse.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	responseBody = rewriteSGLangResponsesCreatedAt(info, responseBody, "created_at", responsesResponse.CreatedAt)

	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	// compute usage
	usage := &dto.Usage{}
	service.ApplyResponsesUsage(usage, responsesResponse.Usage)
	// Count actual tool invocations from Output (not tool declarations).
	for _, output := range responsesResponse.Output {
		switch output.Type {
		case dto.BuildInCallWebSearchCall:
			info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
		case dto.BuildInCallFileSearchCall:
			info.CountBillableToolCall(dto.BuildInCallFileSearchCall, "")
		case dto.BuildInCallFunctionCall:
			info.CountBillableToolCall(dto.BuildInCallFunctionCall, output.Name)
		}
	}

	imageCounter := &relaycommon.ImageGenerationCallCounter{}
	if !relaycommon.IsNonBillableResponsesStatus(responsesResponse.Status) {
		for i := range responsesResponse.Output {
			idx := i
			imageCounter.Observe(&responsesResponse.Output[i], &idx)
		}
	}
	imageCounter.Commit(info)

	return usage, nil
}

func OaiResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, "invalid response or response body")
		return nil, types.NewError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse)
	}

	defer service.CloseResponseBodyGracefully(resp)

	accumulator := service.NewResponsesUsageAccumulator(info)
	var streamError *types.NewAPIError
	type pendingStreamEvent struct {
		response dto.ResponsesStreamResponse
		data     string
	}
	pendingPreamble := make([]pendingStreamEvent, 0, 2)
	flushPreamble := func() error {
		for _, event := range pendingPreamble {
			if err := sendResponsesStreamData(c, event.response, event.data); err != nil {
				return err
			}
		}
		pendingPreamble = pendingPreamble[:0]
		return nil
	}

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		info.ObserveActualResponseModel(common.StringToByteSlice(data))
		var streamResponse dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
			logger.LogError(c, "failed to unmarshal stream response: "+err.Error())
			sr.Error(err)
			return
		}
		accumulator.Observe(&streamResponse)
		if streamErr := newResponsesStreamError(streamResponse); streamErr != nil {
			streamError = streamErr
			sr.Stop(streamErr)
			return
		}
		if streamResponse.Response != nil {
			data = string(rewriteSGLangResponsesCreatedAt(info, []byte(data), "response.created_at", streamResponse.Response.CreatedAt))
		}
		if streamResponse.Type == "response.created" || streamResponse.Type == "response.in_progress" {
			pendingPreamble = append(pendingPreamble, pendingStreamEvent{response: streamResponse, data: data})
			return
		}
		if err := flushPreamble(); err != nil {
			streamError = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusBadGateway)
			sr.Stop(streamError)
			return
		}
		if err := sendResponsesStreamData(c, streamResponse, data); err != nil {
			streamError = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusBadGateway)
			sr.Stop(streamError)
		}
	})
	usage := accumulator.Finish()
	if streamError != nil {
		return usage, streamError
	}
	if len(pendingPreamble) > 0 {
		return usage, types.NewOpenAIError(
			errors.New("upstream response stream ended before a terminal event"),
			types.ErrorCodeBadResponse,
			http.StatusBadGateway,
			types.ErrOptionWithStreamEvent(),
		)
	}
	return usage, nil
}

func rewriteSGLangResponsesCreatedAt(info *relaycommon.RelayInfo, payload []byte, path string, createdAt dto.IntValue) []byte {
	if info.GetChannelType() != constant.ChannelTypeSGLang {
		return payload
	}
	if !gjson.GetBytes(payload, path).Exists() {
		return payload
	}
	patched, err := sjson.SetBytes(payload, path, int(createdAt))
	if err != nil {
		return payload
	}
	return patched
}

func newResponsesStreamError(response dto.ResponsesStreamResponse) *types.NewAPIError {
	if response.Type != "response.failed" && response.Type != "response.error" && response.Type != "error" {
		return nil
	}

	var openAIError *types.OpenAIError
	if response.Response != nil {
		openAIError = response.Response.GetOpenAIError()
	}
	if openAIError == nil {
		openAIError = dto.GetOpenAIError(response.Error)
	}
	if openAIError == nil || strings.TrimSpace(openAIError.Message) == "" {
		return types.NewOpenAIError(
			errors.New("upstream response stream failed"),
			types.ErrorCodeBadResponse,
			http.StatusBadGateway,
			types.ErrOptionWithStreamEvent(),
		)
	}
	options := []types.NewAPIErrorOptions{types.ErrOptionWithStreamEvent()}
	if isDeterministicResponsesStreamError(*openAIError) {
		options = append(options, types.ErrOptionWithSkipRetry())
	}
	return types.WithOpenAIError(
		*openAIError,
		responsesStreamErrorStatus(openAIError.Code),
		options...,
	)
}

func isDeterministicResponsesStreamError(openAIError types.OpenAIError) bool {
	combined := strings.ToLower(strings.TrimSpace(strings.Join([]string{
		openAIError.Message,
		openAIError.Type,
		fmt.Sprint(openAIError.Code),
	}, " ")))
	for _, marker := range []string{
		"invalid_request",
		"context_length_exceeded",
		"exceeds the context window",
		"exceed the context window",
		"maximum context length",
		"context window exceeded",
		"content_policy",
		"high-risk cyber",
		"not allowed",
		"safety",
		"violat",
	} {
		if strings.Contains(combined, marker) {
			return true
		}
	}
	return false
}

func responsesStreamErrorStatus(code any) int {
	var status int
	switch value := code.(type) {
	case int:
		status = value
	case int32:
		status = int(value)
	case int64:
		status = int(value)
	case float64:
		status = int(value)
	case string:
		status, _ = strconv.Atoi(strings.TrimSpace(value))
	}
	if status >= 400 && status <= 599 {
		return status
	}
	return http.StatusBadGateway
}
