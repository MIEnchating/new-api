package setting

import (
	"maps"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

const GroupCategoriesOptionKey = "GroupCategories"

var groupCategories = make(map[string]string)
var groupCategoriesMutex sync.RWMutex

func GetGroupCategories() map[string]string {
	groupCategoriesMutex.RLock()
	defer groupCategoriesMutex.RUnlock()
	return maps.Clone(groupCategories)
}

func ParseGroupCategories(value string) (map[string]string, error) {
	if strings.TrimSpace(value) == "" {
		value = "{}"
	}
	var parsed map[string]*string
	if err := common.UnmarshalJsonStr(value, &parsed); err != nil || parsed == nil {
		return nil, common.NewMessage("Expected a JSON object mapping group names to category names")
	}

	categories := make(map[string]string, len(parsed))
	for group, category := range parsed {
		if group == "" || group != strings.TrimSpace(group) || category == nil {
			return nil, common.NewMessage("Expected a JSON object mapping group names to category names")
		}
		if label := strings.TrimSpace(*category); label != "" {
			categories[group] = label
		}
	}
	return categories, nil
}

func UpdateGroupCategories(value string) error {
	categories, err := ParseGroupCategories(value)
	if err != nil {
		return err
	}
	groupCategoriesMutex.Lock()
	groupCategories = categories
	groupCategoriesMutex.Unlock()
	return nil
}
