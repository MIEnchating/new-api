package controller

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetTopUpInfoInviteRechargeRebateState(t *testing.T) {
	gin.SetMode(gin.TestMode)
	paymentSetting := operation_setting.GetPaymentSetting()
	originalRatio := common.InviteRechargeRebateRatio
	originalConfirmed := paymentSetting.ComplianceConfirmed
	originalTermsVersion := paymentSetting.ComplianceTermsVersion
	t.Cleanup(func() {
		common.InviteRechargeRebateRatio = originalRatio
		paymentSetting.ComplianceConfirmed = originalConfirmed
		paymentSetting.ComplianceTermsVersion = originalTermsVersion
	})

	tests := []struct {
		name       string
		ratio      float64
		compliant  bool
		wantActive bool
	}{
		{name: "configured and compliant", ratio: 0.2, compliant: true, wantActive: true},
		{name: "zero disables rebate", ratio: 0, compliant: true, wantActive: false},
		{name: "compliance disables rebate", ratio: 0.2, compliant: false, wantActive: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			common.InviteRechargeRebateRatio = test.ratio
			paymentSetting.ComplianceConfirmed = test.compliant
			if test.compliant {
				paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
			} else {
				paymentSetting.ComplianceTermsVersion = ""
			}

			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			GetTopUpInfo(context)

			require.Equal(t, 200, recorder.Code)
			var response struct {
				Success bool `json:"success"`
				Data    struct {
					Enabled bool    `json:"invite_recharge_rebate_enabled"`
					Ratio   float64 `json:"invite_recharge_rebate_ratio"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.True(t, response.Success)
			assert.Equal(t, test.wantActive, response.Data.Enabled)
			assert.Equal(t, test.ratio, response.Data.Ratio)
		})
	}
}
