package controller

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestPaymentReturnPathUsesTrustedRequestOriginAndDefaultRoutes(t *testing.T) {
	previousAddress := system_setting.ServerAddress
	previousTrustedOrigins := system_setting.TrustedSiteOrigins
	system_setting.ServerAddress = "https://dashboard.example.com/"
	system_setting.TrustedSiteOrigins = "https://www.example.com"
	t.Cleanup(func() {
		system_setting.ServerAddress = previousAddress
		system_setting.TrustedSiteOrigins = previousTrustedOrigins
	})

	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "http://www.example.com", nil)
	context.Request.Host = "www.example.com"
	context.Request.Header.Set("X-Forwarded-Proto", "https")

	assert.Equal(t, "https://www.example.com/wallet?pay=success", paymentReturnPath(context, "/console/topup?pay=success"))
	assert.Equal(t, "https://www.example.com/usage-logs", paymentReturnPath(context, "/console/log"))

	context.Request.Host = "attacker.example"
	assert.Equal(t, "https://dashboard.example.com/wallet", paymentReturnPath(context, "/console/topup"))
}
