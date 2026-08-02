package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestFormatUserLogsStripsQuotaSaturation verifies the admin-only quota
// saturation marker (nested under other.admin_info) is removed for non-admin
// log views, since formatUserLogs strips the whole admin_info object.
func TestFormatUserLogsStripsQuotaSaturation(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"model_price": 0.004,
		"admin_info": map[string]interface{}{
			"quota_saturation": map[string]interface{}{
				"op":      "QuotaFromDecimal",
				"kind":    "overflow",
				"clamped": common.MaxQuota,
			},
		},
	})
	logs := []*Log{{Other: other}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	_, hasAdminInfo := parsed["admin_info"]
	require.False(t, hasAdminInfo, "admin_info (and nested quota_saturation) must be stripped for non-admin views")
	// Non-admin billing fields remain visible.
	require.Contains(t, parsed, "model_price")
}

func TestFormatUserLogsStripsUpstreamRequestID(t *testing.T) {
	actualResponseModel := "gpt-5.6-terra"
	logs := []*Log{{
		Type:                LogTypeError,
		ChannelId:           17,
		ChannelName:         "private-channel",
		RequestId:           "local-request-id",
		UpstreamRequestId:   "upstream-request-id",
		ActualResponseModel: &actualResponseModel,
		Content:             "status_code=500, upstream failed (request id: upstream-request-id)",
		Other: common.MapToJsonStr(map[string]interface{}{
			"channel_id":   17,
			"channel_name": "private-channel",
			"channel_type": 1,
			"request_path": "/v1/responses",
			"admin_info": map[string]interface{}{
				"upstream_request_ids": []string{"upstream-1", "upstream-2"},
			},
		}),
	}}

	formatUserLogs(logs, 0)

	require.Equal(t, "local-request-id", logs[0].RequestId)
	require.Zero(t, logs[0].ChannelId)
	require.Empty(t, logs[0].ChannelName)
	require.Empty(t, logs[0].UpstreamRequestId)
	require.Nil(t, logs[0].ActualResponseModel)
	require.Equal(t, "status_code=500, upstream failed", logs[0].Content)
	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	require.NotContains(t, parsed, "channel_id")
	require.NotContains(t, parsed, "channel_name")
	require.NotContains(t, parsed, "channel_type")
	require.NotContains(t, parsed, "admin_info")
	require.Equal(t, "/v1/responses", parsed["request_path"])
}

func TestRecordConsumeLogPersistsNullableActualResponseModel(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Log{}))
	require.True(t, db.Migrator().HasColumn(&Log{}, "actual_response_model"))

	previousLogDB := LOG_DB
	previousLogConsumeEnabled := common.LogConsumeEnabled
	LOG_DB = db
	common.LogConsumeEnabled = true
	t.Cleanup(func() {
		LOG_DB = previousLogDB
		common.LogConsumeEnabled = previousLogConsumeEnabled
	})

	c, _ := gin.CreateTestContext(nil)
	c.Set("username", "audit-user")
	RecordConsumeLog(c, 1, RecordConsumeLogParams{
		ModelName:           "gpt-5.6-sol",
		ActualResponseModel: "gpt-5.6-terra",
	})
	RecordConsumeLog(c, 1, RecordConsumeLogParams{ModelName: "gpt-5.6-sol"})

	var logs []Log
	require.NoError(t, db.Order("id ASC").Find(&logs).Error)
	require.Len(t, logs, 2)
	require.NotNil(t, logs[0].ActualResponseModel)
	assert.Equal(t, "gpt-5.6-terra", *logs[0].ActualResponseModel)
	assert.Nil(t, logs[1].ActualResponseModel)
}

