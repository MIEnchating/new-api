package service

import (
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

func OrderGroupNames(groupNames []string) []string {
	available := make(map[string]struct{}, len(groupNames))
	for _, group := range groupNames {
		group = strings.TrimSpace(group)
		if group != "" {
			available[group] = struct{}{}
		}
	}

	ordered := make([]string, 0, len(available))
	for _, group := range setting.GetGroupOrder() {
		if _, exists := available[group]; !exists {
			continue
		}
		ordered = append(ordered, group)
		delete(available, group)
	}

	remaining := make([]string, 0, len(available))
	for group := range available {
		remaining = append(remaining, group)
	}
	sort.Strings(remaining)
	return append(ordered, remaining...)
}

func GetOrderedGroupNames() []string {
	groupRatios := ratio_setting.GetGroupRatioCopy()
	groupNames := make([]string, 0, len(groupRatios))
	for group := range groupRatios {
		groupNames = append(groupNames, group)
	}
	return OrderGroupNames(groupNames)
}

func GetUserUsableGroups(userGroup string) map[string]string {
	groupsCopy := setting.GetUserUsableGroupsCopy()
	if userGroup != "" {
		explicitlyRemoved := make(map[string]struct{})
		specialSettings, b := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Get(userGroup)
		if b {
			// Additions are applied first so an explicit removal always wins.
			for specialGroup, desc := range specialSettings {
				if strings.HasPrefix(specialGroup, "-:") {
					groupToRemove := strings.TrimPrefix(specialGroup, "-:")
					explicitlyRemoved[groupToRemove] = struct{}{}
				} else if strings.HasPrefix(specialGroup, "+:") {
					groupToAdd := strings.TrimPrefix(specialGroup, "+:")
					groupsCopy[groupToAdd] = desc
				} else {
					groupsCopy[specialGroup] = desc
				}
			}
			for groupToRemove := range explicitlyRemoved {
				delete(groupsCopy, groupToRemove)
			}
		}
		_, userGroupRemoved := explicitlyRemoved[userGroup]
		if _, ok := groupsCopy[userGroup]; !ok && !userGroupRemoved {
			groupsCopy[userGroup] = "用户分组"
		}
	}
	return groupsCopy
}

func GroupInUserUsableGroups(userGroup, groupName string) bool {
	_, ok := GetUserUsableGroups(userGroup)[groupName]
	return ok
}

// GetUserAutoGroup 根据用户分组获取自动分组设置
func GetUserAutoGroup(userGroup string) []string {
	groups := GetUserUsableGroups(userGroup)
	autoGroups := make([]string, 0)
	for _, group := range setting.GetAutoGroups() {
		if _, ok := groups[group]; ok {
			autoGroups = append(autoGroups, group)
		}
	}
	return autoGroups
}

// GetGroupsEnabledModels 按 groups 顺序获取各分组启用的模型并去重
func GetGroupsEnabledModels(groups []string) []string {
	seen := make(map[string]struct{})
	models := make([]string, 0)
	for _, group := range groups {
		for _, modelName := range model.GetGroupEnabledModels(group) {
			if _, ok := seen[modelName]; !ok {
				seen[modelName] = struct{}{}
				models = append(models, modelName)
			}
		}
	}
	return models
}

// GetUserGroupRatio 获取用户使用某个分组的倍率
// userGroup 用户分组
// group 需要获取倍率的分组
func GetUserGroupRatio(userGroup, group string) float64 {
	ratio, ok := ratio_setting.GetGroupGroupRatio(userGroup, group)
	if ok {
		return ratio
	}
	return ratio_setting.GetGroupRatio(group)
}
