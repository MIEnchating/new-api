package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestModelDetectionSettingsOnlyAcceptSiteEndpoints(t *testing.T) {
	input := ModelDetectionRequest{
		Endpoint: ModelDetectionChatEndpoint, Group: "default", Model: "fixture", Mode: "detect",
	}
	require.NoError(t, input.Validate())
	for _, endpoint := range []string{"https://external.example/v1/messages", "/v1/models", "/v1/responses?key=value"} {
		invalid := input
		invalid.Endpoint = endpoint
		require.ErrorIs(t, invalid.Validate(), ErrModelDetectionInput)
	}
	input.Effort = "medium"
	require.NoError(t, input.Validate())
	input.Effort = "unbounded"
	require.ErrorIs(t, input.Validate(), ErrModelDetectionInput)
	input.Effort, input.ServiceTier = "medium", "priority"
	require.ErrorIs(t, input.Validate(), ErrModelDetectionInput)
	input.ServiceTier = "fast"
	require.NoError(t, input.Validate())
	input.APIURL = "https://detector.example"
	require.ErrorIs(t, input.Validate(), ErrModelDetectionInput)
}

func TestModelDetectionMissingCLI(t *testing.T) {
	t.Setenv("MODEL_DETECTION_CLI_PATH", t.TempDir()+"/fpd")
	_, err := RunModelDetection(t.Context(), ModelDetectionRequest{
		Endpoint: ModelDetectionResponsesEndpoint, Group: "default", Mode: "detect", Model: "fixture",
	}, nil, http.NotFoundHandler())
	require.ErrorIs(t, err, ErrModelDetectionUnavailable)
}

