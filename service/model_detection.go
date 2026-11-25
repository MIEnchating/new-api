package service

import (
	"bytes"
	"context"
	"crypto/subtle"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/console_setting"
)

const (
	modelDetectionTimeout   = 4 * time.Minute
	modelDetectionBodyLimit = 2 << 20
)

var modelDetectionSlots = make(chan struct{}, 2)

var (
	ErrModelDetectionInput       = errors.New("invalid model detection input")
	ErrModelDetectionUnavailable = errors.New("model detection command is unavailable")
	ErrModelDetectionBusy        = errors.New("model detection is busy")
	ErrModelDetectionFailed      = errors.New("model detection command failed")
)

const (
	ModelDetectionChatEndpoint      = "/v1/chat/completions"
	ModelDetectionResponsesEndpoint = "/v1/responses"
	ModelDetectionMessagesEndpoint  = "/v1/messages"
)

type ModelDetectionRequest struct {
	Endpoint       string `json:"endpoint"`
	APIURL         string `json:"api_url"`
	APIKey         string `json:"api_key"`
	Group          string `json:"group"`
	Model          string `json:"model"`
	Mode           string `json:"mode"`
	Effort         string `json:"effort"`
	ServiceTier    string `json:"service_tier"`
	Parallel       *bool  `json:"parallel"`
	ChallengeToken string `json:"challenge_token"`
	Stream         *bool  `json:"stream"`
	Image          bool   `json:"image"`
	Tokenizer      bool   `json:"tokenizer"`
	Strict         bool   `json:"strict"`
}

type ModelDetectionChallenge struct {
	ID            string `json:"id"`
	Prompt        string `json:"prompt"`
	ExpectedCount int    `json:"expected_count"`
}

type modelDetectionCandidate struct {
	Model       string   `json:"model"`
	DisplayName string   `json:"display_name"`
	FamilyName  string   `json:"family_name,omitempty"`
	Probability *float64 `json:"probability"`
}

type modelDetectionAnalysis struct {
	Results []modelDetectionCandidate `json:"results"`
}

type modelDetectionSample struct {
	State         string                          `json:"state"`
	Text          string                          `json:"text"`
	Count         int                             `json:"count"`
	ExpectedCount int                             `json:"expectedCount"`
	StartedAt     *int64                          `json:"startedAt,omitempty"`
	FinishedAt    *int64                          `json:"finishedAt,omitempty"`
	Throughput    *modelDetectionSampleThroughput `json:"throughput,omitempty"`
}

type modelDetectionSampleThroughput struct {
	TTFTMs          float64  `json:"ttftMs"`
	TokensPerSecond *float64 `json:"tokensPerSecond,omitempty"`
	Estimated       bool     `json:"estimated,omitempty"`
}

type modelDetectionRound struct {
	Challenges []ModelDetectionChallenge `json:"challenges"`
	Samples    []modelDetectionSample    `json:"samples"`
	Analysis   *modelDetectionAnalysis   `json:"analysis"`
}

type modelDetectionTokenizerClass struct {
	ID      string   `json:"id"`
	Series  string   `json:"series,omitempty"`
	LabName string   `json:"lab_name,omitempty"`
	Exact   *float64 `json:"exact,omitempty"`
}

type modelDetectionTokenizerStep struct {
	Probe         *string `json:"probe"`
	State         string  `json:"state"`
	Tokens        *int    `json:"tokens,omitempty"`
	ResponseModel string  `json:"responseModel,omitempty"`
	Category      string  `json:"category,omitempty"`
	Text          string  `json:"text,omitempty"`
}

type modelDetectionTokenizer struct {
	Verdict *struct {
		Kind       string                       `json:"kind"`
		Confidence float64                      `json:"confidence"`
		Top        modelDetectionTokenizerClass `json:"top"`
		Claim      *struct {
			Status   string   `json:"status"`
			Vendor   string   `json:"vendor,omitempty"`
			Expected []string `json:"expected,omitempty"`
		} `json:"claim"`
	} `json:"verdict"`
	BaselineDrift bool                           `json:"baseline_drift"`
	Cancelled     bool                           `json:"cancelled,omitempty"`
	Classes       []modelDetectionTokenizerClass `json:"classes,omitempty"`
	Steps         []modelDetectionTokenizerStep  `json:"steps,omitempty"`
	Unknown       *float64                       `json:"unknown,omitempty"`
	DurationMS    *int64                         `json:"duration_ms,omitempty"`
	Bank          *struct {
		Classes int `json:"classes"`
	} `json:"bank,omitempty"`
}

type ModelDetectionResult struct {
	Rounds         []modelDetectionRound    `json:"rounds"`
	Tokenizer      *modelDetectionTokenizer `json:"tokenizer"`
	UpstreamStatus int                      `json:"upstream_status,omitempty"`
}

