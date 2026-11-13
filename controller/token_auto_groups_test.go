package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func configureTokenAutoGroupsTest(t *testing.T, maxCount string, autoGroups string) {
	t.Helper()
	originalMax := setting.GetMaxTokenAutoGroups()
	originalAutoGroups := setting.AutoGroups2JsonString()
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, setting.UpdateMaxTokenAutoGroups(maxCount))
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(autoGroups))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","vip":"VIP"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"vip":1}`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateMaxTokenAutoGroups(stringInt(originalMax)))
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(originalAutoGroups))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
	})
}

func stringInt(value int) string {
	return fmt.Sprintf("%d", value)
}

func setupTokenAutoGroupsControllerTest(t *testing.T) *model.User {
	t.Helper()
	initModelListColumnNames(t)
	db := setupTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	user := &model.User{
		Id:       101,
		Username: "token-auto-user",
		Password: "password",
		Group:    "default",
		Status:   common.UserStatusEnabled,
	}
	require.NoError(t, db.Create(user).Error)
	return user
}

func baseAutoTokenRequest(name string) map[string]any {
	return map[string]any{
		"name":              name,
		"expired_time":      -1,
		"remain_quota":      0,
		"unlimited_quota":   true,
		"group":             "auto",
		"cross_group_retry": true,
	}
}

func newTokenAutoGroupsAuthenticatedContext(t *testing.T, method string, target string, body any, userID int) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	ctx, recorder := newAuthenticatedContext(t, method, target, body, userID)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	return ctx, recorder
}

func TestAddTokenEmptyAutoGroupsInheritGlobalAuto(t *testing.T) {
	tests := []struct {
		name         string
		includeField bool
		value        any
	}{
		{name: "omitted"},
		{name: "null", includeField: true, value: nil},
		{name: "empty array", includeField: true, value: []string{}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			configureTokenAutoGroupsTest(t, "5", `["default","vip"]`)
			user := setupTokenAutoGroupsControllerTest(t)
			request := baseAutoTokenRequest("create-" + test.name)
			if test.includeField {
				request["auto_groups"] = test.value
			}

			ctx, recorder := newTokenAutoGroupsAuthenticatedContext(t, http.MethodPost, "/api/token/", request, user.Id)
			AddToken(ctx)

			response := decodeAPIResponse(t, recorder)
			require.True(t, response.Success, response.Message)
			var token model.Token
			require.NoError(t, model.DB.Where("name = ?", request["name"]).First(&token).Error)
			assert.Empty(t, token.AutoGroups)
			assert.True(t, token.CrossGroupRetry)
			payload, err := common.Marshal(buildMaskedTokenResponse(&token))
			require.NoError(t, err)
			var responseData map[string]any
			require.NoError(t, common.Unmarshal(payload, &responseData))
			assert.Nil(t, responseData["auto_groups"])
		})
	}
}

func TestAddTokenPersistsOrderedAutoGroupsSnapshot(t *testing.T) {
	configureTokenAutoGroupsTest(t, "5", `["default","vip"]`)
	user := setupTokenAutoGroupsControllerTest(t)
	request := baseAutoTokenRequest("ordered-snapshot")
	request["auto_groups"] = []string{"vip", "default"}

	ctx, recorder := newTokenAutoGroupsAuthenticatedContext(t, http.MethodPost, "/api/token/", request, user.Id)
	AddToken(ctx)
	require.True(t, decodeAPIResponse(t, recorder).Success)

	var token model.Token
	require.NoError(t, model.DB.Where("name = ?", "ordered-snapshot").First(&token).Error)
	assert.JSONEq(t, `["vip","default"]`, token.AutoGroups)

	getCtx, getRecorder := newTokenAutoGroupsAuthenticatedContext(t, http.MethodGet, "/api/token/"+stringInt(token.Id), nil, user.Id)
	getCtx.Params = append(getCtx.Params, gin.Param{Key: "id", Value: stringInt(token.Id)})
	GetToken(getCtx)
	getResponse := decodeAPIResponse(t, getRecorder)
	require.True(t, getResponse.Success)
	var data struct {
		AutoGroups []string `json:"auto_groups"`
	}
	require.NoError(t, common.Unmarshal(getResponse.Data, &data))
	assert.Equal(t, []string{"vip", "default"}, data.AutoGroups)
}

