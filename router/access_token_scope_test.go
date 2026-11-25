package router

import (
	"encoding/base64"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/qqbot"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// accessTokenExemptRoutes are /api routes that never reach dashboard
// authentication, so a personal access token has no rule to satisfy there.
var accessTokenExemptRoutes = []string{
	// Anonymous pages and setup.
	"GET /api/setup",
	"POST /api/setup",
	"GET /api/status",
	"GET /api/notice",
	"GET /api/user-agreement",
	"GET /api/privacy-policy",
	"GET /api/about",
	"GET /api/home_page_content",
	"GET /api/ratio_config",
	"GET /api/user/groups",

	// Anonymous account entry points.
	"GET /api/verification",
	"GET /api/reset_password",
	"POST /api/user/reset",
	"POST /api/user/register",
	"GET /api/user/login/encryption-key",
	"POST /api/user/login",
	"POST /api/user/login/2fa",
	"POST /api/user/login/verify",
	"POST /api/user/login/passkey/begin",
	"POST /api/user/login/passkey/finish",
	"POST /api/user/passkey/login/begin",
	"POST /api/user/passkey/login/finish",
	"GET /api/oauth/wechat",
	"GET /api/oauth/telegram/login",
	"GET /api/oauth/telegram/bind/:flow_token",

	// Browser session cookie endpoints.
	"POST /api/user/auth/refresh",
	"POST /api/user/auth/logout",

	// Payment callbacks.
	"POST /api/stripe/webhook",
	"POST /api/creem/webhook",
	"POST /api/waffo/webhook",
	"POST /api/waffo-pancake/webhook/:env",
	"GET /api/user/epay/notify",
	"POST /api/user/epay/notify",
	"GET /api/subscription/epay/notify",
	"POST /api/subscription/epay/notify",
	"GET /api/subscription/epay/return",
	"POST /api/subscription/epay/return",

	// Signed QQ Open Platform callback.
	"POST " + qqbot.WebhookPath,

	// Dedicated backend SSO credential; dashboard tokens are never accepted.
	"POST /api/sso/chatgpt2api/exchange",
	"POST /api/sso/chatgpt2api/session",
	"POST /api/sso/chatgpt2api/tokens",

	// API key authentication (TokenAuthReadOnly).
	"GET /api/usage/token/",
	"GET /api/log/token",
}

// accessTokenHelperRoutes are declared through handlePermissionRoute outside
// channelPermissionRoutes.
var accessTokenHelperRoutes = map[string]authz.Permission{
	"DELETE /api/status-monitor/intelligence/results/:task_id": authz.ChannelOperate,
	"GET /api/status-monitor/intelligence":                     authz.ChannelOperate,
	"PUT /api/status-monitor/intelligence":                     authz.ChannelOperate,
	"POST /api/status-monitor/intelligence/run":                authz.ChannelOperate,
	"GET /api/task_plugin_options":                             authz.TaskPluginBind,
	"GET /api/audit":                                           authz.AuditRead,
}

func newAccessTokenScopeTestEngine(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	bot := qqbot.NewRuntime("", "3001", nil, func() string { return "" })
	t.Cleanup(bot.Close)
	// A permission route that is also in the static table panics here.
	require.NotPanics(t, func() {
		SetApiRouter(engine)
		setQQBotRoutes(engine, bot)
		SetDashboardRouter(engine)
		SetRelayRouter(engine)
		SetTaskPluginProtocolRouter(engine)
		SetVideoRouter(engine)
		SetTaskRouter(engine)
	})
	return engine
}

func TestAccessTokenRouteRulesCoverEveryDashboardRoute(t *testing.T) {
	engine := newAccessTokenScopeTestEngine(t)
	exempt := map[string]bool{}
	for _, key := range accessTokenExemptRoutes {
		exempt[key] = true
	}
	registered := map[string]bool{}
	panel := map[string]bool{}
	for _, route := range engine.Routes() {
		if !strings.HasPrefix(route.Path, "/api/") && !strings.HasPrefix(route.Path, "/pg/") {
			continue
		}
		key := route.Method + " " + route.Path
		registered[key] = true
		if !exempt[key] {
			panel[key] = true
		}
	}
	for _, key := range accessTokenExemptRoutes {
		assert.True(t, registered[key], "exempt route %s is no longer registered", key)
	}

	declared := map[string]int{}
	for _, key := range middleware.AccessTokenRouteRuleKeys() {
		declared[key]++
	}
	for key := range panel {
		assert.Equal(t, 1, declared[key], "panel route %s must be declared exactly once", key)
	}
	for key := range declared {
		assert.True(t, panel[key], "declared route %s is not a registered panel route", key)
	}

	permissionRoutes := map[string]authz.Permission{}
	for _, route := range channelPermissionRoutes {
		permissionRoutes[route.method+" "+joinPaths("/api/channel", route.path)] = route.permission
	}
	for key, permission := range accessTokenHelperRoutes {
		permissionRoutes[key] = permission
	}
	for key, permission := range permissionRoutes {
		rule, ok := middleware.AccessTokenRouteRule(key)
		require.True(t, ok, key)
		assert.Equal(t, "scope", rule.Kind(), key)
		assert.Equal(t, service.AccessTokenScopeOf(permission), rule.Scope(), key)
	}
	for _, key := range []string{"POST /api/user/topup/:id/refund", "DELETE /api/user/invoices/:id/file"} {
		rule, ok := middleware.AccessTokenRouteRule(key)
		require.True(t, ok, key)
		assert.Equal(t, "scope", rule.Kind(), key)
		assert.Equal(t, "billing:write", rule.Scope(), "financial writes must require the billing write grant: %s", key)
	}
}

func TestDashboardPerfMetricsRequiresAdminReadAccess(t *testing.T) {
	setupRelayRouterTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.UserAccessToken{}, &model.AuditLog{}, &model.PerfMetric{}))
	engine := gin.New()
	SetApiRouter(engine)
	for _, tc := range []struct {
		name, scope string
		role, want  int
	}{
		{"guest", "", 0, http.StatusUnauthorized},
		{"member", "log:read", common.RoleCommonUser, http.StatusForbidden},
		{"admin-profile", "profile:read", common.RoleAdminUser, http.StatusForbidden},
		{"admin-log", "log:read", common.RoleAdminUser, http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/data/perf-metrics/summary", nil)
			if tc.role != 0 {
				user := model.User{Username: tc.name, AffCode: tc.name, Role: tc.role, Group: "default", Status: common.UserStatusEnabled}
				require.NoError(t, model.DB.Create(&user).Error)
				suffix, err := common.GenerateRandomCharsKey(43)
				require.NoError(t, err)
				raw := model.AccessTokenPrefix + suffix
				token := model.UserAccessToken{Name: tc.name, TokenHash: model.AccessTokenFingerprint(raw), TokenHint: model.AccessTokenHint(raw)}
				require.NoError(t, token.SetScopes([]string{tc.scope}))
				require.NoError(t, model.CreateUserAccessToken(user.Id, &token, service.AccessTokenMaxPerUser))
				req.Header.Set("Authorization", "Bearer "+raw)
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, req)
			assert.Equal(t, tc.want, recorder.Code)
			assert.Contains(t, recorder.Header().Get("Cache-Control"), "no-store")
		})
	}
}

