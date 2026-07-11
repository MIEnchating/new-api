package service

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/stretchr/testify/require"
)

func TestAppendStreamStatusKeepsBasicFieldsOnly(t *testing.T) {
	status := relaycommon.NewStreamStatus()
	status.SetEndReason(relaycommon.StreamEndReasonTimeout, nil)
	info := &relaycommon.RelayInfo{
		IsStream:              true,
		StreamStatus:          status,
		ReceivedResponseCount: 4,
		SendResponseCount:     3,
	}
	other := map[string]interface{}{}

	AppendStreamStatus(info, other)

	streamInfo := other["stream_status"].(map[string]interface{})
	require.Equal(t, "error", streamInfo["status"])
	require.Equal(t, "timeout", streamInfo["end_reason"])
	require.NotContains(t, streamInfo, "completion_state")
	require.NotContains(t, streamInfo, "upstream_event_count")
	require.NotContains(t, streamInfo, "downstream_event_count")
}
