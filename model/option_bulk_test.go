package model

import (
	"errors"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestHandleConfigUpdateRefreshesRequestErrorRoutingSnapshot(t *testing.T) {
	current := operation_setting.GetRequestErrorRoutingSetting()
	original := *current
	original.Rules = append([]operation_setting.RequestErrorRoutingRule(nil), current.Rules...)
	t.Cleanup(func() {
		*current = original
		operation_setting.RefreshRequestErrorRoutingSnapshot()
	})

	require.True(t, handleConfigUpdate("request_error_routing_setting.enabled", "false"))
	err := types.NewOpenAIError(errors.New("context window exceeded"), types.ErrorCodeBadResponse, http.StatusBadGateway)

	_, matched := operation_setting.ResolveRequestErrorRouting(err)
	require.False(t, matched)
}

func TestHandleConfigUpdateRefreshesErrorResponseSnapshot(t *testing.T) {
	current := operation_setting.GetErrorResponseSetting()
	original := *current
	original.Rules = append([]operation_setting.CustomErrorResponseRule(nil), current.Rules...)
	t.Cleanup(func() {
		*current = original
		operation_setting.RefreshErrorResponseSnapshot()
	})

	require.True(t, handleConfigUpdate("error_response_setting.rules", `[{"enabled":true,"status_codes":"502","response_status_code":429,"response_message":"custom"}]`))
	require.True(t, handleConfigUpdate("error_response_setting.enabled", "true"))
	apiErr := types.NewOpenAIError(errors.New("upstream failed"), types.ErrorCodeBadResponse, http.StatusBadGateway)

	require.True(t, operation_setting.ApplyCustomErrorResponse(apiErr))
	require.Equal(t, http.StatusTooManyRequests, apiErr.StatusCode)
	require.Equal(t, "custom", apiErr.ToOpenAIError().Message)
}

func TestHandleConfigUpdateRefreshesSmartRoutingSnapshot(t *testing.T) {
	current := operation_setting.GetSmartRoutingSetting()
	original := *current
	original.Templates = operation_setting.CurrentSmartRoutingSetting().Templates
	t.Cleanup(func() {
		*current = original
		operation_setting.RefreshSmartRoutingSnapshot()
	})

	require.True(t, handleConfigUpdate("smart_routing_setting.enabled", "true"))
	require.True(t, operation_setting.CurrentSmartRoutingSetting().Enabled)
}

func TestUpdateOptionsBulkRollsBackBeforeUpdatingMemory(t *testing.T) {
	previousDB := DB
	common.OptionMapRWMutex.Lock()
	previousOptionMap := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		DB = previousDB
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptionMap
		common.OptionMapRWMutex.Unlock()
	})

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Option{}))
	require.NoError(t, db.Callback().Update().Before("gorm:update").Register(
		"test:reject-bulk-option",
		func(tx *gorm.DB) {
			option, ok := tx.Statement.Dest.(*Option)
			if ok && option.Key == "bulk.fail" {
				tx.AddError(errors.New("forced bulk update failure"))
			}
		},
	))
	DB = db

	err = UpdateOptionsBulk(map[string]string{
		"bulk.ok":   "first",
		"bulk.fail": "second",
	})
	require.Error(t, err)

	var count int64
	require.NoError(t, db.Model(&Option{}).Count(&count).Error)
	assert.Zero(t, count)
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	assert.Empty(t, common.OptionMap)
}
