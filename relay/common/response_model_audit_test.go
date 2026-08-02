package common

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestExtractActualResponseModel(t *testing.T) {
	tests := []struct {
		name string
		data string
		want string
	}{
		{name: "nested response wins", data: `{"model":"top-level","response":{"model":"gpt-5.6-terra"}}`, want: "gpt-5.6-terra"},
		{name: "top level chat response", data: `{"model":"gpt-5.6-terra","choices":[]}`, want: "gpt-5.6-terra"},
		{name: "output item event", data: `{"type":"response.output_item.done","item":{"model":"gpt-5.6-terra"}}`, want: "gpt-5.6-terra"},
		{name: "websocket session", data: `{"type":"session.updated","session":{"model":"gpt-realtime"}}`, want: "gpt-realtime"},
		{name: "missing model", data: `{"type":"response.completed","response":{"status":"completed"}}`, want: ""},
		{name: "non string model", data: `{"model":123}`, want: ""},
		{name: "invalid json", data: `{`, want: ""},
		{name: "over database limit", data: `{"model":"` + strings.Repeat("x", 101) + `"}`, want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, ExtractActualResponseModel([]byte(tt.data)))
		})
	}
}

func TestRelayInfoActualResponseModelLifecycle(t *testing.T) {
	info := &RelayInfo{}

	info.ObserveActualResponseModel([]byte(`{"model":"gpt-5.6-terra"}`))
	assert.Equal(t, "gpt-5.6-terra", info.ActualResponseModel())

	info.ObserveActualResponseModel([]byte(`{"usage":{"total_tokens":1}}`))
	assert.Equal(t, "gpt-5.6-terra", info.ActualResponseModel())

	info.ResetActualResponseModel()
	assert.Empty(t, info.ActualResponseModel())
}
