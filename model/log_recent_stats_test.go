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
		{CreatedAt: now - 60, Type: LogTypeConsume, RequestId: "success-5m"},
		{CreatedAt: now - 120, Type: LogTypeError, RequestId: "failure-5m"},
		{CreatedAt: now - 10*60, Type: LogTypeConsume, RequestId: "success-30m"},
		{CreatedAt: now - 40*60, Type: LogTypeError, RequestId: "failure-1h"},
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
		Requests5m:   2,
		Successes5m:  1,
		Requests30m:  3,
		Successes30m: 2,
		Requests1h:   4,
		Successes1h:  2,
	}, counts)
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
