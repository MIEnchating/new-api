package operation_setting

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/relaykit/types"
)

type StatusCodeRange struct {
	Start int
	End   int
}

var AutomaticDisableStatusCodeRanges = []StatusCodeRange{{Start: 401, End: 401}}

// Default behavior matches legacy hardcoded retry rules in controller/relay.go shouldRetry:
// retry for 1xx, 3xx, 4xx(except 400/408), 5xx(except 504/524), and no retry for 2xx.
var AutomaticRetryStatusCodeRanges = []StatusCodeRange{
	{Start: 100, End: 199},
	{Start: 300, End: 399},
	{Start: 401, End: 407},
	{Start: 409, End: 499},
	{Start: 500, End: 503},
	{Start: 505, End: 523},
	{Start: 525, End: 599},
}

var alwaysSkipRetryStatusCodes = map[int]struct{}{
	504: {},
	524: {},
}

var alwaysSkipRetryCodes = map[types.ErrorCode]struct{}{
	types.ErrorCodeBadResponseBody: {},
}

var nonRetryableRequestErrorCodes = map[string]struct{}{
	"context_length_exceeded": {},
	"input_too_long":          {},
	"prompt_too_long":         {},
}

var nonRetryableRequestErrorPhrases = []string{
	"exceeds the context window",
	"exceed the context window",
	"maximum context length",
	"context length exceeded",
	"context window exceeded",
	"input is too long",
	"input too long",
	"prompt is too long",
	"prompt too long",
	"上下文长度超出",
	"超出上下文窗口",
	"输入内容过长",
	"提示词过长",
}

func AutomaticDisableStatusCodesToString() string {
	return statusCodeRangesToString(AutomaticDisableStatusCodeRanges)
}

func AutomaticDisableStatusCodesFromString(s string) error {
	ranges, err := ParseHTTPStatusCodeRanges(s)
	if err != nil {
		return err
	}
	AutomaticDisableStatusCodeRanges = ranges
	return nil
}

func ShouldDisableByStatusCode(code int) bool {
	return shouldMatchStatusCodeRanges(AutomaticDisableStatusCodeRanges, code)
}

func AutomaticRetryStatusCodesToString() string {
	return statusCodeRangesToString(AutomaticRetryStatusCodeRanges)
}

func AutomaticRetryStatusCodesFromString(s string) error {
	ranges, err := ParseHTTPStatusCodeRanges(s)
	if err != nil {
		return err
	}
	AutomaticRetryStatusCodeRanges = ranges
	return nil
}

func IsAlwaysSkipRetryStatusCode(code int) bool {
	_, exists := alwaysSkipRetryStatusCodes[code]
	return exists
}

func IsAlwaysSkipRetryCode(errorCode types.ErrorCode) bool {
	_, exists := alwaysSkipRetryCodes[errorCode]
	return exists
}

// IsAlwaysSkipRetryError identifies deterministic request failures that cannot
// recover when the unchanged payload is sent again. Some compatible upstreams
// incorrectly return these errors with a retryable 5xx status, so status-only
// routing would hide the actionable error behind later transport failures.
func IsAlwaysSkipRetryError(err *types.NewAPIError) bool {
	if err == nil {
		return false
	}
	if IsAlwaysSkipRetryCode(err.GetErrorCode()) {
		return true
	}

	values := []string{err.Error(), string(err.GetErrorCode())}
	switch relayErr := err.RelayError.(type) {
	case types.OpenAIError:
		values = append(values, relayErr.Message, relayErr.Type, fmt.Sprint(relayErr.Code))
	case *types.OpenAIError:
		if relayErr != nil {
			values = append(values, relayErr.Message, relayErr.Type, fmt.Sprint(relayErr.Code))
		}
	case types.ClaudeError:
		values = append(values, relayErr.Message, relayErr.Type)
	case *types.ClaudeError:
		if relayErr != nil {
			values = append(values, relayErr.Message, relayErr.Type)
		}
	}

	for _, value := range values {
		normalized := strings.ToLower(strings.TrimSpace(value))
		if _, exists := nonRetryableRequestErrorCodes[normalized]; exists {
			return true
		}
		for _, phrase := range nonRetryableRequestErrorPhrases {
			if strings.Contains(normalized, phrase) {
				return true
			}
		}
	}
	return false
}

