package model

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

type ModelSecondPriceConfig struct {
	Prices map[string]float64 `json:"prices"`
}

func GetModelSecondPriceConfig(modelName string) (ModelSecondPriceConfig, bool) {
	var configs map[string]ModelSecondPriceConfig
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["ModelSecondPrice"]
	common.OptionMapRWMutex.RUnlock()
	if err := common.UnmarshalJsonStr(raw, &configs); err == nil {
		for _, name := range []string{modelName, ratio_setting.FormatMatchingModelName(modelName)} {
			if config, ok := configs[name]; ok && config.Prices != nil {
				return config, true
			}
		}
	}
	return ModelSecondPriceConfig{}, false
}
