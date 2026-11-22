package openai

import (
	"strconv"

	"github.com/MoeForge/moego/ojson"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

const (
	maxPendingBlankMessageBytes = 16 << 10
	maxFilteredBlankMessages    = 64
)

type responsesSSEFrame struct {
	event string
	data  string
}

// Buffer one candidate item until its adjacent frames confirm the complete
// placeholder. Flush immediately on interleaving or unexpected content.
type responsesBlankMessageFilter struct {
	pending      []responsesSSEFrame
	pendingBytes int
	pendingID    string
	pendingIndex int
	pendingDelta bool
	removed      map[int]string
}

func (f *responsesBlankMessageFilter) forward(event dto.ResponsesStreamResponse, frame responsesSSEFrame, write func(responsesSSEFrame) error) error {
	// Adjust only the client view, including candidate frames that may need to
	// be flushed. The caller accounts for the original frames.
	if len(f.removed) > 0 {
		data, err := f.remapOutput(event, frame.data)
		if err != nil {
			return err
		}
		frame.data = data
	}
	if f.pendingID != "" {
		if event.OutputIndex != nil && *event.OutputIndex == f.pendingIndex &&
			f.pendingBytes+len(frame.data) <= maxPendingBlankMessageBytes {
			if event.Type == dto.ResponsesOutputTypeItemDone && event.Item != nil &&
				event.Item.ID == f.pendingID && isBlankResponsesMessage(*event.Item) {
				if f.removed == nil {
					f.removed = make(map[int]string)
				}
				f.removed[f.pendingIndex] = f.pendingID
				f.clearPending()
				return nil
			}
			if event.ItemID == f.pendingID && isBlankResponsesMessagePart(event, frame.data) &&
				(event.Type != "response.output_text.delta" || !f.pendingDelta || event.Delta == "") {
				f.pending = append(f.pending, frame)
				f.pendingBytes += len(frame.data)
				if event.Type == "response.output_text.delta" && event.Delta == " " {
					f.pendingDelta = true
				}
				return nil
			}
		}
		if err := f.flush(write); err != nil {
			return err
		}
	}

	if len(f.removed) < maxFilteredBlankMessages &&
		event.Type == dto.ResponsesOutputTypeItemAdded && event.OutputIndex != nil &&
		*event.OutputIndex >= 0 && f.removed[*event.OutputIndex] == "" && event.Item != nil &&
		isBlankResponsesMessageCandidate(*event.Item) && len(frame.data) <= maxPendingBlankMessageBytes {
		f.pendingID = event.Item.ID
		f.pendingIndex = *event.OutputIndex
		f.pending = append(f.pending, frame)
		f.pendingBytes = len(frame.data)
		return nil
	}
	return write(frame)
}

func (f *responsesBlankMessageFilter) flush(write func(responsesSSEFrame) error) error {
	pending := f.pending
	f.clearPending()
	for _, frame := range pending {
		if err := write(frame); err != nil {
			return err
		}
	}
	return nil
}

func (f *responsesBlankMessageFilter) clearPending() {
	f.pending = nil
	f.pendingBytes = 0
	f.pendingID = ""
	f.pendingDelta = false
}

func (f *responsesBlankMessageFilter) remapOutput(event dto.ResponsesStreamResponse, data string) (string, error) {
	if event.OutputIndex != nil {
		index := *event.OutputIndex
		for removedIndex := range f.removed {
			if removedIndex < *event.OutputIndex {
				index--
			}
		}
		if index != *event.OutputIndex {
			var err error
			data, err = ojson.Set(data, "output_index", index)
			if err != nil {
				return "", err
			}
		}
	}
	if event.Response != nil {
		// Delete in descending order so array positions never shift under us.
		for i := len(event.Response.Output) - 1; i >= 0; i-- {
			item := event.Response.Output[i]
			if item.ID == "" || item.ID != f.removed[i] || !isBlankResponsesMessage(item) {
				continue
			}
			var err error
			data, err = ojson.Delete(data, "response.output."+strconv.Itoa(i))
			if err != nil {
				return "", err
			}
		}
	}
	return data, nil
}

func isBlankResponsesMessageCandidate(item dto.ResponsesOutput) bool {
	return item.Type == "message" && item.Role == "assistant" && item.ID != "" &&
		(len(item.Content) == 0 || hasSingleBlankText(item.Content))
}

func isBlankResponsesMessage(item dto.ResponsesOutput) bool {
	return item.Status == "completed" && isBlankResponsesMessageCandidate(item) &&
		len(item.Content) == 1 && item.Content[0].Text == " "
}

func hasSingleBlankText(content []dto.ResponsesOutputContent) bool {
	return len(content) == 1 && content[0].Type == "output_text" && len(content[0].Annotations) == 0 &&
		(content[0].Text == "" || content[0].Text == " ")
}

func isBlankResponsesMessagePart(event dto.ResponsesStreamResponse, data string) bool {
	if event.ContentIndex == nil || *event.ContentIndex != 0 {
		return false
	}
	switch event.Type {
	case "response.content_part.added", "response.content_part.done":
		part := ojson.Get(data, "part")
		text := part.Get("text")
		annotations := part.Get("annotations")
		return part.Get("type").String() == "output_text" && text.Exists() &&
			(text.String() == "" || text.String() == " ") &&
			(!annotations.Exists() || (annotations.IsArray() && len(annotations.Array()) == 0))
	case "response.output_text.delta":
		return event.Delta == "" || event.Delta == " "
	case "response.output_text.done":
		return event.Text != nil && (*event.Text == "" || *event.Text == " ")
	}
	return false
}