func TestUpdateTokenAutoGroupsTriStateAndNonAutoCleanup(t *testing.T) {
	tests := []struct {
		name               string
		includeField       bool
		value              any
		group              string
		expectedAutoGroups string
		expectedRetry      bool
	}{
		{name: "omitted preserves", group: "auto", expectedAutoGroups: `["vip","default"]`, expectedRetry: true},
		{name: "null inherits", includeField: true, value: nil, group: "auto", expectedRetry: true},
		{name: "empty inherits", includeField: true, value: []string{}, group: "auto", expectedRetry: true},
		{name: "non auto clears and disables retry", includeField: true, value: []string{"vip"}, group: "default"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			configureTokenAutoGroupsTest(t, "5", `["default","vip"]`)
			user := setupTokenAutoGroupsControllerTest(t)
			token := seedToken(t, model.DB, user.Id, "update-auto", "update-auto-key")
			token.Group = "auto"
			token.CrossGroupRetry = true
			require.NoError(t, token.SetAutoGroups([]string{"vip", "default"}))
			require.NoError(t, model.DB.Save(token).Error)

			request := baseAutoTokenRequest("updated-auto")
			request["id"] = token.Id
			request["status"] = common.TokenStatusEnabled
			request["group"] = test.group
			if test.includeField {
				request["auto_groups"] = test.value
			}
			ctx, recorder := newTokenAutoGroupsAuthenticatedContext(t, http.MethodPut, "/api/token/", request, user.Id)
			UpdateToken(ctx)
			response := decodeAPIResponse(t, recorder)
			require.True(t, response.Success, response.Message)

			var updated model.Token
			require.NoError(t, model.DB.First(&updated, token.Id).Error)
			if test.expectedAutoGroups == "" {
				assert.Empty(t, updated.AutoGroups)
			} else {
				assert.JSONEq(t, test.expectedAutoGroups, updated.AutoGroups)
			}
			assert.Equal(t, test.expectedRetry, updated.CrossGroupRetry)
		})
	}
}

