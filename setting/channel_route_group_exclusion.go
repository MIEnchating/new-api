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
	channelRouteGroupExclusionsMu sync.RWMutex
	channelRouteGroupExclusions   = map[string]string{}
)

func ParseChannelRouteGroupExclusions(jsonString string) (map[string]string, error) {
	parsed := map[string]string{}
	if strings.TrimSpace(jsonString) == "" {
		return parsed, nil
	}
	if err := json.Unmarshal([]byte(jsonString), &parsed); err != nil {
		return nil, fmt.Errorf("invalid channel route group exclusions: %w", err)
	}
	for group, mode := range parsed {
		if strings.TrimSpace(group) == "" {
			return nil, fmt.Errorf("channel route exclusion group cannot be empty")
		}
		switch mode {
		case ChannelRouteExclusionSameChannelRetry, ChannelRouteExclusionNextChannel, ChannelRouteExclusionAll:
		default:
			return nil, fmt.Errorf("invalid channel route exclusion mode for group %s", group)
		}
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
	cloned := make(map[string]string, len(channelRouteGroupExclusions))
	for group, mode := range channelRouteGroupExclusions {
		cloned[group] = mode
	}
	channelRouteGroupExclusionsMu.RUnlock()
	encoded, err := json.Marshal(cloned)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func GetChannelRouteGroupExclusion(group string) string {
	channelRouteGroupExclusionsMu.RLock()
	mode := channelRouteGroupExclusions[group]
	channelRouteGroupExclusionsMu.RUnlock()
	return mode
}

func IsChannelRouteSameChannelRetryExcluded(group string) bool {
	mode := GetChannelRouteGroupExclusion(group)
	return mode == ChannelRouteExclusionSameChannelRetry || mode == ChannelRouteExclusionAll
}

func IsChannelRouteNextChannelExcluded(group string) bool {
	mode := GetChannelRouteGroupExclusion(group)
	return mode == ChannelRouteExclusionNextChannel || mode == ChannelRouteExclusionAll
}