func TestModelDetectionRequiresDashboardSession(t *testing.T) {
	setupRelayRouterTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.UserAccessToken{}, &model.AuditLog{}))
	engine := gin.New()
	SetApiRouter(engine)

	guest := httptest.NewRecorder()
	engine.ServeHTTP(guest, httptest.NewRequest(http.MethodPost, "/api/model-detection", nil))
	assert.Equal(t, http.StatusUnauthorized, guest.Code)
	assert.Contains(t, guest.Header().Get("Cache-Control"), "no-store")

	user := model.User{Username: "detector-pat", AffCode: "detector-pat", Role: common.RoleCommonUser, Group: "default", Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(&user).Error)
	suffix, err := common.GenerateRandomCharsKey(43)
	require.NoError(t, err)
	raw := model.AccessTokenPrefix + suffix
	token := model.UserAccessToken{Name: "detector", TokenHash: model.AccessTokenFingerprint(raw), TokenHint: model.AccessTokenHint(raw)}
	require.NoError(t, token.SetScopes([]string{"profile:read"}))
	require.NoError(t, model.CreateUserAccessToken(user.Id, &token, service.AccessTokenMaxPerUser))

	request := httptest.NewRequest(http.MethodPost, "/api/model-detection", nil)
	request.Header.Set("Authorization", "Bearer "+raw)
	pat := httptest.NewRecorder()
	engine.ServeHTTP(pat, request)
	assert.Equal(t, http.StatusForbidden, pat.Code)
	assert.Contains(t, pat.Header().Get("Cache-Control"), "no-store")
	assert.NotContains(t, pat.Body.String(), raw)
}

