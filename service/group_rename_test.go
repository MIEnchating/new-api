package service

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRenamedGroupKeepsRouteCooldownAndConnection(t *testing.T) {
	originalDB, originalLogDB := model.DB, model.LOG_DB
	t.Cleanup(func() { model.DB, model.LOG_DB = originalDB, originalLogDB })
	setupTokenGroupRouteTest(t)
	originalAliases := common.GetGroupAliases()
	t.Cleanup(func() { require.NoError(t, common.SetGroupAliases(originalAliases)) })
	require.NoError(t, common.SetGroupAliases(nil))
	until := FreezeTokenGroupRoute(11, "vip", tokenRouteTestModel, tokenRouteTestPath, 60)
	require.NoError(t, common.SetGroupAliases(map[string]string{"vip": "pro"}))
	assert.Equal(t, until, GetTokenGroupRouteCooldownUntil(11, "pro", tokenRouteTestModel, tokenRouteTestPath, common.GetTimestamp()))
	ctx := newTokenRouteContext([]model.TokenGroupRoute{{Group: "pro", Priority: 1}})
	assert.True(t, RestoreTokenGroupRoute(ctx, "vip", tokenRouteTestModel, tokenRouteTestPath))
	assert.False(t, RestoreTokenGroupRoute(ctx, "unrelated", tokenRouteTestModel, tokenRouteTestPath))
	// Restoring the original name keeps both the old connection and cooldown.
	ctx = newTokenRouteContext([]model.TokenGroupRoute{{Group: "vip", Priority: 1}})
	assert.True(t, RestoreTokenGroupRoute(ctx, "pro", tokenRouteTestModel, tokenRouteTestPath))
	assert.Equal(t, until, GetTokenGroupRouteCooldownUntil(11, "vip", tokenRouteTestModel, tokenRouteTestPath, common.GetTimestamp()))
}

func TestPrepareGroupSettingsUpdateRestoresHistoricalName(t *testing.T) {
	setGroupRenameOptionMap(t, map[string]string{
		"GroupRatio":       `{"default":1,"pro":2.5}`,
		"UserUsableGroups": `{"pro":"Paid"}`,
		"AutoGroups":       `["pro","default"]`,
		"GroupGroupRatio":  `{"pro":{"pro":0.75}}`,
	})
	updates, renames, err := PrepareGroupSettingsUpdate(
		map[string]string{"GroupRatio": `{"default":1,"vip":2.5}`},
		[]GroupRename{{From: "pro", To: "vip"}},
	)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"pro": "vip"}, renames)
	assert.JSONEq(t, `{"vip":"Paid"}`, updates["UserUsableGroups"])
	assert.JSONEq(t, `["vip","default"]`, updates["AutoGroups"])
	assert.JSONEq(t, `{"vip":{"vip":0.75}}`, updates["GroupGroupRatio"])
}

func TestRenamedGroupPermissionsAndPricesAcrossCacheGenerations(t *testing.T) {
	originalAliases := common.GetGroupAliases()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	originalOverrides := ratio_setting.GroupGroupRatio2JSONString()
	originalSchedules := ratio_setting.GroupRatioSchedule2JSONString()
	originalUsable := setting.UserUsableGroups2JSONString()
	originalSpecial := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.ReadAll()
	originalLimits := setting.ModelRequestRateLimitGroup2JSONString()
	originalTopup := common.TopupGroupRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, common.SetGroupAliases(originalAliases))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
		require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(originalOverrides))
		require.NoError(t, ratio_setting.UpdateGroupRatioScheduleByJSONString(originalSchedules))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsable))
		ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Clear()
		ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.AddAll(originalSpecial)
		require.NoError(t, setting.UpdateModelRequestRateLimitGroupByJSONString(originalLimits))
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(originalTopup))
	})
	require.NoError(t, common.SetGroupAliases(map[string]string{"vip": "pro"}))
	for _, cachedName := range []string{"vip", "pro"} {
		t.Run(cachedName, func(t *testing.T) {
			ratios, err := common.Marshal(map[string]float64{cachedName: 2.5})
			require.NoError(t, err)
			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(string(ratios)))
			require.NoError(t, common.UpdateTopupGroupRatioByJSONString(string(ratios)))
			usable, err := common.Marshal(map[string]string{cachedName: "Paid"})
			require.NoError(t, err)
			require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(string(usable)))
			schedules, err := common.Marshal(map[string]ratio_setting.GroupRatioSchedule{cachedName: {
				Enabled: true, Periods: []ratio_setting.GroupRatioSchedulePeriod{{Start: "00:00", End: "23:59", Ratio: 3.5}},
			}})
			require.NoError(t, err)
			require.NoError(t, ratio_setting.UpdateGroupRatioScheduleByJSONString(string(schedules)))
			overrides, err := common.Marshal(map[string]map[string]float64{cachedName: {cachedName: 0.75}})
			require.NoError(t, err)
			require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(string(overrides)))
			limits, err := common.Marshal(map[string][2]int{cachedName: {10, 5}})
			require.NoError(t, err)
			require.NoError(t, setting.UpdateModelRequestRateLimitGroupByJSONString(string(limits)))
			ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Clear()
			for _, requestName := range []string{"vip", "pro"} {
				assert.True(t, GroupInUserUsableGroups(requestName, requestName))
				assert.Equal(t, map[string]string{cachedName: "Paid"}, GetUserUsableGroups(requestName))
				assert.Equal(t, 2.5, common.GetTopupGroupRatio(requestName))
				ratio, enabled, active := GetEffectiveGroupRatio("default", requestName, time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
				assert.Equal(t, 3.5, ratio)
				assert.True(t, enabled)
				assert.True(t, active)
				ratio, _, _ = GetEffectiveGroupRatio(requestName, requestName, time.Now())
				assert.Equal(t, 0.75, ratio)
				total, success, found := setting.GetGroupRateLimit(requestName)
				assert.True(t, found)
				assert.Equal(t, 10, total)
				assert.Equal(t, 5, success)
			}
			// An explicit removal must win even if base permissions and special
			// permissions have been refreshed in a different order on this node.
			for _, excluded := range []string{"vip", "pro"} {
				ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Clear()
				ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.AddAll(map[string]map[string]string{
					"pro": {"-:" + excluded: "", "+:vip": "Paid"},
				})
				assert.False(t, GroupInUserUsableGroups("vip", "vip"))
				assert.False(t, GroupInUserUsableGroups("vip", "pro"))
			}
			assert.False(t, GroupInUserUsableGroups("vip", "unrelated"))
		})
	}
}

