package passkey

import (
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	webauthn "github.com/go-webauthn/webauthn/webauthn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSaveSessionDataMigratesLegacyCookieBeforeSharedCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousSecure := common.SessionCookieSecure
	previousDomain := common.SessionCookieDomain
	t.Cleanup(func() {
		common.SessionCookieSecure = previousSecure
		common.SessionCookieDomain = previousDomain
	})
	common.SessionCookieSecure = true
	common.SessionCookieDomain = "example.com"

	for _, host := range []string{"example.com", "www.example.com"} {
		t.Run(host, func(t *testing.T) {
			jar, err := cookiejar.New(nil)
			require.NoError(t, err)

			engine := gin.New()
			store := cookie.NewStore([]byte("passkey-session-migration-test-secret"))
			store.Options(sessions.Options{
				Path:     "/",
				MaxAge:   2592000,
				HttpOnly: true,
				Secure:   true,
				SameSite: common.SessionCookieSameSite,
			})
			engine.Use(sessions.Sessions("session", store))
			engine.Use(func(c *gin.Context) {
				options := sessions.Options{
					Path:     "/",
					Domain:   common.SessionDomainForHost(c.Request.Host),
					MaxAge:   2592000,
					HttpOnly: true,
					Secure:   true,
					SameSite: common.SessionCookieSameSite,
				}
				sessions.Default(c).Options(options)
				c.Next()
			})
			engine.GET("/begin", func(c *gin.Context) {
				err := SaveSessionData(c, LoginSessionKey, &webauthn.SessionData{})
				require.NoError(t, err)
				c.Status(http.StatusNoContent)
			})
			engine.GET("/finish", func(c *gin.Context) {
				_, err := PopSessionData(c, LoginSessionKey)
				require.NoError(t, err)
				c.Status(http.StatusNoContent)
			})

			performRequest := func(target *url.URL) *httptest.ResponseRecorder {
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

			beginURL := &url.URL{Scheme: "https", Host: host, Path: "/begin"}
			jar.SetCookies(beginURL, []*http.Cookie{{
				Name:   "session",
				Value:  "legacy-host-only-session",
				Path:   "/",
				Secure: true,
			}})
			response := performRequest(beginURL)

			require.Equal(t, http.StatusNoContent, response.Code)
			responseCookies := response.Result().Cookies()
			require.Len(t, responseCookies, 2)
			assert.Empty(t, responseCookies[0].Domain)
			assert.Less(t, responseCookies[0].MaxAge, 0)
			assert.Equal(t, "example.com", responseCookies[1].Domain)
			assert.NotEmpty(t, responseCookies[1].Value)

			finishURL := &url.URL{Scheme: "https", Host: host, Path: "/finish"}
			finishResponse := performRequest(finishURL)
			require.Equal(t, http.StatusNoContent, finishResponse.Code)
		})
	}
}
