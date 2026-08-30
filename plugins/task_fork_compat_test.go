package plugins_test

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func loadBuiltinTaskPlugin(t *testing.T, key string) *jsplugin.LoadedPlugin {
	t.Helper()
	source, err := builtinplugins.Source(key)
	require.NoError(t, err)
	plugin, err := jsplugin.NewRegistry().RegisterFactory(source, jsplugin.Options{Key: key})
	require.NoError(t, err)
	return plugin
}

func pluginMap(t *testing.T, value any) map[string]any {
	t.Helper()
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var result map[string]any
	require.NoError(t, common.Unmarshal(encoded, &result))
	return result
}

func TestMigratedTaskPluginsPreservePerSecondBilling(t *testing.T) {
	tests := []struct {
		key         string
		model       string
		requestBody map[string]any
		seconds     float64
	}{
		{key: "doubao", model: "doubao-seedance-1-0-pro-250528", requestBody: map[string]any{"duration": 10, "metadata": map[string]any{}}, seconds: 10},
		{key: "hailuo", model: "MiniMax-Hailuo-2.3", requestBody: map[string]any{"duration": 10}, seconds: 10},
		{key: "jimeng", model: "jimeng_vgfm_t2v_l20", requestBody: map[string]any{"duration": 10}, seconds: 5},
		{key: "kling", model: "kling-v1-6", requestBody: map[string]any{"duration": 10}, seconds: 10},
		{key: "vidu", model: "vidu2.0", requestBody: map[string]any{"duration": 8}, seconds: 8},
	}

	for _, test := range tests {
		t.Run(test.key, func(t *testing.T) {
			plugin := loadBuiltinTaskPlugin(t, test.key)
			baseContext := map[string]any{
				"requestBody":   test.requestBody,
				"model":         test.model,
				"upstreamModel": test.model,
				"usagePurpose":  "billing_ratios",
			}
			value, err := plugin.Engine.Call(t.Context(), "extractUsage", baseContext)
			require.NoError(t, err)
			assert.Nil(t, value)

			baseContext["billingMode"] = "per_second"
			value, err = plugin.Engine.Call(t.Context(), "extractUsage", baseContext)
			require.NoError(t, err)
			ratios := pluginMap(t, value)
			assert.Equal(t, test.seconds, ratios["seconds"])
		})
	}
}

func TestVeoPluginsPreserveVeo31FrameAndReferenceInputs(t *testing.T) {
	plugins := []string{"google", "vertex-ai"}
	for _, key := range plugins {
		t.Run(key+" frames", func(t *testing.T) {
			plugin := loadBuiltinTaskPlugin(t, key)
			ctx := map[string]any{
				"baseUrl":       "https://example.com",
				"upstreamModel": "veo-3.1-fast-generate-preview",
				"requestBody": map[string]any{"prompt": "interpolate", "metadata": map[string]any{
					"firstFrame": "data:image/png;base64,Zmlyc3Q=",
					"lastFrame":  "data:image/jpeg;base64,bGFzdA==",
				}},
				"auth":       map[string]any{"projectId": "project"},
				"authHeader": "Bearer token",
			}
			value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", ctx)
			require.NoError(t, err)
			descriptor := pluginMap(t, value)
			body := descriptor["body"].(map[string]any)
			instance := body["instances"].([]any)[0].(map[string]any)
			assert.Equal(t, map[string]any{"bytesBase64Encoded": "Zmlyc3Q=", "mimeType": "image/png"}, instance["image"])
			assert.Equal(t, map[string]any{"bytesBase64Encoded": "bGFzdA==", "mimeType": "image/jpeg"}, instance["lastFrame"])
			parameters := body["parameters"].(map[string]any)
			assert.NotContains(t, parameters, "firstFrame")
			assert.NotContains(t, parameters, "lastFrame")
		})

		t.Run(key+" references", func(t *testing.T) {
			plugin := loadBuiltinTaskPlugin(t, key)
			ctx := map[string]any{
				"baseUrl":       "https://example.com",
				"upstreamModel": "veo-3.1-fast-generate-preview",
				"requestBody": map[string]any{"prompt": "reference", "metadata": map[string]any{
					"referenceImages": []any{"data:image/png;base64,b25l", "data:image/jpeg;base64,dHdv"},
				}},
				"auth":       map[string]any{"projectId": "project"},
				"authHeader": "Bearer token",
			}
			value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", ctx)
			require.NoError(t, err)
			body := pluginMap(t, value)["body"].(map[string]any)
			instance := body["instances"].([]any)[0].(map[string]any)
			references := instance["referenceImages"].([]any)
			require.Len(t, references, 2)
			assert.Equal(t, "asset", references[0].(map[string]any)["referenceType"])
		})
	}
}

func TestVeoPluginsRejectMixedFrameAndReferenceRoles(t *testing.T) {
	for _, key := range []string{"google", "vertex-ai"} {
		plugin := loadBuiltinTaskPlugin(t, key)
		_, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
			"baseUrl":       "https://example.com",
			"upstreamModel": "veo-3.1-fast-generate-preview",
			"requestBody": map[string]any{"prompt": "invalid", "metadata": map[string]any{
				"firstFrame":      "data:image/png;base64,b25l",
				"referenceImages": []any{"data:image/png;base64,dHdv"},
			}},
			"auth":       map[string]any{"projectId": "project"},
			"authHeader": "Bearer token",
		})
		require.ErrorContains(t, err, "Veo frame inputs cannot be combined with referenceImages")
	}
}

func TestSoraPluginPreservesOfficialFieldCleanupAndH3Duration(t *testing.T) {
	plugin := loadBuiltinTaskPlugin(t, "sora")
	value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
		"baseUrl":       "https://api.openai.com",
		"upstreamModel": "sora-2",
		"requestBody": map[string]any{
			"prompt": "waves", "resolution": "1080p", "duration": 8, "generate_audio": true, "watermark": true, "quality": "high",
		},
	})
	require.NoError(t, err)
	body := pluginMap(t, value)["body"].(map[string]any)
	for _, key := range []string{"resolution", "duration", "generate_audio", "watermark", "quality"} {
		assert.NotContains(t, body, key)
	}

	usage, err := plugin.Engine.Call(t.Context(), "extractUsage", map[string]any{
		"upstreamModel": "minimax-h3-video", "requestBody": map[string]any{}, "usagePurpose": "facts",
	})
	require.NoError(t, err)
	assert.Equal(t, float64(5), pluginMap(t, usage)["seconds"])
}
