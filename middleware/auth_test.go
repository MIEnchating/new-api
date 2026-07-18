package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserSelfAuthRestoresIdentityFromSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("session", cookie.NewStore([]byte("user-self-auth-test-secret"))))
	engine.GET("/seed", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", 42)
		session.Set("username", "oauth-user")
		session.Set("role", common.RoleCommonUser)
		session.Set("status", common.UserStatusEnabled)
		session.Set("group", "default")
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})
	engine.GET("/self", UserSelfAuth(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"id": c.GetInt("id")})
	})
	engine.GET("/protected", UserAuth(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	seedResponse := httptest.NewRecorder()
	engine.ServeHTTP(seedResponse, httptest.NewRequest(http.MethodGet, "/seed", nil))
	require.Len(t, seedResponse.Result().Cookies(), 1)
	sessionCookie := seedResponse.Result().Cookies()[0]

	request := func(path string, userID string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.AddCookie(sessionCookie)
		if userID != "" {
			req.Header.Set("New-Api-User", userID)
		}
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, req)
		return response
	}

	selfWithoutHeader := request("/self", "")
	require.Equal(t, http.StatusOK, selfWithoutHeader.Code)
	assert.JSONEq(t, `{"id":42}`, selfWithoutHeader.Body.String())

	assert.Equal(t, http.StatusOK, request("/self", "42").Code)
	assert.Equal(t, http.StatusUnauthorized, request("/self", "41").Code)
	assert.Equal(t, http.StatusUnauthorized, request("/protected", "").Code)
}
