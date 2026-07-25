package setting

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

const (
	ChannelRouteExclusionSameChannelRetry = "same_channel_retry"
	ChannelRouteExclusionNextChannel      = "next_channel"
	ChannelRouteExclusionAll              = "all"
)

var (
	ChannelRouteGroupExclusionsEnabled = true

	channelRouteGroupExclusionsMu sync.RWMutex
	channelRouteGroupExclusions   = map[string]ChannelRouteGroupExclusion{}
)

type ChannelRouteGroupExclusion struct {
	Mode    string `json:"mode"`
	Enabled bool   `json:"enabled"`
}

type channelRouteGroupExclusionJSON struct {
	Mode    string `json:"mode"`
	Enabled *bool  `json:"enabled"`
}

func validChannelRouteGroupExclusionMode(mode string) bool {
	switch mode {
	case ChannelRouteExclusionSameChannelRetry, ChannelRouteExclusionNextChannel, ChannelRouteExclusionAll:
		return true
	default:
		return false
	}
}

func ParseChannelRouteGroupExclusions(jsonString string) (map[string]ChannelRouteGroupExclusion, error) {
	parsed := map[string]ChannelRouteGroupExclusion{}
	if strings.TrimSpace(jsonString) == "" {
		return parsed, nil
	}
	rawRules := map[string]json.RawMessage{}
	if err := json.Unmarshal([]byte(jsonString), &rawRules); err != nil {
		return nil, fmt.Errorf("invalid channel route group exclusions: %w", err)
	}
	if rawRules == nil {
		return nil, fmt.Errorf("invalid channel route group exclusions: expected an object")
	}
	for group, rawRule := range rawRules {
		if strings.TrimSpace(group) == "" {
			return nil, fmt.Errorf("channel route exclusion group cannot be empty")
		}

		var legacyMode string
		if err := json.Unmarshal(rawRule, &legacyMode); err == nil {
			if !validChannelRouteGroupExclusionMode(legacyMode) {
				return nil, fmt.Errorf("invalid channel route exclusion mode for group %s", group)
			}
			parsed[group] = ChannelRouteGroupExclusion{Mode: legacyMode, Enabled: true}
			continue
		}

		var rule channelRouteGroupExclusionJSON
		if err := json.Unmarshal(rawRule, &rule); err != nil || !validChannelRouteGroupExclusionMode(rule.Mode) {
			return nil, fmt.Errorf("invalid channel route exclusion mode for group %s", group)
		}
		enabled := true
		if rule.Enabled != nil {
			enabled = *rule.Enabled
		}
		parsed[group] = ChannelRouteGroupExclusion{Mode: rule.Mode, Enabled: enabled}
	}
	return parsed, nil
}

func UpdateChannelRouteGroupExclusionsByJSONString(jsonString string) error {
	parsed, err := ParseChannelRouteGroupExclusions(jsonString)
	if err != nil {
		return err
	}
	channelRouteGroupExclusionsMu.Lock()
	channelRouteGroupExclusions = parsed
	channelRouteGroupExclusionsMu.Unlock()
	return nil
}

func ChannelRouteGroupExclusions2JSONString() string {
	channelRouteGroupExclusionsMu.RLock()
	cloned := make(map[string]ChannelRouteGroupExclusion, len(channelRouteGroupExclusions))
	for group, rule := range channelRouteGroupExclusions {
		cloned[group] = rule
	}
	channelRouteGroupExclusionsMu.RUnlock()
	encoded, err := json.Marshal(cloned)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func GetChannelRouteGroupExclusion(group string) string {
	if !ChannelRouteGroupExclusionsEnabled {
		return ""
	}
	channelRouteGroupExclusionsMu.RLock()
	rule, ok := channelRouteGroupExclusions[group]
	channelRouteGroupExclusionsMu.RUnlock()
	if !ok || !rule.Enabled {
		return ""
	}
	return rule.Mode
}

func IsChannelRouteSameChannelRetryExcluded(group string) bool {
	mode := GetChannelRouteGroupExclusion(group)
	return mode == ChannelRouteExclusionSameChannelRetry || mode == ChannelRouteExclusionAll
}

func IsChannelRouteNextChannelExcluded(group string) bool {
	mode := GetChannelRouteGroupExclusion(group)
	return mode == ChannelRouteExclusionNextChannel || mode == ChannelRouteExclusionAll
}
