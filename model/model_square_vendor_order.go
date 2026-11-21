package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const ModelSquareVendorOrderOption = "ModelSquareVendorOrder"
const defaultModelSquareVendorOrder = `["OpenAI","Anthropic"]`

func GetModelSquareVendorOrder() []string {
	common.OptionMapRWMutex.RLock()
	value, configured := common.OptionMap[ModelSquareVendorOrderOption]
	common.OptionMapRWMutex.RUnlock()
	if configured {
		if order, err := parseModelSquareVendorOrder(value); err == nil {
			return order
		}
	}
	order, _ := parseModelSquareVendorOrder(defaultModelSquareVendorOrder)
	return order
}

func parseModelSquareVendorOrder(value string) ([]string, error) {
	var order []string
	if err := common.UnmarshalJsonStr(value, &order); err != nil || order == nil {
		return nil, common.NewMessage("Supplier order must be a list of unique names")
	}
	seen := make(map[string]struct{}, len(order))
	for index, name := range order {
		name = strings.TrimSpace(name)
		if _, exists := seen[name]; name == "" || exists {
			return nil, common.NewMessage("Supplier order must be a list of unique names")
		}
		seen[name] = struct{}{}
		order[index] = name
	}
	return order, nil
}
