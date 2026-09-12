package controller

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const ssoTestSecret = "sso-test-secret-32-bytes-or-longer"

func ssoRequestToken(t *testing.T, request service.SSORequest) string {
	t.Helper()
	raw, err := common.Marshal(request)
	require.NoError(t, err)
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(ssoTestSecret))
	mac.Write([]byte("chatgpt2api-sso/v1/request/" + encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func ssoTestRequest(verifier, issuer string) service.SSORequest {
	digest := sha256.Sum256([]byte(verifier))
	return service.SSORequest{Issuer: issuer, Audience: "https://image.example.com", State: base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("s", 32))), Challenge: base64.RawURLEncoding.EncodeToString(digest[:]), ExpiresAt: time.Now().Add(5 * time.Minute).Unix()}
}

func TestChatGPT2APISSO(t *testing.T) {
	user, identity := setupSecurityEnrollmentTest(t)
	t.Setenv("CHATGPT2API_SSO_SECRET", ssoTestSecret)
	t.Setenv("CHATGPT2API_SSO_ORIGIN", "https://image.example.com")
	t.Setenv("NEWAPI_SSO_ORIGINS", "https://example.com,https://www.example.com")
	cfg, err := service.LoadChatGPT2APISSOConfig()
	require.NoError(t, err)
	verifier := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("v", 32)))
	for _, issuer := range cfg.Issuers {
		t.Run(issuer, func(t *testing.T) {
			request := ssoRequestToken(t, ssoTestRequest(verifier, issuer))
			target, err := cfg.Authorize(request, issuer, identity)
			require.NoError(t, err)
			callback, err := url.Parse(target)
			require.NoError(t, err)
			assert.Equal(t, cfg.Origin+"/auth/sso/callback", callback.Scheme+"://"+callback.Host+callback.Path)
			code := callback.Query().Get("code")
			require.NotEmpty(t, code)
			_, err = cfg.Exchange(code, base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("x", 32))), issuer)
			require.Error(t, err)
			_, err = cfg.Exchange(code, verifier, "https://attacker.example")
			require.Error(t, err)
			account, err := cfg.Exchange(code, verifier, issuer)
			require.NoError(t, err)
			assert.Equal(t, user.Id, account.ID)
			assert.Equal(t, user.Username, account.Username)
			require.NotEmpty(t, account.Reference)
			_, err = cfg.Exchange(code, verifier, issuer)
			require.Error(t, err, "code must be single-use")
			_, err = cfg.Validate(account.Reference, issuer)
			require.NoError(t, err)
			_, err = cfg.Validate(account.Reference+"x", issuer)
			require.Error(t, err)
			_, err = cfg.Validate(account.Reference, "https://attacker.example")
			require.Error(t, err)
			require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("status", common.UserStatusDisabled).Error)
			_, err = cfg.Validate(account.Reference, issuer)
			require.Error(t, err, "disabled account must be rejected without waiting for caches")
			require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("status", common.UserStatusEnabled).Error)
			require.NoError(t, model.DB.Model(&model.UserSession{}).Where("sid = ?", identity.SessionID).Update("version", identity.SessionVersion+1).Error)
			_, err = cfg.Validate(account.Reference, issuer)
			require.Error(t, err)
			require.NoError(t, model.DB.Model(&model.UserSession{}).Where("sid = ?", identity.SessionID).Update("version", identity.SessionVersion).Error)
			require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("auth_version", identity.UserAuthVersion+1).Error)
			_, err = cfg.Validate(account.Reference, issuer)
			require.Error(t, err)
			require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("auth_version", identity.UserAuthVersion).Error)
		})
	}
	t.Run("invalid authorization requests", func(t *testing.T) {
		valid := ssoTestRequest(verifier, cfg.Issuers[0])
		cases := []struct {
			name   string
			change func(*service.SSORequest)
		}{
			{"expired", func(r *service.SSORequest) { r.ExpiresAt = time.Now().Add(-time.Second).Unix() }},
			{"excessive lifetime", func(r *service.SSORequest) { r.ExpiresAt = time.Now().Add(time.Hour).Unix() }},
			{"audience", func(r *service.SSORequest) { r.Audience = "https://attacker.example" }},
			{"issuer", func(r *service.SSORequest) { r.Issuer = "https://attacker.example" }},
			{"state", func(r *service.SSORequest) { r.State = "" }},
			{"challenge", func(r *service.SSORequest) { r.Challenge = "plain" }},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				request := valid
				tc.change(&request)
				_, err := cfg.Authorize(ssoRequestToken(t, request), cfg.Issuers[0], identity)
				require.Error(t, err)
			})
		}
		_, err := cfg.Authorize(ssoRequestToken(t, valid)+"x", cfg.Issuers[0], identity)
		require.Error(t, err)
		_, err = cfg.Authorize(ssoRequestToken(t, valid), cfg.Issuers[0], service.AuthIdentity{UserID: user.Id})
		require.Error(t, err, "incomplete MFA/PAT identity cannot authorize")
	})
	t.Run("expiry and concurrent replay", func(t *testing.T) {
		request := ssoRequestToken(t, ssoTestRequest(verifier, cfg.Issuers[0]))
		target, err := cfg.Authorize(request, cfg.Issuers[0], identity)
		require.NoError(t, err)
		callback, err := url.Parse(target)
		require.NoError(t, err)
		code := callback.Query().Get("code")
		flow, err := model.GetAuthFlow(code, model.AuthFlowMatch{Purpose: model.AuthFlowPurposeChatGPT2APISSO})
		require.NoError(t, err)
		assert.InDelta(t, 60, time.Until(flow.ExpiresAt).Seconds(), 2)
		require.NoError(t, model.DB.Model(flow).Update("expires_at", time.Now().Add(-time.Second)).Error)
		_, err = cfg.Exchange(code, verifier, cfg.Issuers[0])
		require.Error(t, err)
		target, err = cfg.Authorize(request, cfg.Issuers[0], identity)
		require.NoError(t, err)
		callback, err = url.Parse(target)
		require.NoError(t, err)
		code = callback.Query().Get("code")
		results := make(chan error, 2)
		var workers sync.WaitGroup
		for range 2 {
			workers.Go(func() { _, err := cfg.Exchange(code, verifier, cfg.Issuers[0]); results <- err })
		}
		workers.Wait()
		close(results)
		success := 0
		for err := range results {
			if err == nil {
				success++
			}
		}
		assert.Equal(t, 1, success)
	})
	t.Run("controller rejects missing credentials and masks secrets", func(t *testing.T) {
		router := gin.New()
		router.POST("/authorize", middleware.UserAuth(), AuthorizeChatGPT2APISSO)
		router.POST("/exchange", ExchangeChatGPT2APISSO)
		for _, path := range []string{"/authorize", "/exchange"} {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"code":"usable-code","verifier":"secret-verifier"}`))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(response, request)
			assert.Equal(t, http.StatusUnauthorized, response.Code)
			assert.NotContains(t, response.Body.String(), "usable-code")
			assert.NotContains(t, response.Body.String(), "secret-verifier")
		}
	})
	t.Run("revocation between authorization and exchange", func(t *testing.T) {
		target, err := cfg.Authorize(ssoRequestToken(t, ssoTestRequest(verifier, cfg.Issuers[0])), cfg.Issuers[0], identity)
		require.NoError(t, err)
		callback, err := url.Parse(target)
		require.NoError(t, err)
		_, err = model.RevokeUserSession(user.Id, identity.SessionID, "logout")
		require.NoError(t, err)
		_, err = cfg.Exchange(callback.Query().Get("code"), verifier, cfg.Issuers[0])
		require.Error(t, err)
	})
}

func TestChatGPT2APISSOConfig(t *testing.T) {
	for _, tc := range []struct{ name, secret, origin, issuers string }{
		{"disabled", "", "", ""}, {"weak secret", "short", "https://image.example.com", "https://example.com"},
		{"http", ssoTestSecret, "http://image.example.com", "https://example.com"},
		{"credentials", ssoTestSecret, "https://user@image.example.com", "https://example.com"},
		{"issuer path", ssoTestSecret, "https://image.example.com", "https://example.com/path"},
		{"same origin", ssoTestSecret, "https://example.com", "https://example.com"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CHATGPT2API_SSO_SECRET", tc.secret)
			t.Setenv("CHATGPT2API_SSO_ORIGIN", tc.origin)
			t.Setenv("NEWAPI_SSO_ORIGINS", tc.issuers)
			_, err := service.LoadChatGPT2APISSOConfig()
			require.Error(t, err)
		})
	}
}
