package operation_setting

import (
	"maps"
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func preserveToolPrices(t *testing.T) {
	t.Helper()
	original := make(map[string]float64, len(toolPriceSetting.Prices))
	maps.Copy(original, toolPriceSetting.Prices)
	originalExchangeRate := USDExchangeRate
	t.Cleanup(func() {
		toolPriceSetting.Prices = original
		USDExchangeRate = originalExchangeRate
		RebuildToolPriceIndex()
	})
}

func TestToolPriceHardcodedFallbacksSurviveMissingOperatorConfig(t *testing.T) {
	preserveToolPrices(t)
	USDExchangeRate = 7.3
	toolPriceSetting.Prices = map[string]float64{}
	RebuildToolPriceIndex()

	tests := []struct {
		tool  string
		model string
		want  float64
	}{
		{"web_search", "", 10},
		{"web_search_preview", "", 10},
		{"file_search", "", 2.5},
		{"google_search", "", 14},
		{"image_generation", "", 150},
		{"web_search_preview", "gpt-4o-2024-11-20", 25},
		{"web_search_preview", "gpt-4.1-mini", 25},
		// Gemini 3 bills each search query; 2.5 and older bill the grounded prompt.
		{"google_search", "gemini-3.7-flash", 14},
		{"google_search_grounded_prompt", "gemini-3.7-flash", 0},
		{"google_search", "gemini-2.5-flash", 0},
		{"google_search_grounded_prompt", "gemini-2.5-flash", 35},
		// Vendor search tiers are listed in CNY and converted to USD for billing.
		{"search_std", "", 10 / 7.3},
		{"search_pro", "", 30 / 7.3},
		{"search_pro_sogou", "", 50 / 7.3},
		{"search_pro_quark", "", 50 / 7.3},
		{"search_strategy_turbo", "", 3 / 7.3},
		{"search_strategy_max", "", 4 / 7.3},
		{"search_strategy_agent", "", 4 / 7.3},
		{"search_strategy_agent_max", "", 4 / 7.3},
		{"bing_web_search", "", 14},
		{"web_search", "grok-4", 5},
		{"x_search_posts", "", 5},
		{"x_search_profiles", "", 10},
	}
	for _, tt := range tests {
		assert.InDelta(t, tt.want, GetToolPriceForModel(tt.tool, tt.model), 1e-12, "%s for %q", tt.tool, tt.model)
	}
	assert.True(t, IsBuiltInToolPriceKey("bing_web_search"))
	assert.True(t, IsBuiltInToolPriceKey("google_search_grounded_prompt"), "seeded only for model prefixes")
}

func TestToolPriceCurrencyConversionAndOverrides(t *testing.T) {
	preserveToolPrices(t)
	USDExchangeRate = 5
	toolPriceSetting.Prices = map[string]float64{
		"search_std":            2,
		"search_strategy_turbo": 0,
	}
	RebuildToolPriceIndex()

	assert.Equal(t, 2.0, GetToolPrice("search_std"), "operator values are already USD")
	assert.Equal(t, 0.0, GetToolPrice("search_strategy_turbo"), "explicit zero disables a built-in price")
	assert.Equal(t, 6.0, GetToolPrice("search_pro"), "built-in CNY prices use the configured exchange rate")
	assert.Equal(t, 14.0, GetToolPrice("bing_web_search"), "USD built-ins are not converted")

	USDExchangeRate = 0
	assert.Equal(t, 0.0, GetToolPrice("search_pro"), "invalid exchange rates must not charge CNY built-ins")
}

func TestToolPriceOperatorOverridePrecedenceAndExplicitZero(t *testing.T) {
	preserveToolPrices(t)
	toolPriceSetting.Prices = map[string]float64{
		"image_generation":                 0,
		"web_search":                       12,
		"web_search_preview":               0,
		"web_search_preview:gpt-4o*":       30,
		"web_search_preview:gpt-4o-mini*":  0,
		"web_search_preview:custom-model*": 7,
	}
	RebuildToolPriceIndex()

	assert.Equal(t, 0.0, GetToolPrice("image_generation"))
	assert.Equal(t, 12.0, GetToolPrice("web_search"))
	assert.Equal(t, 0.0, GetToolPriceForModel("web_search_preview", "o1"))
	assert.Equal(t, 30.0, GetToolPriceForModel("web_search_preview", "gpt-4o"))
	assert.Equal(t, 0.0, GetToolPriceForModel("web_search_preview", "gpt-4o-mini"))
	assert.Equal(t, 25.0, GetToolPriceForModel("web_search_preview", "gpt-4.1"))
	assert.Equal(t, 7.0, GetToolPriceForModel("web_search_preview", "custom-model-v2"))

	delete(toolPriceSetting.Prices, "web_search_preview:gpt-4o*")
	RebuildToolPriceIndex()
	assert.Equal(t, 25.0, GetToolPriceForModel("web_search_preview", "gpt-4o"))

	delete(toolPriceSetting.Prices, "web_search")
	RebuildToolPriceIndex()
	assert.Equal(t, 10.0, GetToolPrice("web_search"))
}

func TestToolPriceCustomFunctionHasNoHardcodedFallback(t *testing.T) {
	preserveToolPrices(t)
	toolPriceSetting.Prices = map[string]float64{}
	RebuildToolPriceIndex()

	assert.Equal(t, 0.0, GetToolPrice("lookup_customer"))

	toolPriceSetting.Prices["lookup_customer"] = 5
	RebuildToolPriceIndex()
	assert.Equal(t, 5.0, GetToolPrice("lookup_customer"))
	assert.False(t, IsBuiltInToolPriceKey("lookup_customer"), "an operator price is not a built-in key")

	toolPriceSetting.Prices["lookup_customer"] = 0
	RebuildToolPriceIndex()
	assert.Equal(t, 0.0, GetToolPrice("lookup_customer"))
}

func TestValidateToolPricesJSON(t *testing.T) {
	valid := []string{
		`{}`,
		`{"web_search":0}`,
		`{"web_search":10,"custom_fn":2.5}`,
	}
	for _, value := range valid {
		assert.NoError(t, ValidateToolPricesJSON(value), value)
	}

	invalid := []string{
		`null`,
		`[]`,
		`{"web_search":null}`,
		`{"web_search":true}`,
		`{"web_search":"0"}`,
		`{"web_search":-1}`,
		`{"web_search":1e999}`,
		`{"web_search":`,
	}
	for _, value := range invalid {
		assert.Error(t, ValidateToolPricesJSON(value), value)
	}
}

func TestLoadToolPricesFromJSONStringReplacesMapAndKeepsValidSiblings(t *testing.T) {
	preserveToolPrices(t)

	LoadToolPricesFromJSONString(`{
		"web_search": 0,
		"custom_fn": 3,
		"file_search": null,
		"google_search": -1,
		"image_generation": "0"
	}`)

	require.Len(t, toolPriceSetting.Prices, 2)
	assert.Equal(t, 0.0, toolPriceSetting.Prices["web_search"])
	assert.Equal(t, 3.0, toolPriceSetting.Prices["custom_fn"])
	assert.Equal(t, 0.0, GetToolPrice("web_search"))
	assert.Equal(t, 3.0, GetToolPrice("custom_fn"))
	assert.Equal(t, 2.5, GetToolPrice("file_search"))
	assert.Equal(t, 14.0, GetToolPrice("google_search"))
	assert.Equal(t, 150.0, GetToolPrice("image_generation"))

	LoadToolPricesFromJSONString(`{"image_generation":0}`)
	require.Len(t, toolPriceSetting.Prices, 1)
	assert.NotContains(t, toolPriceSetting.Prices, "web_search")
	assert.NotContains(t, toolPriceSetting.Prices, "custom_fn")
	assert.Equal(t, 10.0, GetToolPrice("web_search"))
	assert.Equal(t, 0.0, GetToolPrice("custom_fn"))
	assert.Equal(t, 0.0, GetToolPrice("image_generation"))
}

func TestRebuildToolPriceIndexIgnoresInvalidDirectValues(t *testing.T) {
	preserveToolPrices(t)
	toolPriceSetting.Prices = map[string]float64{
		"web_search":       -1,
		"file_search":      math.Inf(1),
		"image_generation": math.NaN(),
		"custom_fn":        math.NaN(),
	}
	RebuildToolPriceIndex()

	assert.Equal(t, 10.0, GetToolPrice("web_search"))
	assert.Equal(t, 2.5, GetToolPrice("file_search"))
	assert.Equal(t, 150.0, GetToolPrice("image_generation"))
	assert.Equal(t, 0.0, GetToolPrice("custom_fn"))
}
