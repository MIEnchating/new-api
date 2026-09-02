package service

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

const maxGroupRenamesPerUpdate = 64

type GroupRename struct {
	From string `json:"from"`
	To   string `json:"to"`
}

var groupSettingsOptionKeys = map[string]struct{}{
	"GroupRatio": {},
	ratio_setting.GroupRatioScheduleOptionKey: {},
	"TopupGroupRatio":                         {},
	"GroupDescriptions":                       {},
	"UserUsableGroups":                        {},
	"GroupGroupRatio":                         {},
	"AutoGroups":                              {},
	"GroupOrder":                              {},
	"MaxTokenAutoGroups":                      {},
	"DefaultUseAutoGroup":                     {},
	"group_ratio_setting.group_special_usable_group": {},
}

var groupReferenceOptionKinds = map[string]string{
	"GroupRatio": "map",
	ratio_setting.GroupRatioScheduleOptionKey: "map",
	"TopupGroupRatio":                         "map",
	"GroupDescriptions":                       "map",
	"UserUsableGroups":                        "map",
	"GroupGroupRatio":                         "nested_map",
	"AutoGroups":                              "array",
	"GroupOrder":                              "array",
	"group_ratio_setting.group_special_usable_group": "special_map",
	"ChannelRouteCooldownExcludedGroups":             "array",
	"ChannelRouteGroupExclusions":                    "map",
	"ModelRequestRateLimitGroup":                     "map",
	"perf_metrics_setting.cache_monitor_groups":      "array",
}

func IsGroupSettingsOptionKey(key string) bool {
	_, ok := groupSettingsOptionKeys[key]
	return ok
}

// PrepareGroupSettingsUpdate validates an atomic group-settings request and
// carries every renamed identifier into related option-backed configuration.
func PrepareGroupSettingsUpdate(submitted map[string]string, requested []GroupRename) (map[string]string, map[string]string, error) {
	if len(submitted) == 0 {
		return nil, nil, fmt.Errorf("at least one group setting is required")
	}
	for key := range submitted {
		if !IsGroupSettingsOptionKey(key) {
			return nil, nil, fmt.Errorf("option %s is not a group setting", key)
		}
	}
	if len(requested) > maxGroupRenamesPerUpdate {
		return nil, nil, fmt.Errorf("cannot rename more than %d groups at once", maxGroupRenamesPerUpdate)
	}

	currentValues := make(map[string]string)
	common.OptionMapRWMutex.RLock()
	for key := range groupReferenceOptionKinds {
		if value, ok := common.OptionMap[key]; ok {
			currentValues[key] = value
		}
	}
	common.OptionMapRWMutex.RUnlock()
	for key, value := range submitted {
		currentValues[key] = value
	}

	var currentRatios map[string]float64
	common.OptionMapRWMutex.RLock()
	currentRatioJSON := common.OptionMap["GroupRatio"]
	common.OptionMapRWMutex.RUnlock()
	if err := common.UnmarshalJsonStr(currentRatioJSON, &currentRatios); err != nil {
		return nil, nil, fmt.Errorf("read current group ratios: %w", err)
	}

	renames := make(map[string]string, len(requested))
	targets := make(map[string]struct{}, len(requested))
	for _, requestedRename := range requested {
		source := strings.TrimSpace(requestedRename.From)
		target := strings.TrimSpace(requestedRename.To)
		if source == target {
			continue
		}
		if err := validateRenamedGroupName(source); err != nil {
			return nil, nil, fmt.Errorf("invalid source group: %w", err)
		}
		if err := validateRenamedGroupName(target); err != nil {
			return nil, nil, fmt.Errorf("invalid target group: %w", err)
		}
		if _, ok := currentRatios[source]; !ok {
			return nil, nil, fmt.Errorf("source group %s does not exist", source)
		}
		if _, ok := currentRatios[target]; ok {
			return nil, nil, fmt.Errorf("target group %s already exists", target)
		}
		if _, duplicated := renames[source]; duplicated {
			return nil, nil, fmt.Errorf("source group %s is renamed more than once", source)
		}
		if _, duplicated := targets[target]; duplicated {
			return nil, nil, fmt.Errorf("multiple groups cannot be renamed to %s", target)
		}
		renames[source] = target
		targets[target] = struct{}{}
	}
	for source, target := range renames {
		if _, chained := renames[target]; chained {
			return nil, nil, fmt.Errorf("group rename chains are not supported: %s", source)
		}
	}

	updates := make(map[string]string, len(currentValues)+len(submitted))
	for key, value := range submitted {
		updates[key] = value
	}
	if len(renames) > 0 {
		for key, kind := range groupReferenceOptionKinds {
			value, ok := currentValues[key]
			if !ok || strings.TrimSpace(value) == "" {
				continue
			}
			renamed, changed, err := renameGroupsInOption(value, kind, renames)
			if err != nil {
				return nil, nil, fmt.Errorf("rename group references in %s: %w", key, err)
			}
			if changed || IsGroupSettingsOptionKey(key) {
				updates[key] = renamed
			}
		}
	}
	if err := validateGroupSettingValues(updates); err != nil {
		return nil, nil, err
	}

	if len(renames) > 0 {
		var finalRatios map[string]float64
		if err := common.UnmarshalJsonStr(updates["GroupRatio"], &finalRatios); err != nil {
			return nil, nil, err
		}
		for source, target := range renames {
			if _, remains := finalRatios[source]; remains {
				return nil, nil, fmt.Errorf("renamed source group %s remains in GroupRatio", source)
			}
			if _, exists := finalRatios[target]; !exists {
				return nil, nil, fmt.Errorf("renamed target group %s is missing from GroupRatio", target)
			}
		}
	}
	return updates, renames, nil
}

