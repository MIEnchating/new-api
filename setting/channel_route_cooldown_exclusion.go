package setting

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
)

var (
	channelRouteCooldownExcludedGroupsMu sync.RWMutex
	channelRouteCooldownExcludedGroups   = map[string]struct{}{}
)

func ParseChannelRouteCooldownExcludedGroups(jsonString string) (map[string]struct{}, error) {
	parsed := []string{}
	if strings.TrimSpace(jsonString) == "" {
		return map[string]struct{}{}, nil
	}
	if err := json.Unmarshal([]byte(jsonString), &parsed); err != nil {
		return nil, fmt.Errorf("invalid channel route cooldown excluded groups: %w", err)
	}
	if parsed == nil {
		return nil, fmt.Errorf("invalid channel route cooldown excluded groups: expected an array")
	}

	groups := make(map[string]struct{}, len(parsed))
	for _, rawGroup := range parsed {
		group := strings.TrimSpace(rawGroup)
		if group == "" {
			return nil, fmt.Errorf("channel route cooldown excluded group cannot be empty")
		}
		groups[group] = struct{}{}
	}
	return groups, nil
}

func UpdateChannelRouteCooldownExcludedGroupsByJSONString(jsonString string) error {
	parsed, err := ParseChannelRouteCooldownExcludedGroups(jsonString)
	if err != nil {
		return err
	}
	channelRouteCooldownExcludedGroupsMu.Lock()
	channelRouteCooldownExcludedGroups = parsed
	channelRouteCooldownExcludedGroupsMu.Unlock()
	return nil
}

func ChannelRouteCooldownExcludedGroups2JSONString() string {
	channelRouteCooldownExcludedGroupsMu.RLock()
	groups := make([]string, 0, len(channelRouteCooldownExcludedGroups))
	for group := range channelRouteCooldownExcludedGroups {
		groups = append(groups, group)
	}
	channelRouteCooldownExcludedGroupsMu.RUnlock()
	sort.Strings(groups)
	encoded, err := json.Marshal(groups)
	if err != nil {
		return "[]"
	}
	return string(encoded)
}

func IsChannelRouteCooldownExcluded(group string) bool {
	channelRouteCooldownExcludedGroupsMu.RLock()
	_, excluded := channelRouteCooldownExcludedGroups[group]
	channelRouteCooldownExcludedGroupsMu.RUnlock()
	return excluded
}
