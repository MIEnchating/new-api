package openai

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

const (
	thinkingTagOpen  = "<thinking>"
	thinkingTagClose = "</thinking>"
)

// ThinkingTagFilter removes upstream-only thinking blocks while preserving
// normal text across arbitrary stream chunk boundaries.
type ThinkingTagFilter struct {
	inThinking bool
	pending    string
}

func (f *ThinkingTagFilter) Write(chunk string) string {
	data := f.pending + chunk
	f.pending = ""
	var output strings.Builder

	for data != "" {
		lower := strings.ToLower(data)
		if f.inThinking {
			closeIndex := strings.Index(lower, thinkingTagClose)
			if closeIndex < 0 {
				f.pending = markerPrefixSuffix(data, thinkingTagClose)
				return output.String()
			}
			data = data[closeIndex+len(thinkingTagClose):]
			f.inThinking = false
			continue
		}

		openIndex := strings.Index(lower, thinkingTagOpen)
		closeIndex := strings.Index(lower, thinkingTagClose)
		markerIndex, markerLength, opensBlock := nextThinkingMarker(openIndex, closeIndex)
		if markerIndex < 0 {
			pending := longestMarkerPrefixSuffix(data, thinkingTagOpen, thinkingTagClose)
			output.WriteString(data[:len(data)-len(pending)])
			f.pending = pending
			return output.String()
		}

		output.WriteString(data[:markerIndex])
		data = data[markerIndex+markerLength:]
		f.inThinking = opensBlock
	}

	return output.String()
}

func (f *ThinkingTagFilter) Flush() string {
	defer func() {
		f.pending = ""
		f.inThinking = false
	}()
	if f.inThinking {
		return ""
	}
	return f.pending
}

func nextThinkingMarker(openIndex, closeIndex int) (index, length int, opensBlock bool) {
	switch {
	case openIndex >= 0 && (closeIndex < 0 || openIndex <= closeIndex):
		return openIndex, len(thinkingTagOpen), true
	case closeIndex >= 0:
		return closeIndex, len(thinkingTagClose), false
	default:
		return -1, 0, false
	}
}

func longestMarkerPrefixSuffix(value string, markers ...string) string {
	longest := ""
	for _, marker := range markers {
		candidate := markerPrefixSuffix(value, marker)
		if len(candidate) > len(longest) {
			longest = candidate
		}
	}
	return longest
}

func markerPrefixSuffix(value, marker string) string {
	lower := strings.ToLower(value)
	maxLength := min(len(value), len(marker)-1)
	for length := maxLength; length > 0; length-- {
		if lower[len(lower)-length:] == marker[:length] {
			return value[len(value)-length:]
		}
	}
	return ""
}

func stripThinkingTags(text string) string {
	filter := &ThinkingTagFilter{}
	return filter.Write(text) + filter.Flush()
}

func stripThinkingTagsFromMessage(message *dto.Message) {
	if message == nil {
		return
	}
	switch content := message.Content.(type) {
	case string:
		message.SetStringContent(stripThinkingTags(content))
	case []any:
		for _, item := range content {
			contentItem, ok := item.(map[string]any)
			if !ok || contentItem["type"] != dto.ContentTypeText {
				continue
			}
			if text, ok := contentItem["text"].(string); ok {
				contentItem["text"] = stripThinkingTags(text)
			}
		}
	}
}

func StripThinkingTagsFromChatResponse(response *dto.OpenAITextResponse) {
	if response == nil {
		return
	}
	for index := range response.Choices {
		stripThinkingTagsFromMessage(&response.Choices[index].Message)
	}
}

func StripThinkingTagsFromChatStreamResponse(
	response *dto.ChatCompletionsStreamResponse,
	filters map[int]*ThinkingTagFilter,
) {
	if response == nil {
		return
	}
	for index := range response.Choices {
		choice := &response.Choices[index]
		filter := filters[choice.Index]
		if filter == nil {
			filter = &ThinkingTagFilter{}
			filters[choice.Index] = filter
		}
		if choice.Delta.Content != nil {
			filtered := filter.Write(choice.Delta.GetContentString())
			choice.Delta.SetContentString(filtered)
		}
		if choice.FinishReason != nil {
			pending := filter.Flush()
			if pending != "" {
				choice.Delta.SetContentString(choice.Delta.GetContentString() + pending)
			}
			delete(filters, choice.Index)
		}
	}
}