func validateRenamedGroupName(name string) error {
	if name == "" {
		return fmt.Errorf("group name cannot be empty")
	}
	if name == "auto" {
		return fmt.Errorf("auto is reserved")
	}
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) > 50 {
		return fmt.Errorf("group name cannot exceed 50 characters")
	}
	if strings.Contains(name, ",") {
		return fmt.Errorf("group name cannot contain commas")
	}
	return nil
}

func validateGroupSettingValues(values map[string]string) error {
	for key, value := range values {
		var err error
		switch key {
		case "GroupRatio":
			err = ratio_setting.CheckGroupRatio(value)
		case ratio_setting.GroupRatioScheduleOptionKey:
			err = ratio_setting.CheckGroupRatioSchedule(value)
		case "GroupDescriptions":
			_, err = setting.ParseGroupDescriptions(value)
		case "GroupOrder":
			_, err = setting.ParseGroupOrder(value)
		case "MaxTokenAutoGroups":
			err = setting.ValidateMaxTokenAutoGroups(value)
		case "DefaultUseAutoGroup":
			_, err = strconv.ParseBool(value)
		case "AutoGroups", "perf_metrics_setting.cache_monitor_groups":
			var parsed []string
			err = common.UnmarshalJsonStr(value, &parsed)
		case "ChannelRouteCooldownExcludedGroups":
			_, err = setting.ParseChannelRouteCooldownExcludedGroups(value)
		case "TopupGroupRatio":
			var parsed map[string]float64
			if err = common.UnmarshalJsonStr(value, &parsed); err == nil {
				for group, ratio := range parsed {
					if ratio < 0 || math.IsNaN(ratio) || math.IsInf(ratio, 0) {
						err = fmt.Errorf("top-up ratio for %s must be finite and non-negative", group)
						break
					}
				}
			}
		case "UserUsableGroups":
			var parsed map[string]string
			err = common.UnmarshalJsonStr(value, &parsed)
		case "GroupGroupRatio":
			var parsed map[string]map[string]float64
			err = common.UnmarshalJsonStr(value, &parsed)
		case "group_ratio_setting.group_special_usable_group":
			var parsed map[string]map[string]string
			err = common.UnmarshalJsonStr(value, &parsed)
		case "ChannelRouteGroupExclusions":
			_, err = setting.ParseChannelRouteGroupExclusions(value)
		case "ModelRequestRateLimitGroup":
			err = setting.CheckModelRequestRateLimitGroup(value)
		}
		if err != nil {
			return fmt.Errorf("invalid group setting %s: %w", key, err)
		}
	}
	return nil
}

func renameGroupsInOption(value string, kind string, renames map[string]string) (string, bool, error) {
	switch kind {
	case "array":
		var groups []string
		if err := common.UnmarshalJsonStr(value, &groups); err != nil {
			return "", false, err
		}
		changed := false
		seen := make(map[string]struct{}, len(groups))
		result := make([]string, 0, len(groups))
		for _, group := range groups {
			if target, ok := renames[group]; ok {
				group = target
				changed = true
			}
			if _, exists := seen[group]; exists {
				changed = true
				continue
			}
			seen[group] = struct{}{}
			result = append(result, group)
		}
		encoded, err := common.Marshal(result)
		return string(encoded), changed, err
	case "map":
		var entries map[string]json.RawMessage
		if err := common.UnmarshalJsonStr(value, &entries); err != nil {
			return "", false, err
		}
		changed, err := renameRawMapKeys(entries, renames)
		if err != nil {
			return "", false, err
		}
		encoded, err := common.Marshal(entries)
		return string(encoded), changed, err
	case "nested_map", "special_map":
		var entries map[string]json.RawMessage
		if err := common.UnmarshalJsonStr(value, &entries); err != nil {
			return "", false, err
		}
		changed, err := renameRawMapKeys(entries, renames)
		if err != nil {
			return "", false, err
		}
		for outerKey, raw := range entries {
			var nested map[string]json.RawMessage
			if err := common.Unmarshal(raw, &nested); err != nil {
				return "", false, fmt.Errorf("group %s: %w", outerKey, err)
			}
			nestedRenames := renames
			if kind == "special_map" {
				nestedRenames = make(map[string]string, len(renames)*3)
				for source, target := range renames {
					nestedRenames[source] = target
					nestedRenames["+:"+source] = "+:" + target
					nestedRenames["-:"+source] = "-:" + target
				}
			}
			nestedChanged, err := renameRawMapKeys(nested, nestedRenames)
			if err != nil {
				return "", false, fmt.Errorf("group %s: %w", outerKey, err)
			}
			if nestedChanged {
				changed = true
				encoded, err := common.Marshal(nested)
				if err != nil {
					return "", false, err
				}
				entries[outerKey] = encoded
			}
		}
		encoded, err := common.Marshal(entries)
		return string(encoded), changed, err
	default:
		return "", false, fmt.Errorf("unsupported group reference option kind %s", kind)
	}
}

func renameRawMapKeys(entries map[string]json.RawMessage, renames map[string]string) (bool, error) {
	changed := false
	for source, target := range renames {
		value, ok := entries[source]
		if !ok {
			continue
		}
		if _, collision := entries[target]; collision {
			return false, fmt.Errorf("target group %s already has configuration", target)
		}
		delete(entries, source)
		entries[target] = value
		changed = true
	}
	return changed, nil
}
