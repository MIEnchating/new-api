package openai

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
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

	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	// compute usage
	usage := dto.Usage{}
	if responsesResponse.Usage != nil {
		usage.PromptTokens = responsesResponse.Usage.InputTokens
		usage.CompletionTokens = responsesResponse.Usage.OutputTokens
		usage.TotalTokens = responsesResponse.Usage.TotalTokens
		if responsesResponse.Usage.InputTokensDetails != nil {
			usage.PromptTokensDetails.CachedTokens = responsesResponse.Usage.InputTokensDetails.CachedTokens
			usage.PromptTokensDetails.CacheWriteTokens = responsesResponse.Usage.InputTokensDetails.CacheWriteTokens
		}
	}
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

	return &usage, nil
}

func OaiResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, "invalid response or response body")
		return nil, types.NewError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse)
	}

	defer service.CloseResponseBodyGracefully(resp)

	var usage = &dto.Usage{}
	var responseTextBuilder strings.Builder
	var streamError *types.NewAPIError
	imageCounter := &relaycommon.ImageGenerationCallCounter{}
	imageCommitted := false
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

		// 检查当前数据是否包含 completed 状态和 usage 信息
		var streamResponse dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
			logger.LogError(c, "failed to unmarshal stream response: "+err.Error())
			sr.Error(err)
			return
		}
		if streamErr := newResponsesStreamError(streamResponse); streamErr != nil {
			streamError = streamErr
			sr.Stop(streamErr)
			return
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
			return
		}
		switch streamResponse.Type {
		case "response.completed", "response.done":
			if streamResponse.Response != nil {
				if streamResponse.Response.Usage != nil {
					if streamResponse.Response.Usage.InputTokens != 0 {
						usage.PromptTokens = streamResponse.Response.Usage.InputTokens
					}
					if streamResponse.Response.Usage.OutputTokens != 0 {
						usage.CompletionTokens = streamResponse.Response.Usage.OutputTokens
					}
					if streamResponse.Response.Usage.TotalTokens != 0 {
						usage.TotalTokens = streamResponse.Response.Usage.TotalTokens
					}
					if streamResponse.Response.Usage.InputTokensDetails != nil {
						usage.PromptTokensDetails.CachedTokens = streamResponse.Response.Usage.InputTokensDetails.CachedTokens
						usage.PromptTokensDetails.CacheWriteTokens = streamResponse.Response.Usage.InputTokensDetails.CacheWriteTokens
					}
				}
				if !imageCommitted {
					if relaycommon.IsNonBillableResponsesStatus(streamResponse.Response.Status) {
						imageCounter.Reset()
						imageCounter.Commit(info)
						imageCommitted = true
					} else {
						for i := range streamResponse.Response.Output {
							idx := i
							imageCounter.Observe(&streamResponse.Response.Output[i], &idx)
						}
						imageCounter.Commit(info)
						imageCommitted = true
					}
				}
			} else if !imageCommitted {
				imageCounter.Commit(info)
				imageCommitted = true
			}
		case "response.failed", "response.incomplete", "response.cancelled", "response.canceled":
			if !imageCommitted {
				imageCounter.Reset()
				imageCounter.Commit(info)
				imageCommitted = true
			}
		case "response.output_text.delta":
			// 处理输出文本
			responseTextBuilder.WriteString(streamResponse.Delta)
		case dto.ResponsesOutputTypeItemDone:
			if streamResponse.Item != nil {
				switch streamResponse.Item.Type {
				case dto.BuildInCallWebSearchCall:
					info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
				case dto.BuildInCallFileSearchCall:
					info.CountBillableToolCall(dto.BuildInCallFileSearchCall, "")
				case dto.BuildInCallFunctionCall:
					info.CountBillableToolCall(dto.BuildInCallFunctionCall, streamResponse.Item.Name)
				case dto.ResponsesOutputTypeImageGenerationCall:
					if !imageCommitted {
						imageCounter.Observe(streamResponse.Item, streamResponse.OutputIndex)
					}
				}
			}
		}
	})
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

	if usage.CompletionTokens == 0 {
		// 计算输出文本的 token 数量
		tempStr := responseTextBuilder.String()
		if len(tempStr) > 0 {
			// 非正常结束，使用输出文本的 token 数量
			completionTokens := service.CountTextToken(tempStr, info.UpstreamModelName)
			usage.CompletionTokens = completionTokens
		}
	}

	if usage.PromptTokens == 0 && usage.CompletionTokens != 0 {
		usage.PromptTokens = info.GetEstimatePromptTokens()
	}

	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens

	return usage, nil
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