func ShouldRetryByStatusCode(code int) bool {
	if IsAlwaysSkipRetryStatusCode(code) {
		return false
	}
	return shouldMatchStatusCodeRanges(AutomaticRetryStatusCodeRanges, code)
}

func statusCodeRangesToString(ranges []StatusCodeRange) string {
	if len(ranges) == 0 {
		return ""
	}
	parts := make([]string, 0, len(ranges))
	for _, r := range ranges {
		if r.Start == r.End {
			parts = append(parts, strconv.Itoa(r.Start))
			continue
		}
		parts = append(parts, fmt.Sprintf("%d-%d", r.Start, r.End))
	}
	return strings.Join(parts, ",")
}

func shouldMatchStatusCodeRanges(ranges []StatusCodeRange, code int) bool {
	if code < 100 || code > 599 {
		return false
	}
	for _, r := range ranges {
		if code < r.Start {
			return false
		}
		if code <= r.End {
			return true
		}
	}
	return false
}

func ParseHTTPStatusCodeRanges(input string) ([]StatusCodeRange, error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return nil, nil
	}

	input = strings.NewReplacer("，", ",").Replace(input)
	segments := strings.Split(input, ",")

	var ranges []StatusCodeRange
	var invalid []string

	for _, seg := range segments {
		seg = strings.TrimSpace(seg)
		if seg == "" {
			continue
		}
		r, err := parseHTTPStatusCodeToken(seg)
		if err != nil {
			invalid = append(invalid, seg)
			continue
		}
		ranges = append(ranges, r)
	}

	if len(invalid) > 0 {
		return nil, fmt.Errorf("invalid http status code rules: %s", strings.Join(invalid, ", "))
	}
	if len(ranges) == 0 {
		return nil, nil
	}

	sort.Slice(ranges, func(i, j int) bool {
		if ranges[i].Start == ranges[j].Start {
			return ranges[i].End < ranges[j].End
		}
		return ranges[i].Start < ranges[j].Start
	})

	merged := []StatusCodeRange{ranges[0]}
	for _, r := range ranges[1:] {
		last := &merged[len(merged)-1]
		if r.Start <= last.End+1 {
			if r.End > last.End {
				last.End = r.End
			}
			continue
		}
		merged = append(merged, r)
	}

	return merged, nil
}

func parseHTTPStatusCodeToken(token string) (StatusCodeRange, error) {
	token = strings.TrimSpace(token)
	token = strings.ReplaceAll(token, " ", "")
	if token == "" {
		return StatusCodeRange{}, fmt.Errorf("empty token")
	}

	if strings.Contains(token, "-") {
		parts := strings.Split(token, "-")
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			return StatusCodeRange{}, fmt.Errorf("invalid range token: %s", token)
		}
		start, err := strconv.Atoi(parts[0])
		if err != nil {
			return StatusCodeRange{}, fmt.Errorf("invalid range start: %s", token)
		}
		end, err := strconv.Atoi(parts[1])
		if err != nil {
			return StatusCodeRange{}, fmt.Errorf("invalid range end: %s", token)
		}
		if start > end {
			return StatusCodeRange{}, fmt.Errorf("range start > end: %s", token)
		}
		if start < 100 || end > 599 {
			return StatusCodeRange{}, fmt.Errorf("range out of bounds: %s", token)
		}
		return StatusCodeRange{Start: start, End: end}, nil
	}

	code, err := strconv.Atoi(token)
	if err != nil {
		return StatusCodeRange{}, fmt.Errorf("invalid status code: %s", token)
	}
	if code < 100 || code > 599 {
		return StatusCodeRange{}, fmt.Errorf("status code out of bounds: %s", token)
	}
	return StatusCodeRange{Start: code, End: code}, nil
}
