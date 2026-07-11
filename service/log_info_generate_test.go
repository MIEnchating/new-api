package service

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/stretchr/testify/require"
)

func TestAppendStreamStatusCompletionStateDoesNotDependOnTokenCount(t *testing.T) {
	tests := []struct {
		name             string
		reason           relaycommon.StreamEndReason
		downstreamEvents int
		wantState        string
		wantStatus       string
	}{
		{name: "completed", reason: relaycommon.StreamEndReasonDone, downstreamEvents: 4, wantState: "completed", wantStatus: "ok"},
		{name: "no output", reason: relaycommon.StreamEndReasonClientGone, downstreamEvents: 0, wantState: "no_output", wantStatus: "error"},
		{name: "partial output", reason: relaycommon.StreamEndReasonMissingTerminal, downstreamEvents: 3, wantState: "partial_output", wantStatus: "error"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			status := relaycommon.NewStreamStatus()
			status.SetEndReason(test.reason, nil)
			info := &relaycommon.RelayInfo{
				IsStream:              true,
				StreamStatus:          status,
				ReceivedResponseCount: test.downstreamEvents,
				SendResponseCount:     test.downstreamEvents,
			}
			other := map[string]interface{}{}

			AppendStreamStatus(info, other)

			streamInfo := other["stream_status"].(map[string]interface{})
			require.Equal(t, test.wantState, streamInfo["completion_state"])
			require.Equal(t, test.wantStatus, streamInfo["status"])
			require.Equal(t, test.downstreamEvents, streamInfo["upstream_event_count"])
			require.Equal(t, test.downstreamEvents, streamInfo["downstream_event_count"])
		})
	}
}
