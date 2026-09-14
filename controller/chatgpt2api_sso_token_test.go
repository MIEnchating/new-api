package controller

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupSSOTokenTest(t *testing.T) (*model.User, service.AuthIdentity, service.ChatGPT2APISSOConfig, string) {
	t.Helper()
	user, identity := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Token{}))
	oldGroups, oldRatios := setting.UserUsableGroups2JSONString(), ratio_setting.GroupRatio2JSONString()
	oldMax := operation_setting.GetMaxUserTokens()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","vip":"VIP","removed":"Removed"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"vip":1,"private":1}`))
	operation_setting.GetTokenSetting().MaxUserTokens = 100
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(oldGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldRatios))
		operation_setting.GetTokenSetting().MaxUserTokens = oldMax
	})
	t.Setenv("CHATGPT2API_SSO_SECRET", ssoTestSecret)
	t.Setenv("CHATGPT2API_SSO_ORIGIN", "https://image.example.com")
	t.Setenv("NEWAPI_SSO_ORIGINS", "https://example.com")
	cfg, err := service.LoadChatGPT2APISSOConfig()
	require.NoError(t, err)
	verifier := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("v", 32)))
	target, err := cfg.Authorize(ssoRequestToken(t, ssoTestRequest(verifier, cfg.Issuers[0])), cfg.Issuers[0], identity)
	require.NoError(t, err)
	callback, err := url.Parse(target)
	require.NoError(t, err)
	account, err := cfg.Exchange(callback.Query().Get("code"), verifier, cfg.Issuers[0])
	require.NoError(t, err)
	return user, identity, cfg, account.Reference
}

