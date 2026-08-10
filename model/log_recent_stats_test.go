package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetRecentRelayRequestCountsUsesFinalVisibleRequests(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Log{}))

	previousLogDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousLogDB })

	now := int64(10_000)
	logs := []Log{
		{CreatedAt: now - 60, Type: LogTypeConsume, RequestId: "success-5m", UseTime: 2},
		{CreatedAt: now - 120, Type: LogTypeError, RequestId: "failure-5m", UseTime: 4},
		{CreatedAt: now - 10*60, Type: LogTypeConsume, RequestId: "success-30m", UseTime: 6},
		{CreatedAt: now - 40*60, Type: LogTypeError, RequestId: "failure-1h", UseTime: 8},
		{CreatedAt: now - 70*60, Type: LogTypeConsume, RequestId: "outside-window"},
		{CreatedAt: now - 60, Type: LogTypeConsume, RequestId: ""},
	}
	intermediateOther := map[string]interface{}{
		"admin_info": map[string]interface{}{"retry_intermediate": true},
	}
	MarkLogAdminOnly(intermediateOther)
	logs = append(logs, Log{
		CreatedAt: now - 90,
		Type:      LogTypeError,
		RequestId: "intermediate-only",
		Other:     common.MapToJsonStr(intermediateOther),
	})
	require.NoError(t, db.Create(&logs).Error)

	counts, err := GetRecentRelayRequestCounts(now)

	require.NoError(t, err)
	assert.Equal(t, RecentRelayRequestCounts{
		Requests5m:     2,
		Successes5m:    1,
		Requests30m:    3,
		Successes30m:   2,
		Requests1h:     4,
		Successes1h:    2,
		AvgUseTime5m:   3,
		AvgUseTime30m:  4,
		AvgUseTime1h:   5,
		LastRequest5m:  now - 60,
		LastRequest30m: now - 60,
		LastRequest1h:  now - 60,
	}, counts)
}

func TestGetRecentRelayRequestCountsHandlesEmptySample(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Log{}))

	previousLogDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousLogDB })

	counts, err := GetRecentRelayRequestCounts(10_000)

	require.NoError(t, err)
	assert.Equal(t, RecentRelayRequestCounts{}, counts)
}

func TestGetRecentRelayRequestCountsByGroupSeparatesMonitoredGroups(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Log{}))

	previousLogDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousLogDB })

	now := int64(15_000)
	logs := []Log{
		{CreatedAt: now - 60, Type: LogTypeConsume, RequestId: "a-success", Group: "group-a", UseTime: 2},
		{CreatedAt: now - 10*60, Type: LogTypeError, RequestId: "a-failure", Group: "group-a", UseTime: 4},
		{CreatedAt: now - 120, Type: LogTypeError, RequestId: "b-failure", Group: "group-b", UseTime: 6},
		{CreatedAt: now - 40*60, Type: LogTypeConsume, RequestId: "b-success", Group: "group-b", UseTime: 8},
	}
	require.NoError(t, db.Create(&logs).Error)

	counts, err := GetRecentRelayRequestCountsByGroup(now)

	require.NoError(t, err)
	require.Len(t, counts, 2)
	assert.Equal(t, "group-a", counts[0].GroupName)
	assert.EqualValues(t, 1, counts[0].Requests5m)
	assert.EqualValues(t, 1, counts[0].Successes5m)
	assert.EqualValues(t, 2, counts[0].Requests30m)
	assert.EqualValues(t, 1, counts[0].Successes30m)
	assert.InDelta(t, 2, counts[0].AvgUseTime5m, 0.001)
	assert.InDelta(t, 3, counts[0].AvgUseTime30m, 0.001)
	assert.EqualValues(t, now-60, counts[0].LastRequest1h)
	assert.Equal(t, "group-b", counts[1].GroupName)
	assert.EqualValues(t, 1, counts[1].Requests5m)
	assert.EqualValues(t, 0, counts[1].Successes5m)
	assert.EqualValues(t, 2, counts[1].Requests1h)
	assert.EqualValues(t, 1, counts[1].Successes1h)
	assert.InDelta(t, 6, counts[1].AvgUseTime5m, 0.001)
	assert.InDelta(t, 7, counts[1].AvgUseTime1h, 0.001)
}

func TestGetRecentRelayRequestCountsLimitsSampleToLatestFiveThousand(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Log{}))

	previousLogDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() { LOG_DB = previousLogDB })

	now := int64(20_000)
	logs := make([]Log, 0, recentRelayRequestSampleLimit+1)
	logs = append(logs, Log{
		CreatedAt: now - 30*60,
		Type:      LogTypeError,
		RequestId: "older-failure",
	})
	for i := 0; i < recentRelayRequestSampleLimit; i++ {
		logs = append(logs, Log{
			CreatedAt: now - 60,
			Type:      LogTypeConsume,
			RequestId: fmt.Sprintf("recent-success-%d", i),
		})
	}
	require.NoError(t, db.CreateInBatches(&logs, 250).Error)

	counts, err := GetRecentRelayRequestCounts(now)

	require.NoError(t, err)
	assert.EqualValues(t, recentRelayRequestSampleLimit, counts.Requests1h)
	assert.EqualValues(t, recentRelayRequestSampleLimit, counts.Successes1h)
}