func stripThinkingTagsFromResponsesResponse(response *dto.OpenAIResponsesResponse) {
	if response == nil {
		return
	}
	for outputIndex := range response.Output {
		stripThinkingTagsFromResponsesOutput(&response.Output[outputIndex])
	}
}

func stripThinkingTagsFromChatStreamData(
	data string,
	filters map[int]*ThinkingTagFilter,
) (string, error) {
	if !gjson.Get(data, "choices").Exists() {
		return data, nil
	}
	var response dto.ChatCompletionsStreamResponse
	if err := common.UnmarshalJsonStr(data, &response); err != nil {
		return "", err
	}
	StripThinkingTagsFromChatStreamResponse(&response, filters)
	for choiceIndex := range response.Choices {
		content := response.Choices[choiceIndex].Delta.Content
		if content == nil {
			continue
		}
		var err error
		data, err = sjson.Set(
			data,
			fmt.Sprintf("choices.%d.delta.content", choiceIndex),
			*content,
		)
		if err != nil {
			return "", err
		}
	}
	return data, nil
}

func stripThinkingTagsFromResponsesStreamData(
	response *dto.ResponsesStreamResponse,
	data string,
	filters map[int]*ThinkingTagFilter,
	visibleText map[int]*strings.Builder,
) (string, error) {
	if response == nil {
		return data, nil
	}
	outputIndex := 0
	if response.OutputIndex != nil {
		outputIndex = *response.OutputIndex
	}

	switch response.Type {
	case "response.output_text.delta":
		filter := filters[outputIndex]
		if filter == nil {
			filter = &ThinkingTagFilter{}
			filters[outputIndex] = filter
		}
		response.Delta = filter.Write(response.Delta)
		builder := visibleText[outputIndex]
		if builder == nil {
			builder = &strings.Builder{}
			visibleText[outputIndex] = builder
		}
		builder.WriteString(response.Delta)
		return sjson.Set(data, "delta", response.Delta)

	case "response.output_text.done":
		builder := visibleText[outputIndex]
		filter := filters[outputIndex]
		if filter != nil {
			pending := filter.Flush()
			if pending != "" {
				if builder == nil {
					builder = &strings.Builder{}
					visibleText[outputIndex] = builder
				}
				builder.WriteString(pending)
			}
		}
		text := ""
		if builder != nil {
			text = builder.String()
		} else {
			text = stripThinkingTags(gjson.Get(data, "text").String())
		}
		delete(filters, outputIndex)
		delete(visibleText, outputIndex)
		return sjson.Set(data, "text", text)

	case "response.content_part.done":
		if text := gjson.Get(data, "part.text"); text.Exists() {
			return sjson.Set(data, "part.text", stripThinkingTags(text.String()))
		}

	case dto.ResponsesOutputTypeItemDone:
		if response.Item != nil {
			stripThinkingTagsFromResponsesOutput(response.Item)
			item, err := common.Marshal(response.Item)
			if err != nil {
				return "", err
			}
			return sjson.SetRaw(data, "item", string(item))
		}

	case "response.completed", "response.done", "response.incomplete":
		if response.Response != nil {
			stripThinkingTagsFromResponsesResponse(response.Response)
			completedResponse, err := common.Marshal(response.Response)
			if err != nil {
				return "", err
			}
			return sjson.SetRaw(data, "response", string(completedResponse))
		}
	}

	return data, nil
}

func stripThinkingTagsFromResponsesOutput(output *dto.ResponsesOutput) {
	if output == nil {
		return
	}
	for index := range output.Content {
		content := &output.Content[index]
		if content.Type == "output_text" || content.Type == "text" {
			content.Text = stripThinkingTags(content.Text)
		}
	}
}