func TestAddTokenRejectsInvalidAutoGroups(t *testing.T) {
	tests := []struct {
		name     string
		maxCount string
		groups   []string
	}{
		{name: "over limit", maxCount: "1", groups: []string{"default", "vip"}},
		{name: "duplicate", maxCount: "5", groups: []string{"default", "default"}},
		{name: "auto pseudo group", maxCount: "5", groups: []string{"auto"}},
		{name: "unavailable", maxCount: "5", groups: []string{"missing"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			configureTokenAutoGroupsTest(t, test.maxCount, `["default","vip"]`)
			user := setupTokenAutoGroupsControllerTest(t)
			request := baseAutoTokenRequest("invalid-" + test.name)
			request["auto_groups"] = test.groups

			ctx, recorder := newTokenAutoGroupsAuthenticatedContext(t, http.MethodPost, "/api/token/", request, user.Id)
			AddToken(ctx)

			response := decodeAPIResponse(t, recorder)
			assert.False(t, response.Success)
			var count int64
			require.NoError(t, model.DB.Model(&model.Token{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestGetTokenAutoGroupsReturnsFullFilteredGlobalOrderAndLimit(t *testing.T) {
	configureTokenAutoGroupsTest(t, "1", `["vip","missing","default"]`)
	user := setupTokenAutoGroupsControllerTest(t)

	ctx, recorder := newTokenAutoGroupsAuthenticatedContext(t, http.MethodGet, "/api/token/auto-groups", nil, user.Id)
	GetTokenAutoGroups(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var data struct {
		Groups   []string `json:"groups"`
		MaxCount int      `json:"max_count"`
	}
	require.NoError(t, common.Unmarshal(response.Data, &data))
	assert.Equal(t, []string{"vip", "default"}, data.Groups)
	assert.Equal(t, 1, data.MaxCount)
}

func TestGetTokenSmartRoutingTemplatesOnlyReturnsUsableEnabledTemplates(t *testing.T) {
	configureTokenAutoGroupsTest(t, "5", `[]`)
	user := setupTokenAutoGroupsControllerTest(t)
	original := operation_setting.CurrentSmartRoutingSetting()
	t.Cleanup(func() {
		data, err := common.Marshal(original.Templates)
		require.NoError(t, err)
		require.NoError(t, operation_setting.UpdateSmartRoutingSetting(map[string]string{
			"enabled":            fmt.Sprintf("%t", original.Enabled),
			"templates":          string(data),
			"max_user_templates": fmt.Sprintf("%d", original.MaxUserTemplates),
		}))
	})
	require.NoError(t, operation_setting.UpdateSmartRoutingSetting(map[string]string{
		"enabled": "true",
		"templates": `[
			{"id":"claude","name":"Claude","enabled":true,"group_routes":[{"group":"default","priority":2,"cooldown_seconds":60},{"group":"vip","priority":1,"cooldown_seconds":60}]},
			{"id":"missing","name":"Missing","enabled":true,"group_routes":[{"group":"missing","priority":1,"cooldown_seconds":60}]},
			{"id":"disabled","name":"Disabled","enabled":false,"group_routes":[]}
		]`,
	}))

	ctx, recorder := newTokenAutoGroupsAuthenticatedContext(t, http.MethodGet, "/api/token/smart-routing-templates", nil, user.Id)
	GetTokenSmartRoutingTemplates(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var templates []operation_setting.SmartRoutingTemplate
	require.NoError(t, common.Unmarshal(response.Data, &templates))
	require.Len(t, templates, 1)
	assert.Equal(t, "claude", templates[0].ID)
	assert.Equal(t, []string{"default", "vip"}, []string{
		templates[0].GroupRoutes[0].Group,
		templates[0].GroupRoutes[1].Group,
	})
}

func TestUserCanManageOwnSmartRoutingTemplates(t *testing.T) {
	configureTokenAutoGroupsTest(t, "5", `[]`)
	user := setupTokenAutoGroupsControllerTest(t)
	originalRouting := operation_setting.CurrentSmartRoutingSetting()
	t.Cleanup(func() {
		data, err := common.Marshal(originalRouting.Templates)
		require.NoError(t, err)
		require.NoError(t, operation_setting.UpdateSmartRoutingSetting(map[string]string{
			"enabled":            fmt.Sprintf("%t", originalRouting.Enabled),
			"templates":          string(data),
			"max_user_templates": fmt.Sprintf("%d", originalRouting.MaxUserTemplates),
		}))
	})
	require.NoError(t, operation_setting.UpdateSmartRoutingSetting(map[string]string{
		"max_user_templates": "1",
	}))
	original, err := model.GetUserSetting(user.Id, true)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, model.UpdateUserSetting(user.Id, original)) })

	body := map[string]any{"templates": []any{
		map[string]any{
			"id": "personal", "name": "Personal", "enabled": true,
			"group_routes":       []any{map[string]any{"group": "default", "priority": 1, "cooldown_seconds": 60}},
			"group_route_sticky": false,
		},
	}}
	tooMany := map[string]any{"templates": []any{
		map[string]any{
			"id": "personal", "name": "Personal", "enabled": true,
			"group_routes": []any{map[string]any{"group": "default", "priority": 1, "cooldown_seconds": 60}},
		},
		map[string]any{"id": "second", "name": "Second", "enabled": false},
	}}
	ctx, recorder := newTokenAutoGroupsAuthenticatedContext(t, http.MethodPut, "/api/token/smart-routing-templates", tooMany, user.Id)
	UpdateUserSmartRoutingTemplates(ctx)
	response := decodeAPIResponse(t, recorder)
	assert.False(t, response.Success)
	ctx, recorder = newTokenAutoGroupsAuthenticatedContext(t, http.MethodPut, "/api/token/smart-routing-templates", body, user.Id)
	UpdateUserSmartRoutingTemplates(ctx)
	response = decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)

	ctx, recorder = newTokenAutoGroupsAuthenticatedContext(t, http.MethodGet, "/api/token/smart-routing-templates?owned=true", nil, user.Id)
	GetTokenSmartRoutingTemplates(ctx)
	response = decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var templates []operation_setting.SmartRoutingTemplate
	var ownedResponse struct {
		Templates []operation_setting.SmartRoutingTemplate `json:"templates"`
		Max       int                                      `json:"max_user_templates"`
	}
	require.NoError(t, common.Unmarshal(response.Data, &ownedResponse))
	templates = ownedResponse.Templates
	require.Len(t, templates, 1)
	assert.Equal(t, "personal", templates[0].ID)
	assert.True(t, templates[0].UserOwned)
	assert.Equal(t, 1, ownedResponse.Max)

	token := seedToken(t, model.DB, user.Id, "personal-template-key", "personal-template-key")
	token.RoutingTemplateID = "personal"
	require.NoError(t, token.Update())
	effective, err := model.ValidateUserToken(token.Key)
	require.NoError(t, err)
	assert.Equal(t, "personal", effective.RoutingTemplateID)
	assert.Equal(t, "default", effective.GetGroupRoutes()[0].Group)

	stored, err := model.GetUserSetting(user.Id, true)
	require.NoError(t, err)
	require.NoError(t, operation_setting.UpdateSmartRoutingSetting(map[string]string{
		"enabled":   "false",
		"templates": `[{"id":"reserved","name":"Global","enabled":false}]`,
	}))
	for _, tc := range []struct {
		name  string
		id    string
		group string
	}{
		{"unauthorized group", "forbidden", "missing"},
		{"global identifier collision", "reserved", "default"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := map[string]any{"templates": []any{map[string]any{
				"id": tc.id, "name": "Rejected", "enabled": true,
				"group_routes": []any{map[string]any{"group": tc.group, "priority": 1, "cooldown_seconds": 60}},
			}}}
			ctx, recorder := newTokenAutoGroupsAuthenticatedContext(t, http.MethodPut, "/api/token/smart-routing-templates", request, user.Id)
			UpdateUserSmartRoutingTemplates(ctx)
			assert.False(t, decodeAPIResponse(t, recorder).Success)
			after, err := model.GetUserSetting(user.Id, true)
			require.NoError(t, err)
			assert.JSONEq(t, stored.SmartRoutingTemplates, after.SmartRoutingTemplates)
		})
	}

	other := model.User{Username: "other-template-user", Group: "default", AffCode: "other-template-user"}
	require.NoError(t, model.DB.Create(&other).Error)
	ctx, recorder = newTokenAutoGroupsAuthenticatedContext(t, http.MethodGet, "/api/token/smart-routing-templates?owned=true", nil, other.Id)
	GetTokenSmartRoutingTemplates(ctx)
	response = decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	require.NoError(t, common.Unmarshal(response.Data, &ownedResponse))
	assert.Empty(t, ownedResponse.Templates, "one user's templates must not be visible to another user")
}

func TestUpdateTokenGroupRoutesOnlyChangesRouteConfig(t *testing.T) {
	configureTokenAutoGroupsTest(t, "5", `["default","vip"]`)
	user := setupTokenAutoGroupsControllerTest(t)
	token := seedToken(t, model.DB, user.Id, "route-editor", "route-editor-key")
	token.Group = ""
	token.RemainQuota = 123456
	token.UnlimitedQuota = false
	token.ModelLimitsEnabled = true
	token.ModelLimits = "gpt-5.6-sol"
	token.GroupRouteSticky = true
	token.GroupRouteConfig = `[{"group":"default","priority":2,"cooldown_seconds":60,"enabled":true},{"group":"vip","priority":1,"cooldown_seconds":120,"enabled":true}]`
	require.NoError(t, model.DB.Save(token).Error)

	body := map[string]any{
		"group_route_config": `[{"group":"vip","priority":9,"cooldown_seconds":120,"enabled":true},{"group":"default","priority":1,"cooldown_seconds":60,"enabled":false}]`,
	}
	ctx, recorder := newTokenAutoGroupsAuthenticatedContext(
		t, http.MethodPut, "/api/token/"+stringInt(token.Id)+"/route", body, user.Id,
	)
	ctx.Params = append(ctx.Params, gin.Param{Key: "id", Value: stringInt(token.Id)})
	UpdateTokenGroupRoutes(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var updated model.Token
	require.NoError(t, model.DB.First(&updated, token.Id).Error)
	assert.JSONEq(t, `[{"group":"vip","priority":9,"cooldown_seconds":120,"enabled":true},{"group":"default","priority":1,"cooldown_seconds":60,"enabled":false}]`, updated.GroupRouteConfig)
	assert.Equal(t, 123456, updated.RemainQuota)
	assert.False(t, updated.UnlimitedQuota)
	assert.True(t, updated.ModelLimitsEnabled)
	assert.Equal(t, "gpt-5.6-sol", updated.ModelLimits)
	assert.True(t, updated.GroupRouteSticky)
}

func TestUpdateTokenGroupRoutesRejectsDisablingEveryRoute(t *testing.T) {
	configureTokenAutoGroupsTest(t, "5", `["default","vip"]`)
	user := setupTokenAutoGroupsControllerTest(t)
	token := seedToken(t, model.DB, user.Id, "route-editor-disabled", "route-editor-disabled-key")
	token.GroupRouteConfig = `[{"group":"default","priority":2,"cooldown_seconds":60,"enabled":true},{"group":"vip","priority":1,"cooldown_seconds":60,"enabled":true}]`
	require.NoError(t, model.DB.Save(token).Error)

	body := map[string]any{
		"group_route_config": `[{"group":"default","priority":2,"cooldown_seconds":60,"enabled":false},{"group":"vip","priority":1,"cooldown_seconds":60,"enabled":false}]`,
	}
	ctx, recorder := newTokenAutoGroupsAuthenticatedContext(
		t, http.MethodPut, "/api/token/"+stringInt(token.Id)+"/route", body, user.Id,
	)
	ctx.Params = append(ctx.Params, gin.Param{Key: "id", Value: stringInt(token.Id)})
	UpdateTokenGroupRoutes(ctx)

	response := decodeAPIResponse(t, recorder)
	assert.False(t, response.Success)
	var unchanged model.Token
	require.NoError(t, model.DB.First(&unchanged, token.Id).Error)
	assert.JSONEq(t, token.GroupRouteConfig, unchanged.GroupRouteConfig)
}
