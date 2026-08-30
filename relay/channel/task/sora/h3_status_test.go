package sora

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseTaskResultMapsH3NonTerminalStatuses(t *testing.T) {
	tests := []struct {
		name       string
		status     string
		wantStatus string
	}{
		{name: "submitting", status: "submitting", wantStatus: model.TaskStatusSubmitted},
		{name: "enhancing", status: "enhancing", wantStatus: model.TaskStatusInProgress},
	}

	adaptor := &TaskAdaptor{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := adaptor.ParseTaskResult([]byte(`{"id":"task_h3","status":"` + tt.status + `"}`))
			require.NoError(t, err)
			assert.Equal(t, tt.wantStatus, result.Status)
		})
	}
}