func (input ModelDetectionRequest) Validate() error {
	if strings.TrimSpace(input.Model) != input.Model || input.Model == "" || len(input.Model) > 255 ||
		strings.TrimSpace(input.Group) != input.Group || input.Group == "" || len(input.Group) > 255 ||
		strings.ContainsAny(input.Model+input.Group, "\r\n\x00") || input.protocol() == "" ||
		len(input.APIURL) > 500 || len(input.APIKey) > 256 || strings.ContainsAny(input.APIKey, "\r\n\x00") ||
		(input.APIURL == "") != (input.APIKey == "") {
		return ErrModelDetectionInput
	}
	switch input.Effort {
	case "", "low", "medium", "high":
	default:
		return ErrModelDetectionInput
	}
	switch input.ServiceTier {
	case "", "flex", "fast", "ultrafast":
	default:
		return ErrModelDetectionInput
	}
	switch input.Mode {
	case "detect":
	case "tokenizer":
		if input.Image || input.Tokenizer || input.Strict {
			return ErrModelDetectionInput
		}
	default:
		return ErrModelDetectionInput
	}
	return nil
}

// ModelDetectionAPIAddress resolves a configured API Info entry to the chosen protocol.
// The submitted value selects an administrator-configured URL, never an arbitrary target.
func ModelDetectionAPIAddress(address, endpoint string) (*url.URL, error) {
	if !console_setting.GetConsoleSetting().ApiInfoEnabled || common.TLSInsecureSkipVerify {
		return nil, ErrModelDetectionInput
	}
	for _, item := range console_setting.GetApiInfo() {
		configured, _ := item["url"].(string)
		configured = strings.TrimRight(strings.TrimSpace(configured), "/")
		if address == "" || address != configured {
			continue
		}
		target, err := url.Parse(configured)
		if err != nil || target.Scheme != "https" || target.Hostname() == "" || target.User != nil ||
			target.RawQuery != "" || target.ForceQuery || target.Fragment != "" || target.RawPath != "" {
			break
		}
		basePath := target.Path
		for _, path := range []string{ModelDetectionChatEndpoint, ModelDetectionResponsesEndpoint, ModelDetectionMessagesEndpoint} {
			if prefix, found := strings.CutSuffix(basePath, strings.TrimPrefix(path, "/v1")); found {
				basePath = prefix
				break
			}
		}
		if basePath == "" {
			basePath = "/v1"
		}
		target.Path = basePath + strings.TrimPrefix(endpoint, "/v1")
		return target, nil
	}
	return nil, ErrModelDetectionInput
}

// ModelDetectionAddressRelay forwards the CLI probes to an approved address.
// ReverseProxy uses RoundTrip directly so a redirect cannot forward the API key.
func ModelDetectionAddressRelay(target *url.URL, key string, endpoint string) http.Handler {
	return &httputil.ReverseProxy{
		Transport: GetSSRFProtectedHTTPClient().Transport,
		Rewrite: func(request *httputil.ProxyRequest) {
			address := *target
			request.Out.URL = &address
			request.Out.Host = target.Host
			if endpoint == ModelDetectionMessagesEndpoint {
				request.Out.Header.Set("X-Api-Key", key)
			} else {
				request.Out.Header.Set("Authorization", "Bearer "+key)
			}
		},
		ModifyResponse: func(response *http.Response) error {
			// The CLI must not receive or follow a redirect either.
			if response.StatusCode >= 300 && response.StatusCode < 400 {
				return ErrModelDetectionFailed
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
			w.WriteHeader(http.StatusBadGateway)
		},
	}
}

func (input ModelDetectionRequest) protocol() string {
	switch input.Endpoint {
	case ModelDetectionChatEndpoint:
		return "chatcompletion"
	case ModelDetectionResponsesEndpoint:
		return "responses"
	case ModelDetectionMessagesEndpoint:
		return "message"
	default:
		return ""
	}
}

// PrepareModelDetectionChallenges reads the CLI's own generated challenges.
// Fixture responses end the round locally without contacting or billing a model.
func PrepareModelDetectionChallenges(ctx context.Context) ([]ModelDetectionChallenge, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	result, err := RunModelDetection(ctx, ModelDetectionRequest{
		Endpoint: ModelDetectionChatEndpoint, Group: "local", Model: "model-detection-preview",
		Mode: "detect", Stream: common.GetPointer(false),
	}, nil, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "challenge preview", http.StatusBadRequest)
	}))
	if err != nil {
		return nil, err
	}
	if len(result.Rounds) != 1 || len(result.Rounds[0].Challenges) != 3 {
		return nil, ErrModelDetectionFailed
	}
	return result.Rounds[0].Challenges, nil
}

