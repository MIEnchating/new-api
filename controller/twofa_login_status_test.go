package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestGet2FALoginStatusRequiresUnexpiredPendingSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("session", cookie.NewStore([]byte("twofa-login-status-test-secret"))))
	engine.GET("/seed/:state", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("pending_user_id", 42)
		expiresAt := time.Now().Add(time.Minute)
		if c.Param("state") == "expired" {
			expiresAt = time.Now().Add(-time.Minute)
		}
		session.Set("pending_2fa_expires_at", expiresAt.Unix())
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})
	engine.GET("/status", Get2FALoginStatus)

	requestStatus := func(cookieToSend *http.Cookie) bool {
		request := httptest.NewRequest(http.MethodGet, "/status", nil)
		if cookieToSend != nil {
			request.AddCookie(cookieToSend)
		}
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, request)
		require.Equal(t, http.StatusOK, response.Code)

		var body struct {
			Success bool `json:"success"`
			Data    struct {
				Pending bool `json:"pending"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
		require.True(t, body.Success)
		return body.Data.Pending
	}

	require.False(t, requestStatus(nil))

	validSeed := httptest.NewRecorder()
	engine.ServeHTTP(validSeed, httptest.NewRequest(http.MethodGet, "/seed/valid", nil))
	require.Len(t, validSeed.Result().Cookies(), 1)
	require.True(t, requestStatus(validSeed.Result().Cookies()[0]))

	expiredSeed := httptest.NewRecorder()
	engine.ServeHTTP(expiredSeed, httptest.NewRequest(http.MethodGet, "/seed/expired", nil))
	require.Len(t, expiredSeed.Result().Cookies(), 1)
	require.False(t, requestStatus(expiredSeed.Result().Cookies()[0]))
}
