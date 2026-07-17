package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateOAuthCodeStoresTrustedReturnOrigin(t *testing.T) {
	originalServerAddress := system_setting.ServerAddress
	originalTrustedOrigins := system_setting.TrustedSiteOrigins
	t.Cleanup(func() {
		system_setting.ServerAddress = originalServerAddress
		system_setting.TrustedSiteOrigins = originalTrustedOrigins
	})
	system_setting.ServerAddress = "https://example.com"
	system_setting.TrustedSiteOrigins = "https://www.example.com"

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(sessions.Sessions("session", cookie.NewStore([]byte("oauth-origin-test-secret"))))
	router.GET("/state", GenerateOAuthCode)
	router.GET("/inspect", func(c *gin.Context) {
		session := sessions.Default(c)
		c.JSON(http.StatusOK, gin.H{
			"return_origin": session.Get("oauth_return_origin"),
			"has_state":     session.Get("oauth_state") != nil,
		})
	})

	stateRequest := httptest.NewRequest(http.MethodGet, "/state", nil)
	stateRequest.Host = "www.example.com"
	stateRequest.Header.Set("X-Forwarded-Proto", "https")
	stateResponse := httptest.NewRecorder()
	router.ServeHTTP(stateResponse, stateRequest)
	require.Equal(t, http.StatusOK, stateResponse.Code)
	require.NotEmpty(t, stateResponse.Result().Cookies())

	inspectRequest := httptest.NewRequest(http.MethodGet, "/inspect", nil)
	inspectRequest.Host = "www.example.com"
	for _, sessionCookie := range stateResponse.Result().Cookies() {
		inspectRequest.AddCookie(sessionCookie)
	}
	inspectResponse := httptest.NewRecorder()
	router.ServeHTTP(inspectResponse, inspectRequest)
	require.Equal(t, http.StatusOK, inspectResponse.Code)

	var payload struct {
		ReturnOrigin string `json:"return_origin"`
		HasState     bool   `json:"has_state"`
	}
	require.NoError(t, json.Unmarshal(inspectResponse.Body.Bytes(), &payload))
	assert.Equal(t, "https://www.example.com", payload.ReturnOrigin)
	assert.True(t, payload.HasState)
}
