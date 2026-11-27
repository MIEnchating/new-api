package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/qqbot"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQQBotSettingsSaveAndApply(t *testing.T) {
	user, ordinaryIdentity := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.SystemTask{}))
	operation := service.VerificationOperation{Scope: service.VerificationScopeQQBotSettings}
	_, err := service.GetVerificationRequirements(ordinaryIdentity, operation.Scope)
	require.ErrorIs(t, err, service.ErrVerificationForbidden)
	require.NoError(t, model.DB.Model(user).Update("role", common.RoleRootUser).Error)
	require.NoError(t, model.PublishUserAuthCache(user.Id))
	bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "qq-bot-settings-test")
	require.NoError(t, err)
	identity, err := service.ParseAccessToken(bundle.AccessToken)
	require.NoError(t, err)
	methods, err := service.GetVerificationRequirements(identity, operation.Scope)
	require.NoError(t, err)
	require.NotEmpty(t, methods.Methods)

	t.Setenv("SESSION_SECRET", "test-explicit-session-secret")
	t.Setenv("QQ_BOT_ENABLED", "false")
	t.Setenv("QQ_BOT_APP_ID", "")
	t.Setenv("QQ_BOT_APP_SECRET", "")
	t.Setenv("QQ_BOT_APP_SECRET_FILE", "")
	t.Setenv("QQ_BOT_GROUP_OPENIDS", "")
	t.Setenv("QQ_BOT_SITE_URL", "")
	t.Setenv("QQ_BOT_CHAT_MODEL", "")
	t.Setenv("QQ_BOT_CHAT_API_KEY", "")
	t.Setenv("QQ_BOT_CHAT_API_KEY_FILE", "")
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = make(map[string]string)
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})

	runtime := qqbot.NewRuntime("", "3001", nil, model.CachedQQBotSettings)
	t.Cleanup(runtime.Close)
	settings := QQBotSettings{Runtime: runtime}
	engine := gin.New()
	engine.GET("/settings", middleware.RootAuth(), middleware.DisableCache(), settings.Get)
	engine.GET("/settings/chat-options", middleware.RootAuth(), settings.ChatOptions)
	engine.GET("/settings/discovered-groups", middleware.RootAuth(), middleware.DisableCache(), settings.DiscoveredGroups)
	engine.POST("/settings/external-models", middleware.RootAuth(), settings.ExternalModels)
	engine.PUT("/settings", middleware.RootAuth(), middleware.DisableCache(), settings.Update)
	engine.POST(qqbot.WebhookPath, gin.WrapH(runtime))

	request := func(method, path, proof string, body any) *httptest.ResponseRecorder {
		var payload []byte
		if body != nil {
			payload, err = common.Marshal(body)
			require.NoError(t, err)
		}
		req := httptest.NewRequest(method, path, strings.NewReader(string(payload)))
		req.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
		req.Header.Set("New-Api-User", strconv.Itoa(user.Id))
		req.Header.Set("X-Security-Proof", proof)
		req.Header.Set("X-Bot-Appid", "123456")
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		engine.ServeHTTP(res, req)
		return res
	}
	var result struct {
		Success bool                 `json:"success"`
		Data    qqbot.PublicSettings `json:"data"`
	}
	got := request(http.MethodGet, "/settings", "", nil)
	require.Equal(t, http.StatusOK, got.Code, got.Body.String())
	assert.Contains(t, got.Header().Get("Cache-Control"), "no-store")
	require.NoError(t, common.Unmarshal(got.Body.Bytes(), &result))
	require.True(t, result.Success)
	assert.False(t, result.Data.Enabled)
	assert.Equal(t, qqbot.WebhookPath, result.Data.CallbackPath)

	discoveryRequest := httptest.NewRecorder()
	engine.ServeHTTP(discoveryRequest, httptest.NewRequest(http.MethodGet, "/settings/discovered-groups", nil))
	assert.Equal(t, http.StatusUnauthorized, discoveryRequest.Code)
	got = request(http.MethodGet, "/settings/discovered-groups", "", nil)
	require.Equal(t, http.StatusOK, got.Code, got.Body.String())
	assert.Contains(t, got.Header().Get("Cache-Control"), "no-store")
	assert.Contains(t, got.Body.String(), `"data":[]`)

	anonymous := httptest.NewRecorder()
	engine.ServeHTTP(anonymous, httptest.NewRequest(http.MethodPost, "/settings/external-models", nil))
	assert.Equal(t, http.StatusUnauthorized, anonymous.Code)
	got = request(http.MethodPost, "/settings/external-models", "", qqbot.ExternalModelsInput{
		ChatBaseURL: "https://127.0.0.1:3001/v1", ChatProtocol: qqbot.ChatProtocolCompletions, ChatKey: "preview-provider-key",
	})
	assert.Equal(t, http.StatusBadRequest, got.Code)
	assert.Contains(t, got.Body.String(), "public HTTPS")
	assert.NotContains(t, got.Body.String(), "preview-provider-key")

	input := qqbot.SettingsUpdate{
		PublicSettingsFields: qqbot.PublicSettingsFields{Enabled: true, AppID: "123456", Groups: "group-1"},
		Revision:             result.Data.Revision, AppSecret: "qq-secret-a349c3-test",
	}
	got = request(http.MethodPut, "/settings", "", input)
	require.Equal(t, http.StatusForbidden, got.Code)
	assert.Contains(t, got.Body.String(), "SECURITY_PROOF_REQUIRED")
	assert.Empty(t, model.CachedQQBotSettings())

	proof := issueSecurityEnrollmentProof(t, identity, operation, service.VerificationMethodPassword)
	got = request(http.MethodPut, "/settings", proof, input)
	require.Equal(t, http.StatusOK, got.Code, got.Body.String())
	assert.NotContains(t, got.Body.String(), input.AppSecret)
	require.NoError(t, common.Unmarshal(got.Body.Bytes(), &result))
	assert.True(t, result.Data.Enabled)
	assert.True(t, result.Data.AppSecretConfigured)
	assert.NotEqual(t, input.Revision, result.Data.Revision)
	var option model.Option
	require.NoError(t, model.DB.Where(&model.Option{Key: model.QQBotSettingsOptionKey}).Take(&option).Error)
	require.NotEmpty(t, option.Value)
	assert.NotContains(t, option.Value, input.AppSecret)
	assert.NotContains(t, option.Value, input.Groups)
	require.ErrorIs(t, model.SaveQQBotSettings(context.Background(), "", "parallel-update"), model.ErrQQBotSettingsChanged)
	require.Error(t, model.UpdateOption(model.QQBotSettingsOptionKey, "general-settings-update"))

	challenge := map[string]any{"op": 13, "d": map[string]string{
		"plain_token": "qq_settings_test", "event_ts": strconv.FormatInt(time.Now().Unix(), 10),
	}}
	got = request(http.MethodPost, qqbot.WebhookPath, "", challenge)
	require.Equal(t, http.StatusOK, got.Code)
	assert.Contains(t, got.Body.String(), "signature")

	stale := input
	proof2 := issueSecurityEnrollmentProof(t, identity, operation, service.VerificationMethodPassword)
	got = request(http.MethodPut, "/settings", proof2, stale)
	assert.Equal(t, http.StatusConflict, got.Code)
	input.Revision = result.Data.Revision
	input.AppSecret = ""
	input.Enabled = false
	got = request(http.MethodPut, "/settings", proof, input)
	require.Equal(t, http.StatusForbidden, got.Code)
	assert.Contains(t, got.Body.String(), "SECURITY_PROOF_CONSUMED")
	got = request(http.MethodPut, "/settings", proof2, input)
	require.Equal(t, http.StatusOK, got.Code, got.Body.String())
	require.NoError(t, common.Unmarshal(got.Body.Bytes(), &result))
	assert.True(t, result.Data.AppSecretConfigured)
	assert.False(t, result.Data.Enabled)
	assert.Equal(t, http.StatusNotFound, request(http.MethodPost, qqbot.WebhookPath, "", challenge).Code)

	input.Revision = result.Data.Revision
	wrongScope := issueSecurityEnrollmentProof(t, identity,
		service.VerificationOperation{Scope: service.VerificationScopeTwoFASetup}, service.VerificationMethodPassword)
	got = request(http.MethodPut, "/settings", wrongScope, input)
	require.Equal(t, http.StatusForbidden, got.Code)
	assert.Contains(t, got.Body.String(), "SECURITY_PROOF_SCOPE_MISMATCH")
	expired := issueSecurityEnrollmentProof(t, identity, operation, service.VerificationMethodPassword)
	require.NoError(t, model.DB.Model(&model.AuthFlow{}).
		Where("purpose = ? AND session_id = ? AND consumed_at IS NULL", model.AuthFlowPurposeSecurityProof, identity.SessionID).
		Update("expires_at", time.Now().Add(-time.Minute)).Error)
	got = request(http.MethodPut, "/settings", expired, input)
	require.Equal(t, http.StatusForbidden, got.Code)
	assert.Contains(t, got.Body.String(), "SECURITY_PROOF_EXPIRED")

	previousGroups := setting.UserUsableGroups2JSONString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","vip":"VIP"}`))
	t.Cleanup(func() { require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousGroups)) })
	previousCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() { common.MemoryCacheEnabled = previousCache })
	require.NoError(t, model.DB.AutoMigrate(&model.Token{}, &model.Ability{}, &model.Channel{}))
	key := model.Token{
		UserId: user.Id, Key: "qbotfixtureinternalkey", Name: "Bot key",
		Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true,
		GroupRouteConfig:   `[{"group":"default","priority":2,"cooldown_seconds":1},{"group":"vip","priority":1,"cooldown_seconds":1}]`,
		ModelLimitsEnabled: true, ModelLimits: "available-text",
	}
	otherKey := model.Token{UserId: user.Id + 1000, Key: "qbotfixtureotherkey", Status: common.TokenStatusEnabled, ExpiredTime: -1}
	require.NoError(t, model.DB.Create(&key).Error)
	require.NoError(t, model.DB.Create(&otherKey).Error)
	channel := model.Channel{Type: constant.ChannelTypeOpenAI, Key: "fixture", Name: "Fixture", Status: common.ChannelStatusEnabled}
	require.NoError(t, model.DB.Create(&channel).Error)
	require.NoError(t, model.DB.Create([]model.Ability{
		{Group: "vip", Model: "available-text", ChannelId: channel.Id, Enabled: true},
		{Group: "vip", Model: "excluded-text", ChannelId: channel.Id, Enabled: true},
	}).Error)

	optionPath := "/settings/chat-options?protocol=chat_completions&group=vip&token_id="
	got = request(http.MethodGet, optionPath+strconv.Itoa(key.Id), "", nil)
	require.Equal(t, http.StatusOK, got.Code, got.Body.String())
	assert.Contains(t, got.Body.String(), "available-text")
	assert.NotContains(t, got.Body.String(), "excluded-text")
	assert.NotContains(t, got.Body.String(), key.Key)
	assert.Equal(t, http.StatusBadRequest, request(http.MethodGet, optionPath+strconv.Itoa(otherKey.Id), "", nil).Code)
	assert.NotContains(t, request(http.MethodGet, strings.Replace(optionPath, "group=vip", "group=outside", 1)+strconv.Itoa(key.Id), "", nil).Body.String(), "available-text")

	input.ChatSource, input.ChatProtocol = qqbot.ChatSourceBuiltin, qqbot.ChatProtocolCompletions
	input.ChatTokenID, input.ChatGroup, input.ChatModel = key.Id, "vip", "excluded-text"
	proof3 := issueSecurityEnrollmentProof(t, identity, operation, service.VerificationMethodPassword)
	assert.Equal(t, http.StatusBadRequest, request(http.MethodPut, "/settings", proof3, input).Code)
	input.ChatModel = "available-text"
	got = request(http.MethodPut, "/settings", proof3, input)
	require.Equal(t, http.StatusOK, got.Code, got.Body.String())
	require.NoError(t, common.Unmarshal(got.Body.Bytes(), &result))
	assert.Equal(t, key.Id, result.Data.ChatTokenID)
	assert.Equal(t, "vip", result.Data.ChatGroup)
	assert.NotContains(t, got.Body.String(), key.Key)

	engine.POST("/v1/chat/completions", middleware.TokenAuth(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"group": common.GetContextKeyString(c, constant.ContextKeyUsingGroup)})
	})
	for _, group := range []string{"", "vip", "outside"} {
		req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
		req.Header.Set("Authorization", "Bearer "+key.Key)
		req.Header.Set("X-QQ-Bot-Group", "vip")
		if group != "" {
			req = req.WithContext(middleware.WithQQBotTokenGroup(req.Context(), key.Id, group))
		}
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, req)
		switch group {
		case "":
			assert.JSONEq(t, `{"group":"default"}`, rec.Body.String())
		case "vip":
			assert.JSONEq(t, `{"group":"vip"}`, rec.Body.String())
		case "outside":
			assert.Equal(t, http.StatusForbidden, rec.Code)
		}
	}

	input.Revision = result.Data.Revision
	input.ChatSource, input.ChatBaseURL, input.ChatKey = qqbot.ChatSourceExternal, "https://provider.example/v1", "external-test-key"
	proof4 := issueSecurityEnrollmentProof(t, identity, operation, service.VerificationMethodPassword)
	got = request(http.MethodPut, "/settings", proof4, input)
	require.Equal(t, http.StatusOK, got.Code, got.Body.String())
	require.NoError(t, common.Unmarshal(got.Body.Bytes(), &result))
	assert.True(t, result.Data.ChatKeyConfigured)
	assert.Zero(t, result.Data.ChatTokenID)
	assert.Empty(t, result.Data.ChatGroup)
	assert.NotContains(t, got.Body.String(), input.ChatKey)

	changed, before, after := model.UpdateChannelStatusWithTransition(channel.Id, "", common.ChannelStatusAutoDisabled, "fixture outage")
	assert.True(t, changed)
	assert.Equal(t, common.ChannelStatusEnabled, before)
	assert.Equal(t, common.ChannelStatusAutoDisabled, after)
	changed, _, _ = model.UpdateChannelStatusWithTransition(channel.Id, "", common.ChannelStatusAutoDisabled, "fixture outage")
	assert.False(t, changed)
	changed, before, after = model.UpdateChannelStatusWithTransition(channel.Id, "", common.ChannelStatusEnabled, "")
	assert.True(t, changed)
	assert.Equal(t, common.ChannelStatusAutoDisabled, before)
	assert.Equal(t, common.ChannelStatusEnabled, after)
	input.Revision, input.ChatBaseURL, input.ChatKey = result.Data.Revision, "https://another.example/v1", ""
	assert.Equal(t, http.StatusBadRequest, request(http.MethodPut, "/settings", "", input).Code)
	input.ChatBaseURL, input.ChatKey = "https://169.254.169.254/v1", "replacement"
	assert.Equal(t, http.StatusBadRequest, request(http.MethodPut, "/settings", "", input).Code)

	var audit []model.AuditLog
	require.NoError(t, model.LOG_DB.Find(&audit).Error)
	auditBytes, err := common.Marshal(audit)
	require.NoError(t, err)
	assert.NotContains(t, string(auditBytes), stale.AppSecret)
	assert.NotContains(t, string(auditBytes), proof2)
}

