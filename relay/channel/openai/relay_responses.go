package openai

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

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
	err = common.Unmarshal(responseBody, &responsesResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := responsesResponse.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	if responsesResponse.HasImageGenerationCall() {
		c.Set("image_generation_call", true)
		c.Set("image_generation_call_quality", responsesResponse.GetQuality())
		c.Set("image_generation_call_size", responsesResponse.GetSize())
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
		}
	}
	if info == nil || info.ResponsesUsageInfo == nil || info.ResponsesUsageInfo.BuiltInTools == nil {
		return &usage, nil
	}
	// 解析 Tools 用量
	for _, tool := range responsesResponse.Tools {
		buildToolinfo, ok := info.ResponsesUsageInfo.BuiltInTools[common.Interface2String(tool["type"])]
		if !ok || buildToolinfo == nil {
			logger.LogError(c, fmt.Sprintf("BuiltInTools not found for tool type: %v", tool["type"]))
			continue
		}
		buildToolinfo.CallCount++
	}
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
	firstDownstreamFlush := true
	applyTerminalUsage := func(response *dto.OpenAIResponsesResponse) {
		if response == nil || response.Usage == nil {
			return
		}
		if response.Usage.InputTokens != 0 {
			usage.PromptTokens = response.Usage.InputTokens
		}
		if response.Usage.OutputTokens != 0 {
			usage.CompletionTokens = response.Usage.OutputTokens
		}
		if response.Usage.TotalTokens != 0 {
			usage.TotalTokens = response.Usage.TotalTokens
		}
		if response.Usage.InputTokensDetails != nil {
			usage.PromptTokensDetails.CachedTokens = response.Usage.InputTokensDetails.CachedTokens
		}
		logger.LogInfo(c, fmt.Sprintf(
			"stream trace: stage=usage elapsed_ms=%d input_tokens=%d output_tokens=%d total_tokens=%d cached_tokens=%d",
			info.ElapsedMilliseconds(), usage.PromptTokens, usage.CompletionTokens, usage.TotalTokens, usage.PromptTokensDetails.CachedTokens,
		))
	}

	helper.StreamScannerHandlerWithRequiredTerminal(c, resp, info, "valid Responses terminal event", func(data string, sr *helper.StreamResult) {

		// 检查当前数据是否包含 completed 状态和 usage 信息
		var streamResponse dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
			logger.LogError(c, "failed to unmarshal stream response: "+err.Error())
			sr.Error(err)
			return
		}
		if err := sendResponsesStreamData(c, streamResponse, data); err != nil {
			logger.LogError(c, fmt.Sprintf(
				"stream trace: stage=downstream_flush_error elapsed_ms=%d error=%q",
				info.ElapsedMilliseconds(), err.Error(),
			))
			if c.Request == nil || c.Request.Context().Err() == nil {
				sr.Stop(err)
			}
			return
		}
		info.SendResponseCount++
		if firstDownstreamFlush {
			firstDownstreamFlush = false
			logger.LogInfo(c, fmt.Sprintf(
				"stream trace: stage=first_downstream_flush elapsed_ms=%d event=%q",
				info.ElapsedMilliseconds(), streamResponse.Type,
			))
		}
		switch streamResponse.Type {
		case "response.completed", "response.incomplete":
			logger.LogInfo(c, fmt.Sprintf(
				"stream trace: stage=terminal_event elapsed_ms=%d event=%q",
				info.ElapsedMilliseconds(), streamResponse.Type,
			))
			applyTerminalUsage(streamResponse.Response)
			if streamResponse.Response != nil {
				if streamResponse.Response.HasImageGenerationCall() {
					c.Set("image_generation_call", true)
					c.Set("image_generation_call_quality", streamResponse.Response.GetQuality())
					c.Set("image_generation_call_size", streamResponse.Response.GetSize())
				}
			}
			sr.Done()
		case "response.failed", "response.error":
			applyTerminalUsage(streamResponse.Response)
			err := fmt.Errorf("responses stream ended with terminal event %q", streamResponse.Type)
			logger.LogError(c, fmt.Sprintf(
				"stream trace: stage=terminal_event elapsed_ms=%d event=%q error=%q",
				info.ElapsedMilliseconds(), streamResponse.Type, err.Error(),
			))
			sr.UpstreamError(err)
		case "response.output_text.delta":
			// 处理输出文本
			responseTextBuilder.WriteString(streamResponse.Delta)
		case dto.ResponsesOutputTypeItemDone:
			// 函数调用处理
			if streamResponse.Item != nil {
				switch streamResponse.Item.Type {
				case dto.BuildInCallWebSearchCall:
					if info != nil && info.ResponsesUsageInfo != nil && info.ResponsesUsageInfo.BuiltInTools != nil {
						if webSearchTool, exists := info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview]; exists && webSearchTool != nil {
							webSearchTool.CallCount++
						}
					}
				}
			}
		}
	})

	if info.StreamStatus != nil &&
		(info.StreamStatus.EndReason == relaycommon.StreamEndReasonUpstreamClosedEarly ||
			info.StreamStatus.EndReason == relaycommon.StreamEndReasonMissingTerminal) &&
		!responsesStreamHasDownstreamOutput(c, info) {
		return usage, types.NewOpenAIError(
			info.StreamStatus.EndError,
			types.ErrorCodeReadResponseBodyFailed,
			http.StatusBadGateway,
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

func responsesStreamHasDownstreamOutput(c *gin.Context, info *relaycommon.RelayInfo) bool {
	if info != nil && info.SendResponseCount > 0 {
		return true
	}
	return c != nil && c.Writer != nil && c.Writer.Written()
}
