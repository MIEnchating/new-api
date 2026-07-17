package controller

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestPaymentReturnPathUsesOnlyTrustedRequestOrigin(t *testing.T) {
	originalServerAddress := system_setting.ServerAddress
	originalTrustedOrigins := system_setting.TrustedSiteOrigins
	t.Cleanup(func() {
		system_setting.ServerAddress = originalServerAddress
		system_setting.TrustedSiteOrigins = originalTrustedOrigins
	})
	system_setting.ServerAddress = "https://example.com"
	system_setting.TrustedSiteOrigins = "https://www.example.com"

	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "http://www.example.com", nil)
	context.Request.Host = "www.example.com"
	context.Request.Header.Set("X-Forwarded-Proto", "https")
	assert.Equal(t, "https://www.example.com/console/log", paymentReturnPath(context, "/console/log"))

	context.Request.Host = "attacker.example"
	assert.Equal(t, "https://example.com/console/log", paymentReturnPath(context, "/console/log"))
}
