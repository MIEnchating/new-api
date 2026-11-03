package dto

import (
	"testing"

	kitutil "github.com/QuantumNous/new-api/relaykit/relayconvert/kitutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGeminiChatGenerationConfigPreservesExplicitZeroValuesCamelCase(t *testing.T) {
	raw := []byte(`{
		"contents":[{"role":"user","parts":[{"text":"hello"}]}],
		"generationConfig":{
			"topP":0,
			"topK":0,
			"maxOutputTokens":0,
			"candidateCount":0,
			"seed":0,
			"responseLogprobs":false
		}
	}`)

	var req GeminiChatRequest
	require.NoError(t, kitutil.Unmarshal(raw, &req))

	encoded, err := kitutil.Marshal(req)
	require.NoError(t, err)

	var out map[string]any
	require.NoError(t, kitutil.Unmarshal(encoded, &out))

	generationConfig, ok := out["generationConfig"].(map[string]any)
	require.True(t, ok)

	assert.Contains(t, generationConfig, "topP")
	assert.Contains(t, generationConfig, "topK")
	assert.Contains(t, generationConfig, "maxOutputTokens")
	assert.Contains(t, generationConfig, "candidateCount")
	assert.Contains(t, generationConfig, "seed")
	assert.Contains(t, generationConfig, "responseLogprobs")

	assert.Equal(t, float64(0), generationConfig["topP"])
	assert.Equal(t, float64(0), generationConfig["topK"])
	assert.Equal(t, float64(0), generationConfig["maxOutputTokens"])
	assert.Equal(t, float64(0), generationConfig["candidateCount"])
	assert.Equal(t, float64(0), generationConfig["seed"])
	assert.Equal(t, false, generationConfig["responseLogprobs"])
}

func TestGeminiChatGenerationConfigPreservesExplicitZeroValuesSnakeCase(t *testing.T) {
	raw := []byte(`{
		"contents":[{"role":"user","parts":[{"text":"hello"}]}],
		"generationConfig":{
			"top_p":0,
			"top_k":0,
			"max_output_tokens":0,
			"candidate_count":0,
			"seed":0,
			"response_logprobs":false
		}
	}`)

	var req GeminiChatRequest
	require.NoError(t, kitutil.Unmarshal(raw, &req))

	encoded, err := kitutil.Marshal(req)
	require.NoError(t, err)

	var out map[string]any
	require.NoError(t, kitutil.Unmarshal(encoded, &out))

	generationConfig, ok := out["generationConfig"].(map[string]any)
	require.True(t, ok)

	assert.Contains(t, generationConfig, "topP")
	assert.Contains(t, generationConfig, "topK")
	assert.Contains(t, generationConfig, "maxOutputTokens")
	assert.Contains(t, generationConfig, "candidateCount")
	assert.Contains(t, generationConfig, "seed")
	assert.Contains(t, generationConfig, "responseLogprobs")

	assert.Equal(t, float64(0), generationConfig["topP"])
	assert.Equal(t, float64(0), generationConfig["topK"])
	assert.Equal(t, float64(0), generationConfig["maxOutputTokens"])
	assert.Equal(t, float64(0), generationConfig["candidateCount"])
	assert.Equal(t, float64(0), generationConfig["seed"])
	assert.Equal(t, false, generationConfig["responseLogprobs"])
}

func TestGeminiArgonFieldsRoundTrip(t *testing.T) {
	for _, raw := range []string{
		`{"continuationToken":{"id":"next"},"contents":[{"parts":[{"mediaProcessing":{"enabled":false}}]}],"generationConfig":{"mediaProcessing":{"fps":0}}}`,
		`{"continuation_token":{"id":"next"},"contents":[{"parts":[{"media_processing":{"enabled":false}}]}],"generationConfig":{"media_processing":{"fps":0}}}`,
	} {
		var request GeminiChatRequest
		require.NoError(t, kitutil.Unmarshal([]byte(raw), &request))
		encoded, err := kitutil.Marshal(request)
		require.NoError(t, err)
		var roundTrip GeminiChatRequest
		require.NoError(t, kitutil.Unmarshal(encoded, &roundTrip))
		assert.JSONEq(t, `{"id":"next"}`, string(roundTrip.ContinuationToken))
		require.Len(t, roundTrip.Contents, 1)
		require.Len(t, roundTrip.Contents[0].Parts, 1)
		assert.JSONEq(t, `{"enabled":false}`, string(roundTrip.Contents[0].Parts[0].MediaProcessing))
		assert.JSONEq(t, `{"fps":0}`, string(roundTrip.GenerationConfig.MediaProcessing))
		assert.NotContains(t, string(encoded), "continuation_token")
		assert.NotContains(t, string(encoded), "media_processing")
	}
}
