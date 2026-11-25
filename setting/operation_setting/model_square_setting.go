package operation_setting

import (
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

const (
	ModelSquareOptionPrefix = "model_square_setting."
	ModelSquareSortVendor   = "vendor"
	ModelSquareSortManual   = "manual"
	ModelSquareSortUsage    = "usage"
	ModelSquareSortMixed    = "mixed"

	ModelSquareMetricRequests = "requests"
	ModelSquareMetricTokens   = "tokens"
)

// ModelSquareSetting holds the Recommended order of the model square.
type ModelSquareSetting struct {
	SortMode   string   `json:"sort_mode"`   // vendor, manual, usage or mixed
	SortMetric string   `json:"sort_metric"` // usage metric: requests or tokens
	SortDays   int      `json:"sort_days"`   // usage period in days: 1, 7 or 30
	SortModels []string `json:"sort_models"` // manual order, or the pinned models in mixed mode
}

// Preserve the existing vendor order until an administrator chooses another default.
var defaultModelSquareSetting = ModelSquareSetting{
	SortMode:   ModelSquareSortVendor,
	SortMetric: ModelSquareMetricTokens,
	SortDays:   7,
	SortModels: []string{},
}

func init() {
	config.GlobalConfig.Register("model_square_setting", &defaultModelSquareSetting)
}

func GetModelSquareSetting() ModelSquareSetting {
	values := make(map[string]string, 4)
	common.OptionMapRWMutex.RLock()
	for _, name := range []string{"sort_mode", "sort_metric", "sort_days", "sort_models"} {
		if value, ok := common.OptionMap[ModelSquareOptionPrefix+name]; ok {
			values[name] = value
		}
	}
	common.OptionMapRWMutex.RUnlock()

	setting := defaultModelSquareSetting
	for name, value := range values {
		if ValidateModelSquareOption(ModelSquareOptionPrefix+name, value) != nil {
			delete(values, name)
		}
	}
	_ = config.UpdateConfigFromMap(&setting, values)
	return setting
}

// ValidateModelSquareOption rejects model square order values the square cannot use.
func ValidateModelSquareOption(key, value string) error {
	setting, ok := strings.CutPrefix(key, ModelSquareOptionPrefix)
	if !ok {
		return nil
	}
	valid := false
	switch setting {
	case "sort_mode":
		valid = slices.Contains([]string{ModelSquareSortVendor, ModelSquareSortManual, ModelSquareSortUsage, ModelSquareSortMixed}, value)
	case "sort_metric":
		valid = value == ModelSquareMetricRequests || value == ModelSquareMetricTokens
	case "sort_days":
		valid = slices.Contains([]string{"1", "7", "30"}, value)
	case "sort_models":
		var names []string
		valid = common.UnmarshalJsonStr(value, &names) == nil
	}
	if !valid {
		return common.NewMessage("Invalid model square order setting")
	}
	return nil
}