func setGroupRenameOptionMap(t *testing.T, values map[string]string) {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	original := common.OptionMap
	common.OptionMap = values
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = original
		common.OptionMapRWMutex.Unlock()
	})
}

func TestPrepareGroupSettingsUpdateRenamesOptionBackedReferences(t *testing.T) {
	setGroupRenameOptionMap(t, map[string]string{
		"GroupRatio":      `{"default":1,"vip":2}`,
		"GroupCategories": `{"default":"OpenAI","vip":"Internal tools"}`,
		"GroupGroupRatio": `{"vip":{"default":0.8},"default":{"vip":1.2}}`,
		"AutoGroups":      `["vip","default"]`,
		"group_ratio_setting.group_special_usable_group": `{"vip":{"+:vip":"VIP","-:default":""}}`,
		"ChannelRouteCooldownExcludedGroups":             `["vip"]`,
		"ChannelRouteGroupExclusions":                    `{"vip":{"mode":"all","enabled":true}}`,
		"ModelRequestRateLimitGroup":                     `{"vip":[10,8]}`,
		"perf_metrics_setting.cache_monitor_groups":      `["default","vip"]`,
	})

	updates, renames, err := PrepareGroupSettingsUpdate(
		map[string]string{"GroupRatio": `{"default":1,"pro":2}`},
		[]GroupRename{{From: "vip", To: "pro"}},
	)

	require.NoError(t, err)
	assert.Equal(t, map[string]string{"vip": "pro"}, renames)
	assert.JSONEq(t, `{"default":"OpenAI","pro":"Internal tools"}`, updates["GroupCategories"])
	assert.JSONEq(t, `{"pro":{"default":0.8},"default":{"pro":1.2}}`, updates["GroupGroupRatio"])
	assert.JSONEq(t, `["pro","default"]`, updates["AutoGroups"])
	assert.JSONEq(t, `{"pro":{"+:pro":"VIP","-:default":""}}`, updates["group_ratio_setting.group_special_usable_group"])
	assert.JSONEq(t, `["pro"]`, updates["ChannelRouteCooldownExcludedGroups"])
	assert.JSONEq(t, `{"pro":{"mode":"all","enabled":true}}`, updates["ChannelRouteGroupExclusions"])
	assert.JSONEq(t, `{"pro":[10,8]}`, updates["ModelRequestRateLimitGroup"])
	assert.JSONEq(t, `["default","pro"]`, updates["perf_metrics_setting.cache_monitor_groups"])
}

func TestPrepareGroupSettingsUpdateRejectsExistingTarget(t *testing.T) {
	setGroupRenameOptionMap(t, map[string]string{
		"GroupRatio": `{"default":1,"vip":2}`,
	})

	updates, renames, err := PrepareGroupSettingsUpdate(
		map[string]string{"GroupRatio": `{"default":2}`},
		[]GroupRename{{From: "vip", To: "default"}},
	)

	require.Error(t, err)
	assert.Nil(t, updates)
	assert.Nil(t, renames)
}

func TestPrepareGroupSettingsUpdateAllowsPartialUpdateWithoutRename(t *testing.T) {
	setGroupRenameOptionMap(t, map[string]string{
		"GroupRatio":        `{"default":1,"vip":2}`,
		"GroupDescriptions": `{"default":"Default"}`,
	})

	updates, renames, err := PrepareGroupSettingsUpdate(
		map[string]string{"GroupDescriptions": `{"default":"Standard"}`},
		nil,
	)

	require.NoError(t, err)
	assert.Equal(t, map[string]string{"GroupDescriptions": `{"default":"Standard"}`}, updates)
	assert.Empty(t, renames)
}

func TestPrepareGroupSettingsUpdateRejectsInvalidReferencedOptionBeforeCommit(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		value string
	}{
		{name: "user usable groups", key: "UserUsableGroups", value: `{"vip":1}`},
		{name: "group ratio overrides", key: "GroupGroupRatio", value: `{"vip":{"default":"invalid"}}`},
		{name: "special usable groups", key: "group_ratio_setting.group_special_usable_group", value: `{"vip":{"+:default":1}}`},
		{name: "cooldown exclusions", key: "ChannelRouteCooldownExcludedGroups", value: `["vip",""]`},
		{name: "route exclusions", key: "ChannelRouteGroupExclusions", value: `{"vip":{"mode":"invalid"}}`},
		{name: "request rate limits", key: "ModelRequestRateLimitGroup", value: `{"vip":[-1,1]}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setGroupRenameOptionMap(t, map[string]string{
				"GroupRatio": `{"default":1,"vip":2}`,
				test.key:     test.value,
			})

			updates, renames, err := PrepareGroupSettingsUpdate(
				map[string]string{"GroupRatio": `{"default":1,"pro":2}`},
				[]GroupRename{{From: "vip", To: "pro"}},
			)

			require.Error(t, err)
			assert.Nil(t, updates)
			assert.Nil(t, renames)
		})
	}
}