func TestAppendUpstreamRequestIdsAdminInfo(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	c.Set(common.UpstreamRequestIdsKey, []string{"upstream-1", "upstream-2"})
	c.Set(common.UpstreamRequestIdSourcesKey, map[string]string{
		"upstream-1": "x-oneapi-request-id",
		"upstream-2": "x-request-id",
	})
	other := map[string]interface{}{
		"admin_info": map[string]interface{}{"use_channel": []int{11, 12}},
	}

	appendUpstreamRequestIdsAdminInfo(c, other)

	adminInfo := other["admin_info"].(map[string]interface{})
	require.Equal(t, []string{"upstream-1", "upstream-2"}, adminInfo["upstream_request_ids"])
	require.Equal(t, map[string]string{
		"upstream-1": "x-oneapi-request-id",
		"upstream-2": "x-request-id",
	}, adminInfo["upstream_request_id_sources"])
	require.Equal(t, []int{11, 12}, adminInfo["use_channel"])
}

func TestUserLogQueriesExcludeAdminOnlyRetryFailures(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Log{}))

	previousLogDB := LOG_DB
	LOG_DB = db
	t.Cleanup(func() {
		LOG_DB = previousLogDB
	})

	intermediateOther := map[string]interface{}{
		"admin_info": map[string]interface{}{"retry_intermediate": true},
	}
	MarkLogAdminOnly(intermediateOther)
	require.NoError(t, db.Create(&Log{
		UserId:    42,
		Type:      LogTypeError,
		TokenId:   7,
		RequestId: "retry-request",
		Content:   "first channel failed",
		Other:     common.MapToJsonStr(intermediateOther),
	}).Error)
	require.NoError(t, db.Create(&Log{
		UserId:    42,
		Type:      LogTypeError,
		TokenId:   7,
		RequestId: "retry-request",
		Content:   "final channel failed",
		Other:     common.MapToJsonStr(map[string]interface{}{}),
	}).Error)

	userLogs, total, err := GetUserLogs(42, LogTypeUnknown, 0, 0, "", "", 0, 20, "", "", "")
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Len(t, userLogs, 1)
	require.Equal(t, "final channel failed", userLogs[0].Content)

	tokenLogs, err := GetLogByTokenId(7)
	require.NoError(t, err)
	require.Len(t, tokenLogs, 1)
	require.Equal(t, "final channel failed", tokenLogs[0].Content)

	adminLogs, adminTotal, err := GetAllLogs(LogTypeUnknown, 0, 0, "", "", "", 0, 20, 0, "", "", "")
	require.NoError(t, err)
	require.EqualValues(t, 2, adminTotal)
	require.Len(t, adminLogs, 2)
	intermediateLog := adminLogs[1]
	if adminLogs[0].Content == "first channel failed" {
		intermediateLog = adminLogs[0]
	}
	require.Equal(t, "first channel failed", intermediateLog.Content)
	adminOther, err := common.StrToMap(intermediateLog.Other)
	require.NoError(t, err)
	require.Equal(t, false, adminOther[logUserVisibleKey])
	adminInfo, ok := adminOther["admin_info"].(map[string]interface{})
	require.True(t, ok)
	require.Equal(t, true, adminInfo["retry_intermediate"])
}

func TestSanitizeErrorLogContentsPreservesAdminUpstreamField(t *testing.T) {
	logs := []*Log{
		{
			Type:              LogTypeError,
			UpstreamRequestId: "upstream-request-id",
			Content:           "upstream failed (request id: upstream-request-id)",
		},
		{
			Type:    LogTypeManage,
			Content: "updated label (request id: preserved-as-content)",
		},
	}

	sanitizeErrorLogContents(logs)

	require.Equal(t, "upstream-request-id", logs[0].UpstreamRequestId)
	require.Equal(t, "upstream failed", logs[0].Content)
	require.Equal(t, "updated label (request id: preserved-as-content)", logs[1].Content)
}