func ssoTokenRequest(t *testing.T, secret, reference, issuer, group, name string) (*httptest.ResponseRecorder, service.SSOToken) {
	t.Helper()
	body, err := common.Marshal(map[string]any{
		"reference": reference, "issuer": issuer, "group": group, "name": name,
		"user_id": 999, "unlimited_quota": false, "remain_quota": -1,
	})
	require.NoError(t, err)
	request := httptest.NewRequest(http.MethodPost, "/api/sso/chatgpt2api/tokens", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if secret != "" {
		request.Header.Set("Authorization", "Bearer "+secret)
	}
	response := httptest.NewRecorder()
	router := gin.New()
	router.POST("/api/sso/chatgpt2api/tokens", EnsureChatGPT2APISSOToken)
	router.ServeHTTP(response, request)
	var envelope struct {
		Data service.SSOToken `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &envelope))
	return response, envelope.Data
}

func TestChatGPT2APISSOTokenCreationAndReuse(t *testing.T) {
	user, _, cfg, reference := setupSSOTokenTest(t)
	response, token := ssoTokenRequest(t, cfg.Secret, reference, cfg.Issuers[0], "default", "image-default")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	assert.Equal(t, user.Id, token.UserID)
	assert.True(t, token.Created)
	assert.Equal(t, "default", token.Group)
	stored, err := model.GetTokenByIds(token.ID, user.Id)
	require.NoError(t, err)
	assert.NotEmpty(t, stored.Key)
	assert.True(t, stored.UnlimitedQuota)
	assert.EqualValues(t, -1, stored.ExpiredTime)
	assert.Equal(t, common.TokenStatusEnabled, stored.Status)
	assert.Equal(t, "default", stored.Group)
	assert.NotContains(t, response.Body.String(), stored.Key)
	response, reused := ssoTokenRequest(t, cfg.Secret, reference, cfg.Issuers[0], "default", "another-name")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	assert.Equal(t, token.ID, reused.ID)
	assert.Equal(t, "image-default", reused.Name)
	assert.False(t, reused.Created)
	count, err := model.CountUserTokens(user.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 1, count)
	var logs []model.AuditLog
	require.NoError(t, model.LOG_DB.Where("action = ?", "user.sso_token_provision").Find(&logs).Error)
	require.Len(t, logs, 2)
	for _, entry := range logs {
		assert.Equal(t, common.RoleCommonUser, entry.ActorRole)
		assert.Equal(t, user.Id, entry.UserId)
	}
	encoded, err := common.Marshal(logs)
	require.NoError(t, err)
	for _, secret := range []string{stored.Key, cfg.Secret, reference} {
		assert.NotContains(t, string(encoded), secret)
	}
}

func TestChatGPT2APISSOTokenAuthorization(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*testing.T, *model.User, service.AuthIdentity, *service.ChatGPT2APISSOConfig, *string)
	}{
		{"missing backend credential", func(_ *testing.T, _ *model.User, _ service.AuthIdentity, cfg *service.ChatGPT2APISSOConfig, _ *string) {
			cfg.Secret = ""
		}},
		{"wrong backend credential", func(_ *testing.T, _ *model.User, _ service.AuthIdentity, cfg *service.ChatGPT2APISSOConfig, _ *string) {
			cfg.Secret = "wrong-credential"
		}},
		{"tampered reference", func(_ *testing.T, _ *model.User, _ service.AuthIdentity, _ *service.ChatGPT2APISSOConfig, ref *string) {
			*ref += "x"
		}},
		{"wrong issuer", func(_ *testing.T, _ *model.User, _ service.AuthIdentity, cfg *service.ChatGPT2APISSOConfig, _ *string) {
			cfg.Issuers = []string{"https://attacker.example"}
		}},
		{"revoked session", func(t *testing.T, user *model.User, identity service.AuthIdentity, _ *service.ChatGPT2APISSOConfig, _ *string) {
			_, err := model.RevokeUserSession(user.Id, identity.SessionID, "logout")
			require.NoError(t, err)
		}},
		{"expired session", func(t *testing.T, _ *model.User, identity service.AuthIdentity, _ *service.ChatGPT2APISSOConfig, _ *string) {
			require.NoError(t, model.DB.Model(&model.UserSession{}).Where("sid = ?", identity.SessionID).Update("expires_at", time.Now().Unix()-1).Error)
		}},
		{"disabled user", func(t *testing.T, user *model.User, _ service.AuthIdentity, _ *service.ChatGPT2APISSOConfig, _ *string) {
			require.NoError(t, model.DB.Model(user).Update("status", common.UserStatusDisabled).Error)
		}},
		{"changed authentication version", func(t *testing.T, user *model.User, _ service.AuthIdentity, _ *service.ChatGPT2APISSOConfig, _ *string) {
			require.NoError(t, model.DB.Model(user).Update("auth_version", user.AuthVersion+1).Error)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user, identity, cfg, reference := setupSSOTokenTest(t)
			tc.change(t, user, identity, &cfg, &reference)
			response, _ := ssoTokenRequest(t, cfg.Secret, reference, cfg.Issuers[0], "default", "image-default")
			assert.Equal(t, http.StatusUnauthorized, response.Code, response.Body.String())
			assert.Contains(t, response.Body.String(), `"code":"sso_invalid"`)
			assert.NotContains(t, response.Body.String(), reference)
			count, err := model.CountUserTokens(user.Id)
			require.NoError(t, err)
			assert.Zero(t, count)
		})
	}
}

func TestChatGPT2APISSOTokenGroupValidation(t *testing.T) {
	_, _, cfg, reference := setupSSOTokenTest(t)
	for _, tc := range []struct {
		group, name, code string
		status            int
	}{
		{"", "image-default", "invalid_token_request", http.StatusBadRequest},
		{"auto", "image-default", "invalid_token_request", http.StatusBadRequest},
		{"default", "", "invalid_token_request", http.StatusBadRequest},
		{"default", strings.Repeat("a", 51), "invalid_token_request", http.StatusBadRequest},
		{"private", "image-private", "token_group_forbidden", http.StatusForbidden},
		{"removed", "image-removed", "token_group_forbidden", http.StatusForbidden},
	} {
		t.Run(tc.group+tc.code+tc.name, func(t *testing.T) {
			response, _ := ssoTokenRequest(t, cfg.Secret, reference, cfg.Issuers[0], tc.group, tc.name)
			assert.Equal(t, tc.status, response.Code, response.Body.String())
			assert.Contains(t, response.Body.String(), `"code":"`+tc.code+`"`)
		})
	}
}

func TestChatGPT2APISSOTokenExistingCandidates(t *testing.T) {
	for _, tc := range []struct {
		name    string
		change  func(*model.Token)
		created bool
	}{
		{"explicit group", func(token *model.Token) { token.Group = "default" }, false},
		{"inherited group", func(token *model.Token) { token.Group = "" }, false},
		{"single route", func(token *model.Token) {
			token.GroupRouteConfig = `[{"group":"default","priority":1,"cooldown_seconds":60}]`
		}, false},
		{"disabled", func(token *model.Token) { token.Status = common.TokenStatusDisabled }, true},
		{"expired", func(token *model.Token) { token.ExpiredTime = time.Now().Unix() - 1 }, true},
		{"exhausted", func(token *model.Token) { token.UnlimitedQuota = false }, true},
		{"different group", func(token *model.Token) { token.Group = "vip" }, true},
		{"auto group", func(token *model.Token) { token.Group = "auto" }, true},
		{"multiple routes", func(token *model.Token) {
			token.GroupRouteConfig = `[{"group":"default","priority":1,"cooldown_seconds":60},{"group":"vip","priority":0,"cooldown_seconds":60}]`
		}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user, _, cfg, reference := setupSSOTokenTest(t)
			existing := &model.Token{UserId: user.Id, Key: "existing-private-key", Name: "existing", Group: "default", Status: common.TokenStatusEnabled, UnlimitedQuota: true, ExpiredTime: -1}
			tc.change(existing)
			require.NoError(t, existing.Insert())
			response, token := ssoTokenRequest(t, cfg.Secret, reference, cfg.Issuers[0], "default", "image-default")
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			assert.Equal(t, tc.created, token.Created)
			assert.Equal(t, "default", token.Group)
			if !tc.created {
				assert.Equal(t, existing.Id, token.ID)
			}
		})
	}
}

func TestChatGPT2APISSOTokenConflictsAndLimit(t *testing.T) {
	user, _, cfg, reference := setupSSOTokenTest(t)
	conflict := &model.Token{UserId: user.Id, Key: "conflicting-private-key", Name: "image-default", Group: "vip", Status: common.TokenStatusEnabled, UnlimitedQuota: true, ExpiredTime: -1}
	require.NoError(t, conflict.Insert())
	response, _ := ssoTokenRequest(t, cfg.Secret, reference, cfg.Issuers[0], "default", "image-default")
	assert.Equal(t, http.StatusConflict, response.Code)
	assert.Contains(t, response.Body.String(), `"code":"token_name_conflict"`)
	operation_setting.GetTokenSetting().MaxUserTokens = 1
	response, _ = ssoTokenRequest(t, cfg.Secret, reference, cfg.Issuers[0], "default", "new-name")
	assert.Equal(t, http.StatusConflict, response.Code)
	assert.Contains(t, response.Body.String(), `"code":"token_limit_reached"`)
	response, token := ssoTokenRequest(t, cfg.Secret, reference, cfg.Issuers[0], "vip", "new-name")
	assert.Equal(t, http.StatusOK, response.Code)
	assert.False(t, token.Created, "existing tokens remain usable at the token limit")
}

func TestChatGPT2APISSOTokenConcurrentCreation(t *testing.T) {
	user, _, cfg, reference := setupSSOTokenTest(t)
	const workers = 8
	results := make(chan *service.SSOToken, workers)
	errors := make(chan error, workers)
	start := make(chan struct{})
	var group sync.WaitGroup
	for range workers {
		group.Go(func() {
			<-start
			token, err := cfg.EnsureToken(reference, cfg.Issuers[0], "default", "image-default")
			results <- token
			errors <- err
		})
	}
	close(start)
	group.Wait()
	close(results)
	close(errors)
	for err := range errors {
		require.NoError(t, err)
	}
	created, tokenID := 0, 0
	for token := range results {
		require.NotNil(t, token)
		if token.Created {
			created++
		}
		if tokenID == 0 {
			tokenID = token.ID
		}
		assert.Equal(t, tokenID, token.ID)
	}
	assert.Equal(t, 1, created)
	count, err := model.CountUserTokens(user.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 1, count)
}
