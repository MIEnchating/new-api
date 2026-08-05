package perfmetrics

import "sync/atomic"

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
}

type QueryParams struct {
	Model string
	Group string
	Hours int
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
	Groups       []GroupResult `json:"groups"`
}

type ModelSummary struct {
	ModelName          string    `json:"model_name"`
	AvgLatencyMs       int64     `json:"avg_latency_ms"`
	SuccessRate        float64   `json:"success_rate"`
	AvgTps             float64   `json:"avg_tps"`
	RecentSuccessRates []float64 `json:"recent_success_rates,omitempty"`
	RequestCount       int64     `json:"-"`
}

type SummaryAllResult struct {
	Models []ModelSummary `json:"models"`
}

type CacheBucketPoint struct {
	Ts           int64   `json:"ts"`
	RequestCount int64   `json:"request_count,omitempty"`
	HitCount     int64   `json:"hit_count,omitempty"`
	CachedTokens int64   `json:"cached_tokens"`
	CacheHitRate float64 `json:"cache_hit_rate"`
	AvgTps       float64 `json:"avg_tps"`
	HasData      bool    `json:"has_data"`
}

type CacheGroupResult struct {
	Group        string             `json:"group"`
	RequestCount int64              `json:"request_count,omitempty"`
	HitCount     int64              `json:"hit_count,omitempty"`
	CachedTokens int64              `json:"cached_tokens"`
	CacheHitRate float64            `json:"cache_hit_rate"`
	AvgTps       float64            `json:"avg_tps"`
	HasData      bool               `json:"has_data"`
	Series       []CacheBucketPoint `json:"series"`
}

type CacheQueryResult struct {
	StartTs int64              `json:"start_ts"`
	EndTs   int64              `json:"end_ts"`
	Groups  []CacheGroupResult `json:"groups"`
}

type RequestWindowStats struct {
	RequestCount int64   `json:"-"`
	SuccessCount int64   `json:"-"`
	SuccessRate  float64 `json:"success_rate"`
	HasData      bool    `json:"has_data"`
}

type RecentRequestStats struct {
	FiveMinutes   RequestWindowStats            `json:"5m"`
	ThirtyMinutes RequestWindowStats            `json:"30m"`
	OneHour       RequestWindowStats            `json:"1h"`
	ByGroup       map[string]RecentRequestStats `json:"by_group,omitempty"`
}

type bucketKey struct {
	model    string
	group    string
	bucketTs int64
}

type counters struct {
	requestCount   int64
	successCount   int64
	totalLatencyMs int64
	ttftSumMs      int64
	ttftCount      int64
	outputTokens   int64
	generationMs   int64
	cacheRequests  int64
	cacheHits      int64
	cachedTokens   int64
}

type atomicBucket struct {
	requestCount   atomic.Int64
	successCount   atomic.Int64
	totalLatencyMs atomic.Int64
	ttftSumMs      atomic.Int64
	ttftCount      atomic.Int64
	outputTokens   atomic.Int64
	generationMs   atomic.Int64
	cacheRequests  atomic.Int64
	cacheHits      atomic.Int64
	cachedTokens   atomic.Int64
}

func (b *atomicBucket) add(sample Sample) {
	b.requestCount.Add(1)
	if sample.Success {
		b.successCount.Add(1)
	}
	if sample.LatencyMs > 0 {
		b.totalLatencyMs.Add(sample.LatencyMs)
	}
	if sample.HasTtft && sample.TtftMs >= 0 {
		b.ttftSumMs.Add(sample.TtftMs)
		b.ttftCount.Add(1)
	}
	if sample.OutputTokens > 0 && sample.GenerationMs > 0 {
		b.outputTokens.Add(sample.OutputTokens)
		b.generationMs.Add(sample.GenerationMs)
	}
	if sample.CacheEligible {
		b.cacheRequests.Add(1)
		if sample.CachedTokens > 0 {
			b.cacheHits.Add(1)
			b.cachedTokens.Add(sample.CachedTokens)
		}
	}
}

func (b *atomicBucket) snapshot() counters {
	return counters{
		requestCount:   b.requestCount.Load(),
		successCount:   b.successCount.Load(),
		totalLatencyMs: b.totalLatencyMs.Load(),
		ttftSumMs:      b.ttftSumMs.Load(),
		ttftCount:      b.ttftCount.Load(),
		outputTokens:   b.outputTokens.Load(),
		generationMs:   b.generationMs.Load(),
		cacheRequests:  b.cacheRequests.Load(),
		cacheHits:      b.cacheHits.Load(),
		cachedTokens:   b.cachedTokens.Load(),
	}
}

func (b *atomicBucket) drain() counters {
	return counters{
		requestCount:   b.requestCount.Swap(0),
		successCount:   b.successCount.Swap(0),
		totalLatencyMs: b.totalLatencyMs.Swap(0),
		ttftSumMs:      b.ttftSumMs.Swap(0),
		ttftCount:      b.ttftCount.Swap(0),
		outputTokens:   b.outputTokens.Swap(0),
		generationMs:   b.generationMs.Swap(0),
		cacheRequests:  b.cacheRequests.Swap(0),
		cacheHits:      b.cacheHits.Swap(0),
		cachedTokens:   b.cachedTokens.Swap(0),
	}
}

func (b *atomicBucket) addCounters(c counters) {
	if c.requestCount != 0 {
		b.requestCount.Add(c.requestCount)
	}
	if c.successCount != 0 {
		b.successCount.Add(c.successCount)
	}
	if c.totalLatencyMs != 0 {
		b.totalLatencyMs.Add(c.totalLatencyMs)
	}
	if c.ttftSumMs != 0 {
		b.ttftSumMs.Add(c.ttftSumMs)
	}
	if c.ttftCount != 0 {
		b.ttftCount.Add(c.ttftCount)
	}
	if c.outputTokens != 0 {
		b.outputTokens.Add(c.outputTokens)
	}
	if c.generationMs != 0 {
		b.generationMs.Add(c.generationMs)
	}
	if c.cacheRequests != 0 {
		b.cacheRequests.Add(c.cacheRequests)
	}
	if c.cacheHits != 0 {
		b.cacheHits.Add(c.cacheHits)
	}
	if c.cachedTokens != 0 {
		b.cachedTokens.Add(c.cachedTokens)
	}
}