func RunModelDetection(ctx context.Context, input ModelDetectionRequest, challenges []ModelDetectionChallenge, relay http.Handler) (*ModelDetectionResult, error) {
	if err := input.Validate(); err != nil {
		return nil, err
	}
	path := os.Getenv("MODEL_DETECTION_CLI_PATH")
	if path == "" {
		path = "fpd"
	}
	executable, err := exec.LookPath(path)
	if err != nil {
		return nil, ErrModelDetectionUnavailable
	}
	select {
	case modelDetectionSlots <- struct{}{}:
		defer func() { <-modelDetectionSlots }()
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
		return nil, ErrModelDetectionBusy
	}

	return runModelDetectionCommand(ctx, executable, input, challenges, relay)
}

func runModelDetectionCommand(ctx context.Context, executable string, input ModelDetectionRequest, challenges []ModelDetectionChallenge, relay http.Handler) (*ModelDetectionResult, error) {
	ctx, cancel := context.WithTimeout(ctx, modelDetectionTimeout)
	defer cancel()

	args := []string{input.Mode, "--json", "--api", input.protocol(), "--timeout", "60"}
	if input.Mode == "detect" {
		args = append(args, "--no-update-check")
		if len(challenges) > 0 {
			data, err := common.Marshal(challenges)
			if err != nil {
				return nil, ErrModelDetectionFailed
			}
			directory, err := os.MkdirTemp("", "model-detection-")
			if err != nil {
				return nil, ErrModelDetectionFailed
			}
			defer os.RemoveAll(directory)
			file := filepath.Join(directory, "challenges.json")
			if err := os.WriteFile(file, data, 0600); err != nil {
				return nil, ErrModelDetectionFailed
			}
			args = append(args, "--challenges", file)
		}
	}
	if input.Image {
		args = append(args, "--image")
	}
	if input.Tokenizer {
		args = append(args, "--tokenizer")
	}
	if input.Strict {
		args = append(args, "--strict")
	}
	if input.Stream != nil && !*input.Stream {
		args = append(args, "--no-stream")
	}
	if input.Effort != "" {
		args = append(args, "--effort="+input.Effort)
	}
	if input.ServiceTier != "" {
		args = append(args, "--service-tier="+input.ServiceTier)
	}
	if input.Parallel != nil && !*input.Parallel {
		args = append(args, "--parallel=1")
	}

	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, ErrModelDetectionFailed
	}
	// Only the CLI can call this run's listener. Relay authentication and
	// group selection are supplied by the host after checking the loopback key.
	loopbackKey := common.GetUUID() + common.GetUUID()
	var upstreamStatus atomic.Int32
	server := &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		MaxHeaderBytes:    16 << 10,
		BaseContext:       func(net.Listener) context.Context { return ctx },
		Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			key := strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")
			if input.Endpoint == ModelDetectionMessagesEndpoint {
				key = request.Header.Get("X-Api-Key")
			}
			if request.Method != http.MethodPost || request.URL.Path != input.Endpoint ||
				subtle.ConstantTimeCompare([]byte(key), []byte(loopbackKey)) != 1 {
				http.NotFound(writer, request)
				return
			}
			anthropicBeta := request.Header.Get("Anthropic-Beta")
			request.Header = http.Header{"Content-Type": {"application/json"}}
			if input.Endpoint == ModelDetectionMessagesEndpoint {
				request.Header.Set("Anthropic-Version", "2023-06-01")
				if anthropicBeta != "" {
					request.Header.Set("Anthropic-Beta", anthropicBeta)
				}
			}
			request.Body = http.MaxBytesReader(writer, request.Body, modelDetectionBodyLimit)
			relayCtx, cancel := context.WithCancel(request.Context())
			defer cancel()
			relay.ServeHTTP(&modelDetectionRelayWriter{
				ResponseWriter: writer, upstreamStatus: &upstreamStatus,
				remaining: modelDetectionBodyLimit, cancel: cancel,
			}, request.WithContext(relayCtx))
		}),
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = server.Serve(listener)
	}()
	defer func() {
		_ = listener.Close()
		_ = server.Close()
		<-done
	}()

	command := exec.CommandContext(ctx, executable, args...)
	command.Env = []string{
		"PATH=" + os.Getenv("PATH"), "MODEL=" + input.Model,
		"API_KEY=" + loopbackKey, "BASE_URL=http://" + listener.Addr().String() + "/v1",
		"FPD_NO_UPDATE_CHECK=1",
	}
	command.WaitDelay = time.Second
	command.Stderr = io.Discard
	var stdout modelDetectionOutput
	command.Stdout = &stdout
	started := time.Now()
	runErr := command.Run()
	elapsed := time.Since(started).Milliseconds()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if runErr != nil {
		var exitErr *exec.ExitError
		if !errors.As(runErr, &exitErr) || exitErr.ExitCode() != 1 {
			return nil, ErrModelDetectionFailed
		}
	}

	result := ModelDetectionResult{UpstreamStatus: int(upstreamStatus.Load())}
	var report struct {
		Schema string `json:"schema"`
		ModelDetectionResult
	}
	if err := common.Unmarshal(stdout.Bytes(), &report); err != nil {
		return nil, ErrModelDetectionFailed
	}
	if input.Mode == "tokenizer" && report.Schema == "fpd-tokenizer-v1" {
		result.Tokenizer = &modelDetectionTokenizer{}
		if err := common.Unmarshal(stdout.Bytes(), result.Tokenizer); err != nil {
			return nil, ErrModelDetectionFailed
		}
		result.Tokenizer.DurationMS = &elapsed
		result.Tokenizer.addReferenceDetails(executable, strings.TrimPrefix(input.APIKey, "sk-"), loopbackKey)
		return &result, nil
	}
	if input.Mode != "detect" || report.Schema != "fpd-detection-v1" || len(report.Rounds) == 0 {
		return nil, ErrModelDetectionFailed
	}
	key := strings.TrimPrefix(input.APIKey, "sk-")
	for i := range report.Rounds {
		for j := range report.Rounds[i].Samples {
			sample := &report.Rounds[i].Samples[j]
			if key != "" {
				sample.Text = strings.ReplaceAll(sample.Text, key, "[redacted]")
			}
			if len(sample.Text) > 6000 {
				sample.Text = strings.ToValidUTF8(sample.Text[:6000], "")
			}
		}
	}
	result.Rounds, result.Tokenizer = report.Rounds, report.Tokenizer
	if result.Tokenizer != nil {
		result.Tokenizer.addReferenceDetails(executable, key, loopbackKey)
	}
	return &result, nil
}

