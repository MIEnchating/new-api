package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEpayLegacyRSAConfigDisablesCheckoutWithoutExposingStoredKey(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	address, id, key, methods := operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey, operation_setting.PayMethods
	common.OptionMapRWMutex.Lock()
	originalOptions := common.OptionMap
	common.OptionMap = map[string]string{
		legacyEpaySignTypeOption:                    "RSA",
		"payment_setting.epay_merchant_private_key": "retired-key-fixture",
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey, operation_setting.PayMethods = address, id, key, methods
		common.OptionMapRWMutex.Lock()
		common.OptionMap = originalOptions
		common.OptionMapRWMutex.Unlock()
	})
	operation_setting.PayAddress = "https://pay.example.com"
	operation_setting.EpayId = "merchant"
	operation_setting.EpayKey = "test-md5-key"
	operation_setting.PayMethods = []map[string]string{{"type": "alipay"}}

	assert.False(t, isEpayTopUpEnabled())
	assert.Nil(t, GetEpayClient())

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/option/", nil)
	GetOptions(c)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), legacyEpaySignTypeOption)
	assert.NotContains(t, recorder.Body.String(), "retired-key-fixture")
	assert.NotContains(t, recorder.Body.String(), "payment_setting.epay_merchant_private_key")

	common.OptionMapRWMutex.Lock()
	common.OptionMap[legacyEpaySignTypeOption] = "MD5"
	common.OptionMapRWMutex.Unlock()
	assert.True(t, isEpayTopUpEnabled())
	assert.NotNil(t, GetEpayClient())
}
