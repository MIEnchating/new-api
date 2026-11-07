package model

import (
	"fmt"
	"maps"
	"math"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ConvertPerSecondPricing converts a legacy draft to the task usage expression
// contract. Existing provider overrides still take precedence. Inactive model
// expressions are replaced because the active legacy price is authoritative.
func ConvertPerSecondPricing(values PricingValues) error {
	if values["billing_setting.billing_mode"] != billing_setting.BillingModePerSecond {
		return nil
	}
	price, ok := values["ModelPrice"].(float64)
	if !ok || math.IsNaN(price) || math.IsInf(price, 0) || price < 0 {
		return common.NewMessage("Enter a finite, non-negative price")
	}
	expression := fmt.Sprintf(`tier("base", u("seconds") * %s)`, strconv.FormatFloat(price, 'g', -1, 64))
	if raw, exists := values["ModelSecondPrice"]; exists {
		encoded, err := common.Marshal(raw)
		if err != nil {
			return err
		}
		var config ModelSecondPriceConfig
		if err := common.Unmarshal(encoded, &config); err != nil {
			return err
		}
		if config.Prices == nil {
			return common.NewMessage("Invalid pricing value")
		}
		prices := make(map[string]float64)
		for resolution, price := range config.Prices {
			resolution = strings.ToLower(strings.TrimSpace(resolution))
			if resolution == "" || math.IsNaN(price) || math.IsInf(price, 0) || price < 0 {
				return common.NewMessage("Invalid pricing value")
			}
			if previous, exists := prices[resolution]; exists && previous != price {
				return common.NewMessage("Invalid pricing value")
			}
			prices[resolution] = price
		}
		resolutions := make([]string, 0, len(prices))
		for resolution := range prices {
			resolutions = append(resolutions, resolution)
		}
		slices.Sort(resolutions)
		for i := len(resolutions) - 1; i >= 0; i-- {
			resolution := resolutions[i]
			// The old price table trims and compares case-insensitively. Missing or
			// unknown measurements select the base price, exactly as before.
			expression = fmt.Sprintf(`lower(trim(u("resolution") ?? "")) == %s ? tier(%s, u("seconds") * %s) : (%s)`, strconv.Quote(resolution), strconv.Quote(resolution), strconv.FormatFloat(prices[resolution], 'g', -1, 64), expression)
		}
	}
	if _, err := billingexpr.CompileFromCache(expression); err != nil {
		return err
	}
	values["billing_setting.billing_mode"] = billing_setting.BillingModeTieredExpr
	values["billing_setting.billing_expr"] = expression
	delete(values, "ModelSecondPrice")
	return nil
}

// migratePerSecondPricing updates only pricing options. Task snapshots and log
// rows intentionally remain in their original format for historical settlement.
func migratePerSecondPricing(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		// Avoid parsing unrelated price tables when no legacy modes remain.
		var mode Option
		if err := tx.Where(clause.Eq{Column: "key", Value: "billing_setting.billing_mode"}).Find(&mode).Error; err != nil {
			return err
		}
		if mode.Value == "" {
			return nil
		}
		var modes map[string]string
		if err := common.UnmarshalJsonStr(mode.Value, &modes); err != nil {
			return err
		}
		names := []string{}
		for name, mode := range modes {
			if mode == billing_setting.BillingModePerSecond {
				names = append(names, name)
			}
		}
		if len(names) == 0 {
			return nil
		}
		values, _, duplicated, err := readModelPricingMaps(lockForUpdate(tx))
		if err != nil {
			return err
		}
		if len(duplicated) > 0 {
			return fmt.Errorf("duplicate pricing option keys: %v", duplicated)
		}
		// Re-read under the same locks used by administrator pricing writes.
		names = names[:0]
		for name, mode := range values["billing_setting.billing_mode"] {
			if mode == billing_setting.BillingModePerSecond {
				names = append(names, name)
			}
		}
		if len(names) == 0 {
			return nil
		}
		slices.Sort(names)
		secondPrices := maps.Clone(values["ModelSecondPrice"])
		for _, name := range names {
			pricing := modelPricingValues(values, name)
			// Match the legacy price helper's normalized-model lookup.
			normalized := ratio_setting.FormatMatchingModelName(name)
			pricing["ModelPrice"] = values["ModelPrice"][normalized]
			if _, ok := pricing["ModelSecondPrice"]; !ok {
				if config, exists := secondPrices[normalized]; exists {
					pricing["ModelSecondPrice"] = config
				}
			}
			if err := ConvertPerSecondPricing(pricing); err != nil {
				return fmt.Errorf("migrate per-second pricing for %s: %w", name, err)
			}
			replaceModelPricing(values, name, pricing)
		}
		for _, key := range []string{"billing_setting.billing_expr", "billing_setting.billing_mode", "ModelSecondPrice"} {
			encoded, err := common.Marshal(values[key])
			if err != nil {
				return err
			}
			row := Option{Key: key, Value: string(encoded)}
			if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoUpdates: clause.AssignmentColumns([]string{"value"})}).Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
