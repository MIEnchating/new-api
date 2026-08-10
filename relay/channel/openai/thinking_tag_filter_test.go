package openai

import (
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStripThinkingTags(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "complete block", input: "before<thinking>private</thinking>after", want: "beforeafter"},
		{name: "case insensitive", input: "<THINKING>private</THINKING>answer", want: "answer"},
		{name: "unclosed block", input: "answer<thinking>private", want: "answer"},
		{name: "orphan close tag", input: "answer</thinking>", want: "answer"},
		{name: "ordinary angle brackets", input: "1 < 2 and visible", want: "1 < 2 and visible"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, stripThinkingTags(tt.input))
		})
	}
}

func TestThinkingTagFilterHandlesSplitMarkers(t *testing.T) {
	filter := &ThinkingTagFilter{}
	chunks := []string{"visible<thi", "nking>secret", "</think", "ing>answer"}
	want := []string{"visible", "", "", "answer"}
	for index, chunk := range chunks {
		assert.Equal(t, want[index], filter.Write(chunk))
	}
	assert.Empty(t, filter.Flush())
}

func TestStripThinkingTagsFromChatStreamKeepsChoiceStateSeparate(t *testing.T) {
	filters := make(map[int]*ThinkingTagFilter)
	first := "<thinking>private"
	visible := "choice one"
	response := dto.ChatCompletionsStreamResponse{
		Choices: []dto.ChatCompletionsStreamResponseChoice{
			{Index: 0, Delta: dto.ChatCompletionsStreamResponseChoiceDelta{Content: &first}},
			{Index: 1, Delta: dto.ChatCompletionsStreamResponseChoiceDelta{Content: &visible}},
		},
	}

	StripThinkingTagsFromChatStreamResponse(&response, filters)

	require.Len(t, response.Choices, 2)
	assert.Empty(t, response.Choices[0].Delta.GetContentString())
	assert.Equal(t, visible, response.Choices[1].Delta.GetContentString())
	assert.True(t, filters[0].inThinking)
	assert.False(t, filters[1].inThinking)
}

func TestStripThinkingTagsFromResponsesResponseOnlyChangesTextOutput(t *testing.T) {
	response := &dto.OpenAIResponsesResponse{Output: []dto.ResponsesOutput{
		{
			Type: "message",
			Content: []dto.ResponsesOutputContent{
				{Type: "output_text", Text: "<thinking>private</thinking>answer"},
				{Type: "input_text", Text: "<thinking>keep input</thinking>"},
			},
		},
	}}

	stripThinkingTagsFromResponsesResponse(response)

	assert.Equal(t, "answer", response.Output[0].Content[0].Text)
	assert.Equal(t, "<thinking>keep input</thinking>", response.Output[0].Content[1].Text)
}
