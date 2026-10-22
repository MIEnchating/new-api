package perfmetrics

import "sync"

type Store interface {
	Record(sample Sample)
	Query(params QueryParams) (QueryResult, error)
}

type Sample struct {
	Model         string
	Group         string
	LatencyMs     int64
	TtftMs        int64
	HasTtft       bool
	Success       bool
	OutputTokens  int64
	GenerationMs  int64
	CacheEligible bool
	CachedTokens  int64
	// CacheTotalInputTokens includes all input tokens exactly once, normalized
	// for the upstream usage semantic before any billing adjustments.
	CacheTotalInputTokens int64
}

type QueryParams struct {
	Model string
	Group string
	Hours int
	// AllowedGroups restricts both the per-group results and the model summary;
	// nil allows every group.
	AllowedGroups []string
}

// Summary is the request-weighted aggregate over every bucket in the window.
type Summary struct {
	AvgLatencyMs int64   `json:"avg_latency_ms"`
	SuccessRate  float64 `json:"success_rate"`
	AvgTps       float64 `json:"avg_tps"`
}

type BucketPoint struct {
	Ts           int64   `json:"ts"`
	AvgTtftMs    int64   `json:"avg_ttft_ms"`
	AvgLatencyMs int64   `json:"avg_latency_ms"`
	SuccessRate  float64 `json:"success_rate"`
	AvgTps       float64 `json:"avg_tps"`
}

type GroupResult struct {
	Group        string        `json:"group"`
	AvgTtftMs    int64         `json:"avg_ttft_ms"`
	AvgLatencyMs int64         `json:"avg_latency_ms"`
	SuccessRate  float64       `json:"success_rate"`
	AvgTps       float64       `json:"avg_tps"`
	Series       []BucketPoint `json:"series"`
}

type QueryResult struct {
	ModelName    string        `json:"model_name"`
	SeriesSchema string        `json:"series_schema"`
	Summary      *Summary      `json:"summary"`
	Series       []BucketPoint `json:"series"`
	WindowStart  int64         `json:"window_start"`
	WindowEnd    int64         `json:"window_end"`
	Groups       []GroupResult `json:"groups"`
}

type SuccessRatePoint struct {
	Ts          int64   `json:"ts"`
	SuccessRate float64 `json:"success_rate"`
}

type ModelSummary struct {
	ModelName           string             `json:"model_name"`
	AvgLatencyMs        int64              `json:"avg_latency_ms"`
	SuccessRate         float64            `json:"success_rate"`
	AvgTps              float64            `json:"avg_tps"`
	RecentSuccessSeries []SuccessRatePoint `json:"recent_success_series,omitempty"`
	RequestCount        int64              `json:"-"`
}

type SummaryAllResult struct {
	Summary     *Summary       `json:"summary"`
	WindowStart int64          `json:"window_start"`
	WindowEnd   int64          `json:"window_end"`
	Models      []ModelSummary `json:"models"`
	// RecentSuccessSeries contains up to 24 nonempty hours from the last 7 days,
	// including requested models with no traffic in the summary window.
	RecentSuccessSeries map[string][]SuccessRatePoint `json:"recent_success_series,omitempty"`
}

type CacheBucketPoint struct {
	Health       MonitorHealth `json:"health"`
	Ts           int64         `json:"ts"`
	RequestCount int64         `json:"request_count,omitempty"`
	HitCount     int64         `json:"hit_count,omitempty"`
	CachedTokens int64         `json:"cached_tokens"`
	CacheHitRate float64       `json:"cache_hit_rate"`
	AvgTps       float64       `json:"avg_tps"`
	HasData      bool          `json:"has_data"`
}

type CacheGroupResult struct {
	Health       MonitorHealth      `json:"health"`
	Group        string             `json:"group"`
	RequestCount int64              `json:"request_count,omitempty"`
	HitCount     int64              `json:"hit_count,omitempty"`
	CachedTokens int64              `json:"cached_tokens"`
	CacheHitRate float64            `json:"cache_hit_rate"`
	AvgTps       float64            `json:"avg_tps"`
	HasData      bool               `json:"has_data"`
	Series       []CacheBucketPoint `json:"series"`
}

type CacheSummaryPoint struct {
	Ts           int64         `json:"ts"`
	Health       MonitorHealth `json:"health"`
	CacheHitRate float64       `json:"cache_hit_rate"`
	HasData      bool          `json:"has_data"`
}

