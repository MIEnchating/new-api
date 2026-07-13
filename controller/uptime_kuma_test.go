package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeMonitorHeartbeatsUsesLatestTimestamp(t *testing.T) {
	oldPing := 1200
	latestPing := 800
	monitor := Monitor{
		Heartbeats: []Heartbeat{
			{Status: 1, Time: "2026-07-13 10:00:00.000", Ping: &latestPing},
			{Status: 0, Time: "2026-07-13 09:00:00.000", Ping: &oldPing},
		},
	}

	normalizeMonitorHeartbeats(&monitor)

	require.Len(t, monitor.Heartbeats, 2)
	assert.Equal(t, "2026-07-13 09:00:00.000", monitor.Heartbeats[0].Time)
	assert.Equal(t, "2026-07-13 10:00:00.000", monitor.LastChecked)
	assert.Equal(t, 1, monitor.Status)
	assert.Equal(t, latestPing, *monitor.Ping)
}

func TestNormalizeUptimeHeartbeatTimeMarksNaiveTimestampAsUTC(t *testing.T) {
	assert.Equal(
		t,
		"2026-07-13T03:13:06.779Z",
		normalizeUptimeHeartbeatTime("2026-07-13 03:13:06.779"),
	)
}
