package service

import (
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
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
		specialSettings, b := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Get(userGroup)
		if b {
			// Additions are applied first so an explicit removal always wins.
			explicitlyRemoved := make(map[string]struct{})
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
	}
	return groupsCopy
}

func GroupInUserUsableGroups(userGroup, groupName string) bool {
	_, ok := GetUserUsableGroups(userGroup)[groupName]
	return ok
}

func IsUserSelectableGroup(userGroup, groupName string) bool {
	if groupName == "" || groupName == "auto" {
		return false
	}
	return GroupInUserUsableGroups(userGroup, groupName) && ratio_setting.ContainsGroupRatio(groupName)
}

// GetUserAutoGroup 根据用户分组获取自动分组设置
func GetUserAutoGroup(userGroup string) []string {
	autoGroups := make([]string, 0)
	seen := make(map[string]struct{})
	for _, group := range setting.GetAutoGroups() {
		if !IsUserSelectableGroup(userGroup, group) {
			continue
		}
		if _, ok := seen[group]; ok {
			continue
		}
		seen[group] = struct{}{}
		autoGroups = append(autoGroups, group)
	}
	return autoGroups
}

// FilterUserTokenAutoGroups applies current permissions before the current
// per-token limit. It intentionally does not fall back to the global Auto list.
func FilterUserTokenAutoGroups(userGroup string, groups []string) []string {
	maxCount := setting.GetMaxTokenAutoGroups()
	filtered := make([]string, 0, min(len(groups), maxCount))
	seen := make(map[string]struct{})
	for _, group := range groups {
		if !IsUserSelectableGroup(userGroup, group) {
			continue
		}
		if _, ok := seen[group]; ok {
			continue
		}
		seen[group] = struct{}{}
		filtered = append(filtered, group)
		if len(filtered) == maxCount {
			break
		}
	}
	return filtered
}

// GetRequestAutoGroups resolves the ordered Auto groups for the current token.
// The absence of the context value means that the token inherits the complete
// global Auto list; a present (even empty) value is an explicit token snapshot.
func GetRequestAutoGroups(c *gin.Context, userGroup string) []string {
	value, ok := common.GetContextKey(c, constant.ContextKeyTokenAutoGroups)
	if !ok {
		return GetUserAutoGroup(userGroup)
	}
	groups, ok := value.([]string)
	if !ok {
		return []string{}
	}
	return FilterUserTokenAutoGroups(userGroup, groups)
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

type GroupRatioStatus struct {
	Ratio           float64 `json:"ratio"`
	BaseRatio       float64 `json:"base_ratio"`
	ScheduleEnabled bool    `json:"schedule_enabled"`
	ScheduleActive  bool    `json:"schedule_active"`
}

func GetEffectiveGroupRatio(userGroup, group string, now time.Time) (float64, bool, bool) {
	baseRatio, enabled, active := ratio_setting.GetEffectiveGroupRatio(group, now)
	if specialRatio, ok := ratio_setting.GetGroupGroupRatio(userGroup, group); ok {
		return specialRatio, false, false
	}
	return baseRatio, enabled, active
}

func GetGroupRatioStatus(userGroup, group string, now time.Time) GroupRatioStatus {
	baseRatio := ratio_setting.GetGroupRatio(group)
	ratio, enabled, active := GetEffectiveGroupRatio(userGroup, group, now)
	return GroupRatioStatus{
		Ratio:           ratio,
		BaseRatio:       baseRatio,
		ScheduleEnabled: enabled,
		ScheduleActive:  active,
	}
}