type CacheSummary struct {
	Series       []CacheSummaryPoint `json:"series"`
	Health       MonitorHealth       `json:"health"`
	CacheHitRate float64             `json:"cache_hit_rate"`
	HasData      bool                `json:"has_data"`
}

type CacheQueryResult struct {
	Summary CacheSummary       `json:"summary"`
	StartTs int64              `json:"start_ts"`
	EndTs   int64              `json:"end_ts"`
	Groups  []CacheGroupResult `json:"groups"`
}

type RequestWindowStats struct {
	RequestCount  int64   `json:"request_count"`
	SuccessCount  int64   `json:"success_count"`
	FailureCount  int64   `json:"failure_count"`
	SuccessRate   float64 `json:"success_rate"`
	AvgLatencyMs  float64 `json:"avg_latency_ms"`
	LastRequestAt int64   `json:"last_request_at,omitempty"`
	HasData       bool    `json:"has_data"`
}

type RecentRequestStats struct {
	FiveMinutes   RequestWindowStats            `json:"5m"`
	ThirtyMinutes RequestWindowStats            `json:"30m"`
	OneHour       RequestWindowStats            `json:"1h"`
	ByGroup       map[string]RecentRequestStats `json:"by_group,omitempty"`
	// Samples are internal, bounded timeline data; never expose request IDs.
	Samples []RequestSample `json:"-"`
}

type RequestSample struct {
	Time      int64
	LatencyMs int
	Success   bool
}

type bucketKey struct {
	model    string
	group    string
	bucketTs int64
}

type counters struct {
	requestCount          int64
	successCount          int64
	totalLatencyMs        int64
	ttftSumMs             int64
	ttftCount             int64
	outputTokens          int64
	generationMs          int64
	cacheRequests         int64
	cacheTokenRequests    int64
	cacheHits             int64
	cachedTokens          int64
	cacheTokenReadTokens  int64
	cacheTokenDenominator int64
}

// atomicBucket keeps all counters for one sample in a consistent snapshot.
type atomicBucket struct {
	mu    sync.Mutex
	value counters
}

func (b *atomicBucket) add(sample Sample) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.value.requestCount++
	if sample.Success {
		b.value.successCount++
	}
	if sample.LatencyMs > 0 {
		b.value.totalLatencyMs += sample.LatencyMs
	}
	if sample.HasTtft && sample.TtftMs >= 0 {
		b.value.ttftSumMs += sample.TtftMs
		b.value.ttftCount++
	}
	if sample.OutputTokens > 0 && sample.GenerationMs > 0 {
		b.value.outputTokens += sample.OutputTokens
		b.value.generationMs += sample.GenerationMs
	}
	if sample.CacheEligible && sample.CacheTotalInputTokens > 0 &&
		sample.CachedTokens >= 0 && sample.CachedTokens <= sample.CacheTotalInputTokens {
		b.value.cacheRequests++
		b.value.cacheTokenRequests++
		if sample.CachedTokens > 0 {
			b.value.cacheHits++
			b.value.cachedTokens += sample.CachedTokens
		}
		b.value.cacheTokenReadTokens += sample.CachedTokens
		b.value.cacheTokenDenominator += sample.CacheTotalInputTokens
	}
}

func (b *atomicBucket) snapshot() counters {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.value
}

func (b *atomicBucket) drain() counters {
	b.mu.Lock()
	defer b.mu.Unlock()
	value := b.value
	b.value = counters{}
	return value
}

func (b *atomicBucket) addCounters(c counters) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.value.requestCount += c.requestCount
	b.value.successCount += c.successCount
	b.value.totalLatencyMs += c.totalLatencyMs
	b.value.ttftSumMs += c.ttftSumMs
	b.value.ttftCount += c.ttftCount
	b.value.outputTokens += c.outputTokens
	b.value.generationMs += c.generationMs
	b.value.cacheRequests += c.cacheRequests
	b.value.cacheTokenRequests += c.cacheTokenRequests
	b.value.cacheHits += c.cacheHits
	b.value.cachedTokens += c.cachedTokens
	b.value.cacheTokenReadTokens += c.cacheTokenReadTokens
	b.value.cacheTokenDenominator += c.cacheTokenDenominator
}
