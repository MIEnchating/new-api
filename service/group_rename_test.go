package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
