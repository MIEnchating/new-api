package setting

import (
	"fmt"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

var groupDescriptions = make(map[string]string)
var groupDescriptionsMutex sync.RWMutex

func GroupDescriptions2JSONString() string {
	groupDescriptionsMutex.RLock()
	defer groupDescriptionsMutex.RUnlock()

	data, err := common.Marshal(groupDescriptions)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func ParseGroupDescriptions(jsonString string) (map[string]string, error) {
	if strings.TrimSpace(jsonString) == "" {
		jsonString = "{}"
	}

	parsed := make(map[string]string)
	if err := common.UnmarshalJsonStr(jsonString, &parsed); err != nil {
		return nil, err
	}

	normalized := make(map[string]string, len(parsed))
	for group, description := range parsed {
		group = strings.TrimSpace(group)
		if group == "" {
			return nil, fmt.Errorf("group description key must not be empty")
		}
		if _, exists := normalized[group]; exists {
			return nil, fmt.Errorf("duplicate group description key: %s", group)
		}
		description = strings.TrimSpace(description)
		if description != "" {
			normalized[group] = description
		}
	}
	return normalized, nil
}

func UpdateGroupDescriptionsByJSONString(jsonString string) error {
	normalized, err := ParseGroupDescriptions(jsonString)
	if err != nil {
		return err
	}

	groupDescriptionsMutex.Lock()
	groupDescriptions = normalized
	groupDescriptionsMutex.Unlock()
	return nil
}
