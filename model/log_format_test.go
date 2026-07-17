package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/glebarez/sqlite"
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
	logs := []*Log{{
		Type:              LogTypeError,
		RequestId:         "local-request-id",
		UpstreamRequestId: "upstream-request-id",
		Content:           "status_code=500, upstream failed (request id: upstream-request-id)",
	}}

	formatUserLogs(logs, 0)

	require.Equal(t, "local-request-id", logs[0].RequestId)
	require.Empty(t, logs[0].UpstreamRequestId)
	require.Equal(t, "status_code=500, upstream failed", logs[0].Content)
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