func TestFormatUserLogsMasksTransportDetailsButAdminFormattingKeepsThem(t *testing.T) {
	rawContent := `status_code=500, Post "https://api.x5m5x.com/v1/images/generations?key=secret": dial tcp 194.147.98.184:443: connect: connection refused`
	userLogs := []*Log{{Type: LogTypeError, Content: rawContent}}
	adminLogs := []*Log{{Type: LogTypeError, Content: rawContent}}

	formatUserLogs(userLogs, 0)
	sanitizeErrorLogContents(adminLogs)

	require.Contains(t, userLogs[0].Content, "connect: connection refused")
	require.Contains(t, userLogs[0].Content, "***")
	require.NotContains(t, userLogs[0].Content, "api.x5m5x.com")
	require.NotContains(t, userLogs[0].Content, "194.147.98.184")
	require.NotContains(t, userLogs[0].Content, "secret")
	require.Equal(t, rawContent, adminLogs[0].Content)
}

func TestFormatUserLogsKeepsOriginalStreamStatus(t *testing.T) {
	endError := `Authorization: Bearer sk-terminal-secret from https://api.example.com/v1/responses (request id: upstream-terminal-id)`
	softErrors := []string{
		`authorization: bearer sk-soft-secret (request id: upstream-soft-id)`,
		`dial tcp 192.0.2.10:443: connection refused`,
	}
	logs := []*Log{{
		Type: LogTypeError,
		Other: common.MapToJsonStr(map[string]interface{}{
			"admin_info":   map[string]interface{}{"channel_id": 99},
			"channel_id":   99,
			"channel_name": "admin-only-channel",
			"stream_status": map[string]interface{}{
				"status":      "error",
				"end_reason":  "scanner_error",
				"end_error":   endError,
				"error_count": 2,
				"errors":      softErrors,
			},
		}),
	}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	streamStatus, ok := parsed["stream_status"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "error", streamStatus["status"])
	assert.Equal(t, "scanner_error", streamStatus["end_reason"])
	assert.EqualValues(t, 2, streamStatus["error_count"])
	assert.Equal(t, endError, streamStatus["end_error"])

	streamErrors, ok := streamStatus["errors"].([]interface{})
	require.True(t, ok)
	assert.Equal(t, []interface{}{softErrors[0], softErrors[1]}, streamErrors)
	assert.NotContains(t, parsed, "admin_info")
	assert.NotContains(t, parsed, "channel_id")
	assert.NotContains(t, parsed, "channel_name")
}

func TestAuditLogsPreserveHTTPRequestID(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&User{}, &Log{}))
	require.NoError(t, db.Create(&User{Id: 7, Username: "audit-admin", Password: "password"}).Error)

	previousDB := DB
	previousLogDB := LOG_DB
	previousRedisEnabled := common.RedisEnabled
	DB = db
	LOG_DB = db
	common.RedisEnabled = false
	t.Cleanup(func() {
		DB = previousDB
		LOG_DB = previousLogDB
		common.RedisEnabled = previousRedisEnabled
	})

	RecordLoginLog(
		7,
		"audit-admin",
		"Logged in successfully via 2fa",
		"127.0.0.1",
		"http-login-request-id",
		"login",
		map[string]interface{}{"method": "2fa"},
		map[string]interface{}{"second_factor_method": "totp"},
	)
	RecordOperationAuditLog(
		7,
		"Updated system setting RetryTimes",
		"127.0.0.1",
		"http-manage-request-id",
		"option.update",
		map[string]interface{}{"key": "RetryTimes", "from": "0", "to": "1"},
		map[string]interface{}{"admin_id": 7},
		map[string]interface{}{"method": "PUT", "success": true},
	)

	var loginLog Log
	require.NoError(t, db.Where("type = ?", LogTypeLogin).First(&loginLog).Error)
	require.Equal(t, "http-login-request-id", loginLog.RequestId)
	loginOther, err := common.StrToMap(loginLog.Other)
	require.NoError(t, err)
	require.Equal(t, "totp", loginOther["second_factor_method"])

	var manageLog Log
	require.NoError(t, db.Where("type = ?", LogTypeManage).First(&manageLog).Error)
	require.Equal(t, "http-manage-request-id", manageLog.RequestId)
	manageOther, err := common.StrToMap(manageLog.Other)
	require.NoError(t, err)
	require.Contains(t, manageOther, "audit_info")
}
