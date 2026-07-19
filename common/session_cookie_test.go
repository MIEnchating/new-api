package common

import (
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
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
		ClearLegacyHostOnlySessionCookie(c)
		require.NoError(t, session.Save())
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

func TestSessionCookieSameSiteAllowsOAuthTopLevelCallback(t *testing.T) {
	assert.Equal(t, http.SameSiteLaxMode, SessionCookieSameSite)
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

func TestClearLegacyHostOnlySessionCookieClearsRootDomain(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetSessionCookieSettingsAfterTest(t)
	SessionCookieSecure = true
	SessionCookieDomain = "example.com"

	engine := gin.New()
	store := cookie.NewStore([]byte("root-session-cookie-migration-test-secret"))
	store.Options(sessions.Options{
		Path:     "/",
		MaxAge:   2592000,
		HttpOnly: true,
		Secure:   true,
		SameSite: SessionCookieSameSite,
	})
	engine.Use(sessions.Sessions("session", store))
	engine.Use(func(c *gin.Context) {
		options := sessions.Options{
			Path:     "/",
			Domain:   SessionDomainForHost(c.Request.Host),
			MaxAge:   2592000,
			HttpOnly: true,
			Secure:   true,
			SameSite: SessionCookieSameSite,
		}
		sessions.Default(c).Options(options)
		c.Next()
	})
	engine.GET("/", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", 42)
		ClearLegacyHostOnlySessionCookie(c)
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Host = "example.com"
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)

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
}

func TestClearDuplicateLegacySessionCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetSessionCookieSettingsAfterTest(t)
	SessionCookieSecure = true
	SessionCookieDomain = "example.com"

	engine := gin.New()
	engine.GET("/", func(c *gin.Context) {
		ClearDuplicateLegacySessionCookie(c)
		c.Status(http.StatusNoContent)
	})

	for _, host := range []string{"example.com", "www.example.com"} {
		t.Run(host, func(t *testing.T) {
			duplicateRequest := httptest.NewRequest(http.MethodGet, "/", nil)
			duplicateRequest.Host = host
			duplicateRequest.Header.Set(
				"Cookie",
				"session=legacy-host-session; session=shared-domain-session",
			)
			duplicateResponse := httptest.NewRecorder()
			engine.ServeHTTP(duplicateResponse, duplicateRequest)

			require.Len(t, duplicateResponse.Result().Cookies(), 1)
			deletionCookie := duplicateResponse.Result().Cookies()[0]
			assert.Equal(t, "session", deletionCookie.Name)
			assert.Empty(t, deletionCookie.Domain)
			assert.Less(t, deletionCookie.MaxAge, 0)
		})
	}

	singleRequest := httptest.NewRequest(http.MethodGet, "/", nil)
	singleRequest.Host = "www.example.com"
	singleRequest.Header.Set("Cookie", "session=shared-domain-session")
	singleResponse := httptest.NewRecorder()
	engine.ServeHTTP(singleResponse, singleRequest)

	assert.Empty(t, singleResponse.Header().Values("Set-Cookie"))
}

func TestLegacyHostOnlySessionMigrationUsesSharedSessionOnNextRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetSessionCookieSettingsAfterTest(t)
	SessionCookieSecure = true
	SessionCookieDomain = "example.com"

	const secret = "legacy-session-cookie-integration-test-secret"
	for _, host := range []string{"example.com", "www.example.com"} {
		t.Run(host, func(t *testing.T) {
			jar, err := cookiejar.New(nil)
			require.NoError(t, err)

			legacyEngine := gin.New()
			legacyStore := cookie.NewStore([]byte(secret))
			legacyStore.Options(sessions.Options{
				Path:     "/",
				MaxAge:   2592000,
				HttpOnly: true,
				Secure:   true,
				SameSite: SessionCookieSameSite,
			})
			legacyEngine.Use(sessions.Sessions("session", legacyStore))
			legacyEngine.GET("/legacy-login", func(c *gin.Context) {
				session := sessions.Default(c)
				session.Set("id", 7)
				require.NoError(t, session.Save())
				c.Status(http.StatusNoContent)
			})

			newEngine := gin.New()
			newStore := cookie.NewStore([]byte(secret))
			newStore.Options(sessions.Options{
				Path:     "/",
				MaxAge:   2592000,
				HttpOnly: true,
				Secure:   true,
				SameSite: SessionCookieSameSite,
			})
			newEngine.Use(sessions.Sessions("session", newStore))
			newEngine.Use(func(c *gin.Context) {
				options := sessions.Options{
					Path:     "/",
					Domain:   SessionDomainForHost(c.Request.Host),
					MaxAge:   2592000,
					HttpOnly: true,
					Secure:   true,
					SameSite: SessionCookieSameSite,
				}
				sessions.Default(c).Options(options)
				ClearDuplicateLegacySessionCookie(c)
				c.Next()
			})
			newEngine.GET("/login", func(c *gin.Context) {
				session := sessions.Default(c)
				session.Set("id", 42)
				ClearLegacyHostOnlySessionCookie(c)
				require.NoError(t, session.Save())
				c.Status(http.StatusNoContent)
			})
			newEngine.GET("/self", func(c *gin.Context) {
				id, _ := sessions.Default(c).Get("id").(int)
				c.JSON(http.StatusOK, gin.H{"id": id})
			})

			performRequest := func(engine *gin.Engine, target *url.URL) *httptest.ResponseRecorder {
				request := httptest.NewRequest(http.MethodGet, target.String(), nil)
				request.Host = target.Host
				for _, requestCookie := range jar.Cookies(target) {
					request.AddCookie(requestCookie)
				}
				response := httptest.NewRecorder()
				engine.ServeHTTP(response, request)
				jar.SetCookies(target, response.Result().Cookies())
				return response
			}

			legacyURL := &url.URL{Scheme: "https", Host: host, Path: "/legacy-login"}
			legacyResponse := performRequest(legacyEngine, legacyURL)
			require.Equal(t, http.StatusNoContent, legacyResponse.Code)

			loginURL := &url.URL{Scheme: "https", Host: host, Path: "/login"}
			loginResponse := performRequest(newEngine, loginURL)
			require.Equal(t, http.StatusNoContent, loginResponse.Code)

			var sharedCookie, deletionCookie *http.Cookie
			for _, responseCookie := range loginResponse.Result().Cookies() {
				if responseCookie.Domain == "example.com" && responseCookie.Value != "" {
					sharedCookie = responseCookie
				} else if responseCookie.Domain == "" && responseCookie.MaxAge < 0 {
					deletionCookie = responseCookie
				}
			}
			require.NotNil(t, sharedCookie)
			require.NotNil(t, deletionCookie)
			responseCookies := loginResponse.Result().Cookies()
			require.NotEmpty(t, responseCookies)
			assert.Equal(t, "example.com", responseCookies[len(responseCookies)-1].Domain)
			assert.NotEmpty(t, responseCookies[len(responseCookies)-1].Value)

			selfURL := &url.URL{Scheme: "https", Host: host, Path: "/self"}
			selfResponse := performRequest(newEngine, selfURL)
			require.Equal(t, http.StatusOK, selfResponse.Code)
			assert.JSONEq(t, `{"id":42}`, selfResponse.Body.String())
		})
	}
}