func TestModelDetectionUsesAccountRelayAndSessionBoundSamples(t *testing.T) {
	setupRelayRouterTestDB(t)
	require.NoError(t, i18n.Init())
	ratio_setting.InitRatioSettings()
	require.NoError(t, model.DB.AutoMigrate(
		&model.UserSession{}, &model.Channel{}, &model.Log{}, &model.Option{}, &model.SystemTask{},
		&model.UserSubscription{}, &model.SubscriptionPreConsumeRecord{},
	))
	sqlDB, err := model.DB.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	user := model.User{Username: "detector-user", AffCode: "detector-user", Group: "default", Status: common.UserStatusEnabled, Quota: 1000000}
	require.NoError(t, model.DB.Create(&user).Error)
	first, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "fixture")
	require.NoError(t, err)
	second, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "fixture")
	require.NoError(t, err)

	var upstreamCalls atomic.Int32
	values := make([]string, 335)
	for i := range values {
		values[i] = strconv.Itoa(1 + (i/2*37)%155 + i%2*190)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls.Add(1)
		assert.Equal(t, service.ModelDetectionChatEndpoint, r.URL.Path)
		assert.Equal(t, "Bearer model-detection-upstream", r.Header.Get("Authorization"))
		assert.Empty(t, r.Header.Get("Cookie"))
		payload, err := common.Marshal(map[string]any{
			"id": "detector-fixture", "object": "chat.completion", "model": "gpt-4o",
			"choices": []any{map[string]any{
				"index": 0, "message": map[string]string{"role": "assistant", "content": strings.Join(values, ", ")},
				"finish_reason": "stop",
			}},
			"usage": map[string]int{"prompt_tokens": 200, "completion_tokens": 335, "total_tokens": 535},
		})
		assert.NoError(t, err)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(payload)
	}))
	t.Cleanup(upstream.Close)
	baseURL := upstream.URL
	channel := model.Channel{
		Name: "detector-upstream", Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled,
		Group: "default", Models: "gpt-4o", Key: "model-detection-upstream", BaseURL: &baseURL,
	}
	require.NoError(t, channel.Insert())
	service.InitHttpClient()
	engine := gin.New()
	SetApiRouter(engine)

	serve := func(method, path, credential string, input *service.ModelDetectionRequest) *httptest.ResponseRecorder {
		t.Helper()
		var body []byte
		if input != nil {
			var err error
			body, err = common.Marshal(input)
			require.NoError(t, err)
		}
		request := httptest.NewRequest(method, path, strings.NewReader(string(body)))
		request.Header.Set("Authorization", "Bearer "+credential)
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		return recorder
	}

	const path = "/api/model-detection"
	input := service.ModelDetectionRequest{
		Endpoint: service.ModelDetectionChatEndpoint, Group: "unavailable", Model: "gpt-4o",
		Mode: "detect", Stream: common.GetPointer(false),
	}
	forbidden := serve(http.MethodPost, path, first.AccessToken, &input)
	require.Equal(t, http.StatusForbidden, forbidden.Code, forbidden.Body.String())
	input.Group = "default"
	missing := serve(http.MethodPost, path, first.AccessToken, &input)
	require.Equal(t, http.StatusBadRequest, missing.Code, missing.Body.String())
	assert.Zero(t, upstreamCalls.Load())

	t.Run("prepared samples are bound to the session and successful probes use normal billing", func(t *testing.T) {
		executable := os.Getenv("MODEL_DETECTION_TEST_CLI_PATH")
		if executable == "" {
			t.Skip("set MODEL_DETECTION_TEST_CLI_PATH to the pinned fpd executable")
		}
		t.Setenv("MODEL_DETECTION_CLI_PATH", executable)
		preview := serve(http.MethodGet, path+"/challenges", first.AccessToken, nil)
		require.Equal(t, http.StatusOK, preview.Code, preview.Body.String())
		assert.Contains(t, preview.Header().Get("Cache-Control"), "no-store")
		var samples struct {
			Data struct {
				Token      string                            `json:"token"`
				Challenges []service.ModelDetectionChallenge `json:"challenges"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(preview.Body.Bytes(), &samples))
		require.Len(t, samples.Data.Challenges, 3)
		require.NotEmpty(t, samples.Data.Token)
		assert.Zero(t, upstreamCalls.Load())

		input.ChallengeToken = samples.Data.Token
		replayed := serve(http.MethodPost, path, second.AccessToken, &input)
		require.Equal(t, http.StatusBadRequest, replayed.Code, replayed.Body.String())
		input.ChallengeToken += "z"
		tampered := serve(http.MethodPost, path, first.AccessToken, &input)
		require.Equal(t, http.StatusBadRequest, tampered.Code, tampered.Body.String())
		expiredPayload, err := common.Marshal(map[string]any{"expires_at": 1, "challenges": samples.Data.Challenges})
		require.NoError(t, err)
		encoded := base64.RawURLEncoding.EncodeToString(expiredPayload)
		input.ChallengeToken = encoded + "." + common.GenerateHMACWithKey(
			[]byte(common.SessionSecret), "model-detection-challenges:"+first.Session.SID+":"+encoded,
		)
		expired := serve(http.MethodPost, path, first.AccessToken, &input)
		require.Equal(t, http.StatusBadRequest, expired.Code, expired.Body.String())
		assert.Zero(t, upstreamCalls.Load())

		input.ChallengeToken = samples.Data.Token
		t.Run("address and API key must match site configuration and account", func(t *testing.T) {
			config := console_setting.GetConsoleSetting()
			previous := *config
			t.Cleanup(func() { *config = previous })
			config.ApiInfoEnabled = true
			config.ApiInfo = `[{"url":"https://detector.example/v1"}]`
			const key = "detectorRoutingKeyFixture"
			wrongOwner := model.Token{UserId: user.Id + 1, Key: key, Group: "default", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true}
			require.NoError(t, model.DB.Create(&wrongOwner).Error)
			input := input
			input.APIURL, input.APIKey = "https://unknown.example", "sk-"+key
			unconfigured := serve(http.MethodPost, path, first.AccessToken, &input)
			assert.Equal(t, http.StatusBadRequest, unconfigured.Code, unconfigured.Body.String())
			input.APIURL = "https://detector.example/v1"
			foreign := serve(http.MethodPost, path, first.AccessToken, &input)
			assert.Equal(t, http.StatusForbidden, foreign.Code, foreign.Body.String())
			assert.NotContains(t, foreign.Body.String(), key)
			assert.Zero(t, upstreamCalls.Load())
		})

		detected := serve(http.MethodPost, path, first.AccessToken, &input)
		require.Equal(t, http.StatusOK, detected.Code, detected.Body.String())
		var response struct {
			Success bool                         `json:"success"`
			Data    service.ModelDetectionResult `json:"data"`
		}
		require.NoError(t, common.Unmarshal(detected.Body.Bytes(), &response))
		assert.True(t, response.Success)
		assert.Zero(t, response.Data.UpstreamStatus)
		assert.EqualValues(t, 3, upstreamCalls.Load())
		after, err := model.GetUserById(user.Id, false)
		require.NoError(t, err)
		assert.Less(t, after.Quota, user.Quota)
		assert.NotContains(t, detected.Body.String(), first.AccessToken)
		assert.NotContains(t, detected.Body.String(), channel.Key)
	})
}

func TestAccessTokenCatalogCoversEveryPermission(t *testing.T) {
	catalog := service.AccessTokenCatalog(1, common.RoleRootUser)
	scopes := map[string]bool{}
	resources := map[string]int{}
	for _, group := range catalog {
		for _, resource := range group.Resources {
			resources[resource.Resource]++
			for _, action := range resource.Actions {
				scopes[resource.Resource+":"+action.Action] = true
			}
		}
	}
	for _, permission := range authz.AllPermissions() {
		assert.True(t, scopes[service.AccessTokenScopeOf(permission)], "root catalog lacks %s", service.AccessTokenScopeOf(permission))
	}
	for resource, count := range resources {
		assert.Equal(t, 1, count, "resource %s appears in more than one catalog entry", resource)
	}
}

func TestAccessTokenVerificationScopesAreAllListed(t *testing.T) {
	files, err := filepath.Glob("../service/*.go")
	require.NoError(t, err)
	fileSet := token.NewFileSet()
	var scopes []string
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		parsed, err := parser.ParseFile(fileSet, file, nil, 0)
		require.NoError(t, err)
		for _, declaration := range parsed.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok || general.Tok != token.CONST {
				continue
			}
			for _, spec := range general.Specs {
				value := spec.(*ast.ValueSpec)
				for i, name := range value.Names {
					if !strings.HasPrefix(name.Name, "VerificationScope") || i >= len(value.Values) {
						continue
					}
					literal, ok := value.Values[i].(*ast.BasicLit)
					require.True(t, ok, name.Name)
					scope, err := strconv.Unquote(literal.Value)
					require.NoError(t, err)
					scopes = append(scopes, scope)
				}
			}
		}
	}
	require.NotEmpty(t, scopes)
	for _, scope := range scopes {
		_, listed := service.AccessTokenVerificationScope(scope)
		assert.True(t, listed, "verification scope %s has no access token rule", scope)
	}
}
