package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestResolveRequestSiteOrigin(t *testing.T) {
	originalServerAddress := system_setting.ServerAddress
	originalTrustedOrigins := system_setting.TrustedSiteOrigins
	t.Cleanup(func() {
		system_setting.ServerAddress = originalServerAddress
		system_setting.TrustedSiteOrigins = originalTrustedOrigins
	})

	system_setting.ServerAddress = "https://example.com"
	system_setting.TrustedSiteOrigins = "https://www.example.com\nhttps://console.example.com"

	gin.SetMode(gin.TestMode)

	t.Run("uses trusted request origin", func(t *testing.T) {
		request := httptest.NewRequest("GET", "http://www.example.com/api/test", nil)
		request.Host = "www.example.com"
		request.Header.Set("X-Forwarded-Proto", "https")
		context, _ := gin.CreateTestContext(httptest.NewRecorder())
		context.Request = request

		assert.Equal(t, "https://www.example.com", ResolveRequestSiteOrigin(context))
	})

	t.Run("falls back for untrusted host", func(t *testing.T) {
		request := httptest.NewRequest("GET", "http://evil.example/api/test", nil)
		request.Host = "evil.example"
		request.Header.Set("X-Forwarded-Proto", "https")
		context, _ := gin.CreateTestContext(httptest.NewRecorder())
		context.Request = request

		assert.Equal(t, "https://example.com", ResolveRequestSiteOrigin(context))
	})
}

func TestNormalizeTrustedSiteOrigins(t *testing.T) {
	originalServerAddress := system_setting.ServerAddress
	t.Cleanup(func() {
		system_setting.ServerAddress = originalServerAddress
	})
	system_setting.ServerAddress = "https://example.com"

	normalized, err := NormalizeTrustedSiteOrigins(
		"https://example.com, https://www.example.com/\nhttps://www.example.com",
	)
	assert.NoError(t, err)
	assert.Equal(t, "https://www.example.com", normalized)

	_, err = NormalizeTrustedSiteOrigins("http://www.example.com")
	assert.Error(t, err)

	_, err = NormalizeTrustedSiteOrigins("https://www.example.com/path")
	assert.Error(t, err)
}
