package setting

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

var groupOrder = []string{"default", "vip", "svip"}
var groupOrderMutex sync.RWMutex

func GetGroupOrder() []string {
	groupOrderMutex.RLock()
	defer groupOrderMutex.RUnlock()

	return append([]string(nil), groupOrder...)
}

func GroupOrder2JSONString() string {
	groupOrderMutex.RLock()
	defer groupOrderMutex.RUnlock()

	jsonBytes, err := json.Marshal(groupOrder)
	if err != nil {
		return "[]"
	}
	return string(jsonBytes)
}

func ParseGroupOrder(jsonString string) ([]string, error) {
	order := make([]string, 0)
	if err := json.Unmarshal([]byte(jsonString), &order); err != nil {
		return nil, err
	}

	seen := make(map[string]struct{}, len(order))
	for index, group := range order {
		group = strings.TrimSpace(group)
		if group == "" {
			return nil, fmt.Errorf("group order item %d must not be empty", index+1)
		}
		if _, exists := seen[group]; exists {
			return nil, fmt.Errorf("duplicate group in order: %s", group)
		}
		seen[group] = struct{}{}
		order[index] = group
	}
	return order, nil
}

func UpdateGroupOrderByJSONString(jsonString string) error {
	order, err := ParseGroupOrder(jsonString)
	if err != nil {
		return err
	}

	groupOrderMutex.Lock()
	groupOrder = order
	groupOrderMutex.Unlock()
	return nil
}
