package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

type ModelSecondPriceConfig struct {
	ResolutionField string             `json:"resolution_field,omitempty"`
	DurationField   string             `json:"duration_field,omitempty"`
	Prices          map[string]float64 `json:"prices"`
}

func GetModelSecondPriceConfig(modelName string) (ModelSecondPriceConfig, bool) {
	var configs map[string]ModelSecondPriceConfig
	if err := common.UnmarshalJsonStr(common.OptionMap["ModelSecondPrice"], &configs); err == nil {
		for _, name := range []string{modelName, ratio_setting.FormatMatchingModelName(modelName)} {
			if config, ok := configs[name]; ok && config.Prices != nil {
				return config, true
			}
		}
	}
	return ModelSecondPriceConfig{}, false
}

// GetModelSecondPrice returns the configured absolute USD-per-second price for
// a model and resolution. It intentionally reads the shared option cache so
// model-level pricing edits take effect without changing provider plugins.
func GetModelSecondPrice(modelName, resolution string) (float64, bool) {
	resolution = strings.TrimSpace(strings.ToLower(resolution))
	if resolution == "" {
		return 0, false
	}
	config, ok := GetModelSecondPriceConfig(modelName)
	if !ok {
		return 0, false
	}
	for key, price := range config.Prices {
		if strings.ToLower(strings.TrimSpace(key)) == resolution {
			return price, price >= 0
		}
	}
	return 0, false
}