func (report *modelDetectionTokenizer) addReferenceDetails(executable, userKey, loopbackKey string) {
	for i := range report.Steps {
		step := &report.Steps[i]
		if len(step.ResponseModel) > 255 || strings.Contains(step.ResponseModel, loopbackKey) ||
			(userKey != "" && strings.Contains(step.ResponseModel, userKey)) {
			step.ResponseModel = ""
		}
	}
	resolved, err := filepath.EvalSymlinks(executable)
	if err != nil {
		return
	}
	// Read display metadata from the same installed CLI package that produced the report.
	file, err := os.Open(filepath.Join(filepath.Dir(resolved), "..", "data", "tokenizer_bank.json"))
	if err != nil {
		return
	}
	defer file.Close()
	var bank struct {
		Classes []modelDetectionTokenizerClass `json:"classes"`
		Probes  []struct {
			ID       string `json:"id"`
			Category string `json:"category"`
			Text     string `json:"text"`
		} `json:"probes"`
	}
	if common.DecodeJson(io.LimitReader(file, 1<<20), &bank) != nil {
		return
	}
	classes := make(map[string]modelDetectionTokenizerClass, len(bank.Classes))
	for _, class := range bank.Classes {
		classes[class.ID] = class
	}
	for i := range report.Classes {
		class := &report.Classes[i]
		details := classes[class.ID]
		class.Series, class.LabName = details.Series, details.LabName
	}
	if report.Verdict != nil {
		top := &report.Verdict.Top
		details := classes[top.ID]
		top.Series, top.LabName = details.Series, details.LabName
		if claim := report.Verdict.Claim; claim != nil {
			for i, id := range claim.Expected {
				if name := classes[id].Series; name != "" {
					claim.Expected[i] = name
				}
			}
		}
	}
	for i := range report.Steps {
		step := &report.Steps[i]
		if step.Probe == nil {
			continue
		}
		for _, probe := range bank.Probes {
			if probe.ID == *step.Probe {
				step.Category, step.Text = probe.Category, probe.Text
				break
			}
		}
	}
}

// Keep the regular relay streaming path while retaining the first HTTP failure
// for the report. Suppress redirects before the CLI receives their headers.
type modelDetectionRelayWriter struct {
	http.ResponseWriter
	upstreamStatus *atomic.Int32
	remaining      int
	cancel         context.CancelFunc
}

func (w *modelDetectionRelayWriter) Write(data []byte) (int, error) {
	if len(data) > w.remaining {
		w.cancel()
		return 0, ErrModelDetectionFailed
	}
	written, err := w.ResponseWriter.Write(data)
	w.remaining -= written
	return written, err
}

func (w *modelDetectionRelayWriter) WriteHeader(status int) {
	if status >= 300 {
		w.upstreamStatus.CompareAndSwap(0, int32(status))
		w.Header().Del("Location")
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *modelDetectionRelayWriter) Flush() {
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}

type modelDetectionOutput struct{ bytes.Buffer }

func (output *modelDetectionOutput) Write(data []byte) (int, error) {
	if len(data) > 8<<20-output.Len() {
		return 0, ErrModelDetectionFailed
	}
	return output.Buffer.Write(data)
}