func TestQQBotBindingRequiresSessionProofAndSingleUse(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}))
	user.Email = "qq-binding@example.com"
	require.NoError(t, model.DB.Model(user).Update("email", user.Email).Error)
	t.Setenv("QQ_BOT_ENABLED", "true")
	t.Setenv("QQ_BOT_APP_ID", "123456")
	t.Setenv("QQ_BOT_APP_SECRET", "fixture-secret")
	t.Setenv("QQ_BOT_APP_SECRET_FILE", "")
	t.Setenv("QQ_BOT_CHAT_MODEL", "")
	t.Setenv("QQ_BOT_CHAT_API_KEY", "")
	t.Setenv("QQ_BOT_CHAT_API_KEY_FILE", "")
	t.Setenv("QQ_BOT_GROUP_OPENIDS", "allowed")
	t.Setenv("QQ_BOT_SITE_URL", "")
	bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "qq-bot-binding-test")
	require.NoError(t, err)
	identity, err := service.ParseAccessToken(bundle.AccessToken)
	require.NoError(t, err)

	runtime := qqbot.NewRuntime("", "3001", nil, func() string { return "" })
	t.Cleanup(runtime.Close)
	handler := QQBotBinding{Runtime: runtime}
	router := gin.New()
	group := router.Group("/qqbot", middleware.UserAuth(), middleware.DisableCache())
	group.GET("", handler.Get)
	group.POST("", handler.Bind)
	group.DELETE("", handler.Unbind)
	request := func(method, code, proof string, authenticated bool) *httptest.ResponseRecorder {
		raw, err := common.Marshal(map[string]string{"code": code})
		require.NoError(t, err)
		req := httptest.NewRequest(method, "/qqbot", strings.NewReader(string(raw)))
		if authenticated {
			req.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
			req.Header.Set("New-Api-User", strconv.Itoa(user.Id))
		}
		req.Header.Set("X-Security-Proof", proof)
		result := httptest.NewRecorder()
		router.ServeHTTP(result, req)
		return result
	}
	bindProof := func(code string) string {
		ctx, err := common.Marshal(service.AccountBindingContext{Provider: model.QQBotIdentityProvider, Code: code})
		require.NoError(t, err)
		return issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopeAccountBind, Context: ctx}, service.VerificationMethodPassword)
	}
	code, err := model.CreateQQBotBindingCode("123456", "private-openid")
	require.NoError(t, err)
	other, err := model.CreateQQBotBindingCode("123456", "another-openid")
	require.NoError(t, err)
	wrongBot, err := model.CreateQQBotBindingCode("other-app", "private-openid")
	require.NoError(t, err)
	assert.Equal(t, http.StatusUnauthorized, request(http.MethodPost, code, "", false).Code)
	assert.Contains(t, request(http.MethodGet, "", "", true).Body.String(), `"bound":false`)
	assert.Contains(t, request(http.MethodPost, code, "", true).Body.String(), "SECURITY_PROOF_REQUIRED")
	assert.Contains(t, request(http.MethodPost, code, bindProof(other), true).Body.String(), "SECURITY_PROOF_CONTEXT_MISMATCH")
	assert.Contains(t, request(http.MethodPost, wrongBot, bindProof(wrongBot), true).Body.String(), "AUTH_FLOW_INVALID")

	response := request(http.MethodPost, code, bindProof(code), true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	assert.Contains(t, response.Body.String(), `"bound":true`)
	assert.NotContains(t, response.Body.String(), code)
	assert.Contains(t, request(http.MethodGet, "", "", true).Body.String(), `"bound":true`)
	owner, err := model.GetQQBotUser("123456", "private-openid")
	require.NoError(t, err)
	assert.Equal(t, user.Id, owner.Id)
	_, err = model.GetQQBotUser("other-app", "private-openid")
	require.Error(t, err)
	assert.Contains(t, request(http.MethodPost, other, bindProof(other), true).Body.String(), "ACCOUNT_ALREADY_BOUND")
	assert.Contains(t, request(http.MethodPost, code, bindProof(code), true).Body.String(), "AUTH_FLOW_INVALID")

	groupCode, err := model.CreateQQBotGroupBindingCode("123456", "allowed", "group-member", user)
	require.NoError(t, err)
	assert.Contains(t, request(http.MethodPost, groupCode, "", true).Body.String(), "SECURITY_PROOF_REQUIRED")
	assert.Contains(t, request(http.MethodPost, groupCode, bindProof(groupCode), true).Body.String(), `"bound":true`)
	groupOwner, err := model.GetQQBotGroupUser("123456", "allowed", "group-member")
	require.NoError(t, err)
	assert.Equal(t, user.Id, groupOwner.Id)
	assert.Contains(t, request(http.MethodPost, groupCode, bindProof(groupCode), true).Body.String(), "AUTH_FLOW_INVALID")

	assert.Contains(t, request(http.MethodDelete, "", "", true).Body.String(), "SECURITY_PROOF_REQUIRED")
	unbindProof := issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopeQQBotUnbind}, service.VerificationMethodPassword)
	assert.Contains(t, request(http.MethodDelete, "", unbindProof, true).Body.String(), `"bound":false`)
	_, err = model.GetQQBotUser("123456", "private-openid")
	require.Error(t, err)
	_, err = model.GetQQBotGroupUser("123456", "allowed", "group-member")
	require.Error(t, err)
	require.NoError(t, model.DB.Model(&model.AuthFlow{}).Where("purpose = ? AND consumed_at IS NULL", "qq_bot_bind").
		Update("expires_at", time.Now().Add(-time.Minute)).Error)
	assert.Contains(t, request(http.MethodPost, other, bindProof(other), true).Body.String(), "AUTH_FLOW_INVALID")
	require.NoError(t, model.ClaimQQBotAccountAction("123456", "private-openid", "event-id"))
	require.Error(t, model.ClaimQQBotAccountAction("123456", "private-openid", "event-id"))

	var audits []model.AuditLog
	require.NoError(t, model.LOG_DB.Find(&audits).Error)
	payload, err := common.Marshal(audits)
	require.NoError(t, err)
	assert.NotContains(t, string(payload), code)
	assert.NotContains(t, string(payload), groupCode)
	assert.NotContains(t, string(payload), "private-openid")
	assert.NotContains(t, string(payload), unbindProof)
}
