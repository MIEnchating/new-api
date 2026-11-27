package ratio_setting

import (
	"fmt"
	"math"
	"strings"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
)

const GroupRequestPricesOption = "ModelGroupRequestPrices"

// The nested maps are replaced wholesale and are immutable after publication.
var groupRequestPrices atomic.Pointer[map[string]map[string]float64]

func UpdateGroupRequestPrices(raw string) error {
	var prices map[string]map[string]*float64
	if err := common.UnmarshalJsonStr(raw, &prices); err != nil {
		return err
	}
	next := make(map[string]map[string]float64, len(prices))
	for model, groups := range prices {
		next[model] = make(map[string]float64, len(groups))
		for group, price := range groups {
			if price == nil || !ValidGroupRequestPrice(group, *price) {
				return fmt.Errorf("invalid request price for model %q and group %q", model, group)
			}
			next[model][group] = *price
		}
	}
	groupRequestPrices.Store(&next)
	return nil
}

func GroupRequestPricesJSON() string {
	prices := groupRequestPrices.Load()
	if prices == nil {
		return "{}"
	}
	raw, _ := common.Marshal(*prices)
	return string(raw)
}

func ValidGroupRequestPrice(group string, price float64) bool {
	return group != "" && strings.TrimSpace(group) == group && group != "auto" &&
		price >= 0 && !math.IsInf(price*1_000_000, 0)
}

// GroupRequestPrices returns the immutable settings snapshot for this model.
func GroupRequestPrices(model string) map[string]float64 {
	if prices := groupRequestPrices.Load(); prices != nil {
		return (*prices)[model]
	}
	return nil
}

func GroupRequestPrice(prices map[string]float64, group string) (float64, bool) {
	return common.LookupGroup(group, func(name string) (float64, bool) {
		price, ok := prices[name]
		return price, ok
	})
}
