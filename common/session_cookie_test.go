package common

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClearLegacyHostOnlySessionCookiePreservesSharedSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetSessionCookieSettingsAfterTest(t)
	SessionCookieSecure = true
	SessionCookieDomain = "example.com"

	engine := gin.New()
	store := cookie.NewStore([]byte("session-cookie-migration-test-secret"))
	store.Options(sessions.Options{
		Path:     "/",
		MaxAge:   2592000,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
	engine.Use(sessions.Sessions("session", store))
	engine.Use(func(c *gin.Context) {
		options := sessions.Options{
			Path:     "/",
			Domain:   SessionDomainForHost(c.Request.Host),
			MaxAge:   2592000,
			HttpOnly: true,
			Secure:   true,
			SameSite: http.SameSiteStrictMode,
		}
		sessions.Default(c).Options(options)
		c.Next()
	})
	engine.GET("/login", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("pending_user_id", 42)
		require.NoError(t, session.Save())
		ClearLegacyHostOnlySessionCookie(c)
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/login", nil)
	request.Host = "www.example.com"
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)

	require.Equal(t, http.StatusNoContent, response.Code)
	require.Len(t, response.Result().Cookies(), 2)

	var sharedCookie, deletionCookie *http.Cookie
	for _, responseCookie := range response.Result().Cookies() {
		if responseCookie.Domain == "example.com" {
			sharedCookie = responseCookie
		} else if responseCookie.Domain == "" && responseCookie.MaxAge < 0 {
			deletionCookie = responseCookie
		}
	}
	require.NotNil(t, sharedCookie)
	assert.NotEmpty(t, sharedCookie.Value)
	require.NotNil(t, deletionCookie)
	assert.Empty(t, deletionCookie.Value)
	assert.Equal(t, "/", deletionCookie.Path)
}

func TestClearLegacyHostOnlySessionCookieSkipsUnrelatedHost(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetSessionCookieSettingsAfterTest(t)
	SessionCookieSecure = true
	SessionCookieDomain = "example.com"

	engine := gin.New()
	engine.GET("/", func(c *gin.Context) {
		ClearLegacyHostOnlySessionCookie(c)
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Host = "example.net"
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)

	assert.Empty(t, response.Header().Values("Set-Cookie"))
}

func TestClearLegacyHostOnlySessionCookieSkipsRootDomain(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetSessionCookieSettingsAfterTest(t)
	SessionCookieSecure = true
	SessionCookieDomain = "example.com"

	engine := gin.New()
	engine.GET("/", func(c *gin.Context) {
		ClearLegacyHostOnlySessionCookie(c)
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Host = "example.com"
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)

	assert.Empty(t, response.Header().Values("Set-Cookie"))
}
