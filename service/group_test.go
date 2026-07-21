package service

import (
	"testing"

	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetUserUsableGroupsRespectsExplicitRemovalOfOwnGroup(t *testing.T) {
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	specialGroups := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup
	originalSpecialGroups := specialGroups.ReadAll()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		specialGroups.Clear()
		specialGroups.AddAll(originalSpecialGroups)
	})

	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
	specialGroups.Clear()
	specialGroups.Set("xx", map[string]string{
		"-:default": "remove",
		"-:xx":      "remove",
	})

	groups := GetUserUsableGroups("xx")
	assert.NotContains(t, groups, "default")
	assert.NotContains(t, groups, "xx")
}

func TestGetUserUsableGroupsDoesNotRestoreUnselectableOwnGroup(t *testing.T) {
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	specialGroups := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup
	originalSpecialGroups := specialGroups.ReadAll()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		specialGroups.Clear()
		specialGroups.AddAll(originalSpecialGroups)
	})

	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"pro":"Pro"}`))
	specialGroups.Clear()

	groups := GetUserUsableGroups("vue源码分组")

	assert.Equal(t, map[string]string{"pro": "Pro"}, groups)
	assert.NotContains(t, groups, "vue源码分组")
}

func TestGetUserUsableGroupsCanExplicitlyAddUnselectableOwnGroup(t *testing.T) {
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	specialGroups := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup
	originalSpecialGroups := specialGroups.ReadAll()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		specialGroups.Clear()
		specialGroups.AddAll(originalSpecialGroups)
	})

	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"pro":"Pro"}`))
	specialGroups.Clear()
	specialGroups.Set("vue源码分组", map[string]string{
		"+:vue源码分组": "Vue source",
	})

	groups := GetUserUsableGroups("vue源码分组")

	assert.Equal(t, "Vue source", groups["vue源码分组"])
}