func TestModelDetectionCLI(t *testing.T) {
	executable := os.Getenv("MODEL_DETECTION_TEST_CLI_PATH")
	if executable == "" {
		t.Skip("set MODEL_DETECTION_TEST_CLI_PATH to the pinned fpd executable")
	}
	t.Setenv("MODEL_DETECTION_CLI_PATH", executable)
	challenges, err := PrepareModelDetectionChallenges(t.Context())
	require.NoError(t, err)
	require.Len(t, challenges, 3)
	for _, challenge := range challenges {
		assert.NotEmpty(t, challenge.ID)
		assert.NotEmpty(t, challenge.Prompt)
		assert.Positive(t, challenge.ExpectedCount)
	}

	sample := make([]string, 335)
	for i := range sample {
		sample[i] = strconv.Itoa(1 + (i/2*37)%155 + i%2*190)
	}
	text := strings.Join(sample, ", ")
	input := ModelDetectionRequest{
		Endpoint: ModelDetectionChatEndpoint, Group: "default",
		Model: "fixture-model", Effort: "low", Stream: common.GetPointer(false),
	}

	t.Run("probes the configured HTTPS address with the selected protocol and service tier", func(t *testing.T) {
		const key = "sk-detection-fixture"
		var requests atomic.Int32
		var redirect atomic.Bool
		address := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
			requests.Add(1)
			assert.Equal(t, "/gateway/v1/chat/completions", request.URL.Path)
			assert.Equal(t, "Bearer "+key, request.Header.Get("Authorization"))
			assert.Empty(t, request.Header.Get("Cookie"))
			var body struct {
				Model       string `json:"model"`
				ServiceTier string `json:"service_tier"`
			}
			assert.NoError(t, common.DecodeJson(request.Body, &body))
			assert.Equal(t, input.Model, body.Model)
			assert.Equal(t, "fast", body.ServiceTier)
			if redirect.Load() {
				http.Redirect(w, request, "https://"+request.Host+"/other", http.StatusTemporaryRedirect)
				return
			}
			payload, err := common.Marshal(map[string]any{
				"id": "fixture", "model": input.Model,
				"choices": []any{map[string]any{
					"message": map[string]string{"content": text}, "finish_reason": "stop",
				}},
			})
			assert.NoError(t, err)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(payload)
		}))
		t.Cleanup(address.Close)
		config := console_setting.GetConsoleSetting()
		fetch := system_setting.GetFetchSetting()
		oldConfig, oldFetch, oldHTTP := *config, *fetch, ssrfProtectedHTTPClient
		t.Cleanup(func() { *config, *fetch, ssrfProtectedHTTPClient = oldConfig, oldFetch, oldHTTP })
		config.ApiInfoEnabled = true
		config.ApiInfo = fmt.Sprintf(`[{"url":%q},{"url":"http://unsecured.example"}]`, address.URL+"/gateway/v1/")
		fetch.EnableSSRFProtection = true
		ssrfProtectedHTTPClient = address.Client()
		input := input
		input.Mode, input.ServiceTier, input.Parallel = "detect", "fast", common.GetPointer(false)
		input.APIURL, input.APIKey = address.URL+"/gateway/v1", key
		for _, rejected := range []string{address.URL, "http://unsecured.example"} {
			_, err := ModelDetectionAPIAddress(rejected, input.Endpoint)
			require.ErrorIs(t, err, ErrModelDetectionInput)
		}
		target, err := ModelDetectionAPIAddress(input.APIURL, input.Endpoint)
		require.NoError(t, err)
		result, err := RunModelDetection(t.Context(), input, challenges, ModelDetectionAddressRelay(target, input.APIKey, input.Endpoint))
		require.NoError(t, err)
		assert.Zero(t, result.UpstreamStatus)
		require.Len(t, result.Rounds, 1)
		require.Len(t, result.Rounds[0].Samples, 3)
		assert.NotEmpty(t, result.Rounds[0].Samples[0].Text)
		assert.Nil(t, result.Rounds[0].Samples[0].Throughput, "non-streamed samples have no first-token rate")
		assert.EqualValues(t, 3, requests.Load())

		redirect.Store(true)
		result, err = RunModelDetection(t.Context(), input, challenges, ModelDetectionAddressRelay(target, input.APIKey, input.Endpoint))
		require.NoError(t, err)
		assert.Equal(t, http.StatusBadGateway, result.UpstreamStatus)
		assert.EqualValues(t, 6, requests.Load())
	})

	t.Run("image mode uses the prepared prompts and tokenizer still sends text probes", func(t *testing.T) {
		input := input
		input.Mode, input.Image, input.Tokenizer = "detect", true, true
		var imageCalls, textCalls atomic.Int32
		relay := http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
			assert.Equal(t, input.Endpoint, request.URL.Path)
			assert.Empty(t, request.Header.Get("Authorization"))
			assert.Empty(t, request.Header.Get("Cookie"))
			var body struct {
				Model    string                  `json:"model"`
				Effort   string                  `json:"reasoning_effort"`
				Stream   bool                    `json:"stream"`
				Messages []struct{ Content any } `json:"messages"`
			}
			if err := common.DecodeJson(request.Body, &body); err != nil || len(body.Messages) == 0 {
				t.Errorf("invalid CLI body: %v", err)
				http.Error(w, "invalid fixture body", http.StatusBadRequest)
				return
			}
			assert.Equal(t, input.Model, body.Model)
			assert.Equal(t, "low", body.Effort)
			assert.False(t, body.Stream)
			switch value := body.Messages[0].Content.(type) {
			case []any:
				imageCalls.Add(1)
				encoded, err := common.Marshal(value)
				assert.NoError(t, err)
				assert.Contains(t, string(encoded), "data:image/png;base64,iVBORw0KGgo")
			case string:
				textCalls.Add(1)
			default:
				t.Errorf("unexpected prompt content type %T", value)
			}
			payload, err := common.Marshal(map[string]any{
				"id": "fixture", "model": input.Model,
				"choices": []any{map[string]any{
					"message": map[string]string{"content": text}, "finish_reason": "stop",
				}},
				"usage": map[string]int{"prompt_tokens": 15, "completion_tokens": 335, "total_tokens": 350},
			})
			assert.NoError(t, err)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(payload)
		})

		result, err := RunModelDetection(t.Context(), input, challenges, relay)
		require.NoError(t, err)
		require.Len(t, result.Rounds, 1)
		assert.Equal(t, challenges, result.Rounds[0].Challenges)
		require.Len(t, result.Rounds[0].Samples, 3)
		assert.NotEmpty(t, result.Rounds[0].Samples[0].Text)
		require.NotNil(t, result.Rounds[0].Analysis)
		assert.NotEmpty(t, result.Rounds[0].Analysis.Results)
		require.NotNil(t, result.Tokenizer)
		require.NotNil(t, result.Tokenizer.Verdict)
		assert.NotEmpty(t, result.Tokenizer.Verdict.Top.Series)
		require.NotNil(t, result.Tokenizer.Bank)
		assert.Positive(t, result.Tokenizer.Bank.Classes)
		require.NotEmpty(t, result.Tokenizer.Classes)
		assert.NotEmpty(t, result.Tokenizer.Classes[0].LabName)
		assert.True(t, slices.ContainsFunc(result.Tokenizer.Steps, func(step modelDetectionTokenizerStep) bool {
			return step.Probe != nil && step.Text != "" && step.Category != "" &&
				step.Tokens != nil && *step.Tokens == 15 && step.ResponseModel == input.Model
		}))
		assert.EqualValues(t, 3, imageCalls.Load())
		assert.GreaterOrEqual(t, textCalls.Load(), int32(6))
	})

	t.Run("default detection reads streamed samples", func(t *testing.T) {
		input := input
		input.Mode, input.Stream = "detect", nil
		content, err := common.Marshal(map[string]any{
			"id": "fixture", "model": input.Model,
			"choices": []any{map[string]any{"delta": map[string]string{"content": text}}},
		})
		require.NoError(t, err)
		relay := http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
			var body struct {
				Stream bool `json:"stream"`
			}
			assert.NoError(t, common.DecodeJson(request.Body, &body))
			assert.True(t, body.Stream)
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = fmt.Fprintf(w, "data: %s\n\n", content)
			assert.NoError(t, http.NewResponseController(w).Flush())
			_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
		})
		result, err := RunModelDetection(t.Context(), input, challenges, relay)
		require.NoError(t, err)
		require.Len(t, result.Rounds, 1)
		require.NotNil(t, result.Rounds[0].Analysis)
		assert.NotEmpty(t, result.Rounds[0].Analysis.Results)
		require.Len(t, result.Rounds[0].Samples, 3)
		for _, sample := range result.Rounds[0].Samples {
			require.NotNil(t, sample.StartedAt)
			require.NotNil(t, sample.FinishedAt)
			assert.GreaterOrEqual(t, *sample.FinishedAt, *sample.StartedAt)
			require.NotNil(t, sample.Throughput, "the stream included visible text")
			assert.Nil(t, sample.Throughput.TokensPerSecond, "one text event cannot measure the generation rate")
		}
	})

	t.Run("standalone probe preserves statuses and stops redirects", func(t *testing.T) {
		input := input
		input.Mode, input.Endpoint = "tokenizer", ModelDetectionMessagesEndpoint
		var calls atomic.Int32
		relay := http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
			calls.Add(1)
			assert.Equal(t, input.Endpoint, request.URL.Path)
			assert.Empty(t, request.Header.Get("X-Api-Key"))
			assert.Equal(t, "2023-06-01", request.Header.Get("Anthropic-Version"))
			http.Redirect(w, request, "https://unrelated.example", http.StatusTemporaryRedirect)
		})
		result, err := RunModelDetection(t.Context(), input, nil, relay)
		require.NoError(t, err)
		require.NotNil(t, result.Tokenizer)
		assert.Empty(t, result.Rounds)
		assert.Equal(t, http.StatusTemporaryRedirect, result.UpstreamStatus)
		assert.Positive(t, calls.Load())
		require.NotNil(t, result.Tokenizer.DurationMS)
		require.NotEmpty(t, result.Tokenizer.Steps)
		assert.Equal(t, "failed", result.Tokenizer.Steps[0].State)
		wire, err := common.Marshal(result)
		require.NoError(t, err)
		assert.NotContains(t, string(wire), "unrelated.example")
	})

	t.Run("cancellation stops the CLI before an API request", func(t *testing.T) {
		input := input
		input.Mode = "detect"
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		result, err := RunModelDetection(ctx, input, challenges, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			t.Error("cancelled detector contacted the upstream")
		}))
		require.ErrorIs(t, err, context.Canceled)
		assert.Nil(t, result)
	})
}
