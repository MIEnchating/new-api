package perfmetrics

import (
	"cmp"
	"context"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"

	"github.com/bytedance/gopkg/util/gopool"
)

var hotBuckets sync.Map

// Queries retry if a flush moves counters between memory and the database.
// The mutex serializes flushes; recording samples never waits on database I/O.
var flushMu sync.RWMutex
var flushGeneration uint64

func metricsFlushGeneration() uint64 {
	flushMu.RLock()
	defer flushMu.RUnlock()
	return flushGeneration
}

// perfMetricsNow is replaceable in package tests so window-boundary behavior
// remains deterministic while production uses the wall clock.
var perfMetricsNow = time.Now

// seriesSchema is a stable client cache/schema marker. Do not change it when
// hiding fields or making response-only privacy hardening changes.
const seriesSchema = "dbcd0a3c01b55203"

// MaxRecentModels bounds the historical lookups made by one summary request.
const MaxRecentModels = 50
const recentSuccessSampleLimit = 24
const recentSuccessHistoryHours = 7 * 24

func Init() {
	go flushLoop()
}

// RecordRelayResult samples one finished relay exactly once, at the request
// boundary, regardless of how many channel attempts it took.
func RecordRelayResult(ctx context.Context, info *relaycommon.RelayInfo, apiErr *types.NewAPIError) {
	if info == nil {
		return
	}
	outcome := ClassifyRelayOutcome(ctx, info, apiErr)
	if outcome == OutcomeIgnored {
		return
	}
	now := perfMetricsNow()
	hasTtft := info.IsStream && info.HasSendResponse()
	ttftMs := int64(0)
	if hasTtft {
		ttftMs = info.FirstResponseTime.Sub(info.StartTime).Milliseconds()
	}
	latencyMs := now.Sub(info.StartTime).Milliseconds()
	generationMs := latencyMs
	if hasTtft {
		generationMs = now.Sub(info.FirstResponseTime).Milliseconds()
	}
	if generationMs <= 0 {
		generationMs = latencyMs
	}
	Record(Sample{
		CacheEligible:         info.PerformanceCacheEligible,
		CachedTokens:          info.PerformanceCachedTokens,
		CacheTotalInputTokens: info.PerformanceCacheTotalInputTokens,
		Model:                 info.OriginModelName,
		Group:                 info.UsingGroup,
		LatencyMs:             latencyMs,
		TtftMs:                ttftMs,
		HasTtft:               hasTtft,
		Success:               outcome == OutcomeSuccess,
		OutputTokens:          info.PerformanceOutputTokens,
		GenerationMs:          generationMs,
	})
}

// RecordTaskResult samples one async task exactly once, at its terminal
// transition, after the polling status CAS is won. Latency is the end-to-end
// task duration (second resolution, unlike the ms-resolution relay samples);
// throughput is only present when the provider reports tokens.
func RecordTaskResult(task *model.Task, result *relaycommon.TaskInfo) {
	if task == nil {
		return
	}
	modelName := task.Properties.OriginModelName
	if bc := task.PrivateData.BillingContext; bc != nil && bc.OriginModelName != "" {
		modelName = bc.OriginModelName
	}
	endTs := task.FinishTime
	if endTs <= 0 {
		endTs = perfMetricsNow().Unix()
	}
	sample := Sample{
		Model:   modelName,
		Group:   task.Group,
		Success: task.Status == model.TaskStatusSuccess,
	}
	if task.SubmitTime > 0 && endTs > task.SubmitTime {
		sample.LatencyMs = (endTs - task.SubmitTime) * 1000
	}
	if sample.Success && result != nil {
		tokens := int64(cmp.Or(result.TotalTokens, result.CompletionTokens))
		genStart := cmp.Or(task.StartTime, task.SubmitTime)
		if tokens > 0 && genStart > 0 && endTs > genStart {
			sample.OutputTokens = tokens
			sample.GenerationMs = (endTs - genStart) * 1000
		}
	}
	Record(sample)
}

// Immediate failures are submit failures, which are not health samples.
func RecordImmediateTaskResult(info *relaycommon.RelayInfo, result *relaycommon.TaskInfo) {
	if result == nil || result.Status != model.TaskStatusSuccess {
		return
	}
	sample := Sample{
		Model:     info.OriginModelName,
		Group:     info.UsingGroup,
		LatencyMs: time.Since(info.StartTime).Milliseconds(),
		Success:   true,
	}
	if tokens := int64(cmp.Or(result.TotalTokens, result.CompletionTokens)); tokens > 0 {
		sample.OutputTokens = tokens
		sample.GenerationMs = sample.LatencyMs
	}
	Record(sample)
}

func Record(sample Sample) {
	setting := perf_metrics_setting.GetSetting()
	if !setting.Enabled || sample.Model == "" {
		return
	}
	if sample.Group == "" {
		sample.Group = "default"
	}
	if sample.LatencyMs < 0 {
		sample.LatencyMs = 0
	}

	key := bucketKey{
		model:    sample.Model,
		group:    sample.Group,
		bucketTs: bucketStart(perfMetricsNow().Unix()),
	}
	actual, _ := hotBuckets.LoadOrStore(key, &atomicBucket{})
	actual.(*atomicBucket).add(sample)
	if common.RedisEnabled && common.RDB != nil {
		gopool.Go(func() {
			recordRedis(key, sample)
		})
	}
}

// queryWindow covers the current partial hour plus the preceding complete
// hours, so every reader shares the same hourly buckets.
func queryWindow(now time.Time, hours int) (int64, int64) {
	if hours <= 0 {
		hours = 24
	}
	hours = min(hours, 24*30)
	endTs := now.Unix()
	return endTs - endTs%3600 - int64(hours-1)*3600, endTs
}

func Query(params QueryParams) (QueryResult, error) {
	for {
		generation := metricsFlushGeneration()
		startTs, endTs := queryWindow(perfMetricsNow(), params.Hours)
		allowedGroups := allowedGroupSet(params.AllowedGroups)

		merged := map[bucketKey]counters{}
		rows, err := model.GetPerfMetrics(params.Model, params.Group, startTs, endTs)
		if err != nil {
			return QueryResult{}, err
		}
		for _, row := range rows {
			if allowedGroups != nil {
				if _, ok := allowedGroups[row.Group]; !ok {
					continue
				}
			}
			mergeCounters(merged, bucketKey{
				model:    row.ModelName,
				group:    row.Group,
				bucketTs: row.BucketTs,
			}, counters{
				requestCount:          row.RequestCount,
				successCount:          row.SuccessCount,
				totalLatencyMs:        row.TotalLatencyMs,
				ttftSumMs:             row.TtftSumMs,
				ttftCount:             row.TtftCount,
				outputTokens:          row.OutputTokens,
				generationMs:          row.GenerationMs,
				cacheRequests:         row.CacheRequests,
				cacheHits:             row.CacheHits,
				cachedTokens:          row.CachedTokens,
				cacheTokenReadTokens:  row.CacheTokenReadTokens,
				cacheTokenDenominator: row.CacheTokenDenominator,
			})
		}

		hotBuckets.Range(func(key, value any) bool {
			k := key.(bucketKey)
			if k.model != params.Model || k.bucketTs < startTs || k.bucketTs > endTs {
				return true
			}
			if params.Group != "" && k.group != params.Group {
				return true
			}
			if allowedGroups != nil {
				if _, ok := allowedGroups[k.group]; !ok {
					return true
				}
			}
			mergeCounters(merged, k, value.(*atomicBucket).snapshot())
			return true
		})

		if metricsFlushGeneration() != generation {
			continue
		}

		result := buildQueryResult(params.Model, merged)
		result.WindowStart, result.WindowEnd = startTs, endTs
		return result, nil
	}
}

func QuerySummaryAll(hours int, groups []string, recentModels ...string) (SummaryAllResult, error) {
	for {
		generation := metricsFlushGeneration()
		if len(recentModels) > MaxRecentModels {
			return SummaryAllResult{}, common.NewMessage("Invalid parameters")
		}
		now := perfMetricsNow()
		startTs, endTs := queryWindow(now, hours)
		recentStartTs, _ := queryWindow(now, recentSuccessHistoryHours)
		allowedGroups := allowedGroupSet(groups)
		queryStartTs := startTs

		recentBuckets := make(map[string]map[int64]counters, len(recentModels))
		for _, name := range recentModels {
			if name == "" {
				continue
			}
			if _, exists := recentBuckets[name]; exists {
				continue
			}
			recentBuckets[name] = map[int64]counters{}
			buckets, err := model.GetRecentPerfMetricSuccessBuckets(name, recentStartTs, endTs, groups, recentSuccessSampleLimit)
			if err != nil {
				return SummaryAllResult{}, err
			}
			for _, bucket := range buckets {
				queryStartTs = min(queryStartTs, bucket.BucketTs)
				mergeModelBucket(recentBuckets, name, bucket.BucketTs, counters{
					requestCount: bucket.RequestCount,
					successCount: bucket.SuccessCount,
				})
			}
		}

		rows, err := model.GetPerfMetricsSummaryBucketsAll(queryStartTs, endTs, groups)
		if err != nil {
			return SummaryAllResult{}, err
		}

		modelBuckets := map[string]map[int64]counters{}
		for _, row := range rows {
			value := counters{
				requestCount:   row.RequestCount,
				successCount:   row.SuccessCount,
				totalLatencyMs: row.TotalLatencyMs,
				outputTokens:   row.OutputTokens,
				generationMs:   row.GenerationMs,
			}
			mergeModelBucket(modelBuckets, row.ModelName, row.BucketTs, value)
		}

		hotBuckets.Range(func(key, value any) bool {
			k := key.(bucketKey)
			if k.bucketTs > endTs {
				return true
			}
			if allowedGroups != nil {
				if _, ok := allowedGroups[k.group]; !ok {
					return true
				}
			}
			snap := value.(*atomicBucket).snapshot()
			if snap.requestCount == 0 {
				return true
			}
			if _, requested := recentBuckets[k.model]; requested && k.bucketTs >= recentStartTs {
				mergeModelBucket(recentBuckets, k.model, k.bucketTs, snap)
			}
			if k.bucketTs < queryStartTs {
				return true
			}
			mergeModelBucket(modelBuckets, k.model, k.bucketTs, snap)
			return true
		})

		recentSeries := make(map[string][]SuccessRatePoint, len(recentBuckets))
		for name, buckets := range recentBuckets {
			points := recentSuccessSeries(buckets)
			if len(points) == 0 {
				continue
			}
			recentSeries[name] = points[max(0, len(points)-recentSuccessSampleLimit):]
		}

		// Requested models are summarized over the same hours as their status samples.
		totals := map[string]counters{}
		for name, buckets := range modelBuckets {
			fromTs := startTs
			if points, ok := recentSeries[name]; ok {
				fromTs = points[0].Ts
			}
			for bucketTs, value := range buckets {
				if bucketTs < fromTs {
					delete(buckets, bucketTs)
					continue
				}
				mergeModelTotals(totals, name, value)
			}
		}

		all := counters{}
		models := make([]ModelSummary, 0, len(totals))
		for name, total := range totals {
			if total.requestCount == 0 {
				continue
			}
			all.requestCount += total.requestCount
			all.successCount += total.successCount
			all.totalLatencyMs += total.totalLatencyMs
			all.outputTokens += total.outputTokens
			all.generationMs += total.generationMs
			avgLatency := total.totalLatencyMs / total.requestCount
			successRate := float64(total.successCount) / float64(total.requestCount) * 100
			avgTps := 0.0
			if total.generationMs > 0 {
				avgTps = float64(total.outputTokens) / (float64(total.generationMs) / 1000.0)
			}
			models = append(models, ModelSummary{
				ModelName:           name,
				AvgLatencyMs:        avgLatency,
				SuccessRate:         math.Round(successRate*100) / 100,
				AvgTps:              math.Round(avgTps*100) / 100,
				RecentSuccessSeries: recentSuccessSeries(modelBuckets[name]),
				RequestCount:        total.requestCount,
			})
		}
		sort.Slice(models, func(i, j int) bool {
			return models[i].RequestCount > models[j].RequestCount
		})

		if metricsFlushGeneration() != generation {
			continue
		}

		return SummaryAllResult{
			Summary: summarize(all), WindowStart: startTs, WindowEnd: endTs,
			Models: models, RecentSuccessSeries: recentSeries,
		}, nil
	}
}

func QueryCache(hours int, groups []string) (CacheQueryResult, error) {
	for {
		generation := metricsFlushGeneration()
		if hours <= 0 {
			hours = 24
		}
		if hours > 24*30 {
			hours = 24 * 30
		}
		endTs := perfMetricsNow().Unix()
		startTs := endTs - int64(hours)*3600
		allowedGroups := allowedGroupSet(groups)
		groupBuckets := map[string]map[int64]counters{}

		rows, err := model.GetPerfMetricCacheBucketsAll(startTs, endTs, groups)
		if err != nil {
			return CacheQueryResult{}, err
		}
		for _, row := range rows {
			mergeCacheGroupBucket(groupBuckets, row.Group, row.BucketTs, counters{
				requestCount:          row.RequestCount,
				successCount:          row.SuccessCount,
				ttftSumMs:             row.TtftSumMs,
				ttftCount:             row.TtftCount,
				outputTokens:          row.OutputTokens,
				generationMs:          row.GenerationMs,
				cacheRequests:         row.CacheRequests,
				cacheTokenRequests:    row.CacheTokenRequests,
				cacheHits:             row.CacheHits,
				cachedTokens:          row.CachedTokens,
				cacheTokenReadTokens:  row.CacheTokenReadTokens,
				cacheTokenDenominator: row.CacheTokenDenominator,
			})
		}

		hotBuckets.Range(func(key, value any) bool {
			k := key.(bucketKey)
			if k.bucketTs < startTs || k.bucketTs > endTs {
				return true
			}
			if allowedGroups != nil {
				if _, ok := allowedGroups[k.group]; !ok {
					return true
				}
			}
			snapshot := value.(*atomicBucket).snapshot()
			if snapshot.requestCount == 0 {
				return true
			}
			mergeCacheGroupBucket(groupBuckets, k.group, k.bucketTs, snapshot)
			return true
		})

		if metricsFlushGeneration() != generation {
			continue
		}

		result := buildCacheQueryResult(groupBuckets)
		result.StartTs = startTs
		result.EndTs = endTs
		return result, nil
	}
}

func mergeModelTotals(totals map[string]counters, modelName string, value counters) {
	if value.requestCount == 0 {
		return
	}
	current := totals[modelName]
	current.requestCount += value.requestCount
	current.successCount += value.successCount
	current.totalLatencyMs += value.totalLatencyMs
	current.ttftSumMs += value.ttftSumMs
	current.ttftCount += value.ttftCount
	current.outputTokens += value.outputTokens
	current.generationMs += value.generationMs
	current.cacheRequests += value.cacheRequests
	current.cacheHits += value.cacheHits
	current.cachedTokens += value.cachedTokens
	totals[modelName] = current
}

func mergeModelBucket(modelBuckets map[string]map[int64]counters, modelName string, bucketTs int64, value counters) {
	if value.requestCount == 0 {
		return
	}
	if _, ok := modelBuckets[modelName]; !ok {
		modelBuckets[modelName] = map[int64]counters{}
	}
	current := modelBuckets[modelName][bucketTs]
	current.requestCount += value.requestCount
	current.successCount += value.successCount
	current.totalLatencyMs += value.totalLatencyMs
	current.ttftSumMs += value.ttftSumMs
	current.ttftCount += value.ttftCount
	current.outputTokens += value.outputTokens
	current.generationMs += value.generationMs
	current.cacheRequests += value.cacheRequests
	current.cacheHits += value.cacheHits
	current.cachedTokens += value.cachedTokens
	modelBuckets[modelName][bucketTs] = current
}

func mergeCacheGroupBucket(groupBuckets map[string]map[int64]counters, group string, bucketTs int64, value counters) {
	if value.requestCount == 0 && value.cacheRequests == 0 {
		return
	}
	if _, ok := groupBuckets[group]; !ok {
		groupBuckets[group] = map[int64]counters{}
	}
	current := groupBuckets[group][bucketTs]
	current.requestCount += value.requestCount
	current.successCount += value.successCount
	current.ttftSumMs += value.ttftSumMs
	current.ttftCount += value.ttftCount
	current.outputTokens += value.outputTokens
	current.generationMs += value.generationMs
	current.cacheRequests += value.cacheRequests
	current.cacheTokenRequests += value.cacheTokenRequests
	current.cacheHits += value.cacheHits
	current.cachedTokens += value.cachedTokens
	current.cacheTokenReadTokens += value.cacheTokenReadTokens
	current.cacheTokenDenominator += value.cacheTokenDenominator
	groupBuckets[group][bucketTs] = current
}

func recentSuccessSeries(buckets map[int64]counters) []SuccessRatePoint {
	if len(buckets) == 0 {
		return nil
	}
	hourly := map[int64]counters{}
	for ts, value := range buckets {
		hourTs := ts - ts%3600
		merged := hourly[hourTs]
		merged.requestCount += value.requestCount
		merged.successCount += value.successCount
		hourly[hourTs] = merged
	}
	timestamps := make([]int64, 0, len(hourly))
	for hourTs, value := range hourly {
		if value.requestCount == 0 {
			continue
		}
		timestamps = append(timestamps, hourTs)
	}
	if len(timestamps) == 0 {
		return nil
	}
	sort.Slice(timestamps, func(i, j int) bool {
		return timestamps[i] < timestamps[j]
	})
	points := make([]SuccessRatePoint, 0, len(timestamps))
	for _, hourTs := range timestamps {
		points = append(points, SuccessRatePoint{
			Ts:          hourTs,
			SuccessRate: math.Round(successRate(hourly[hourTs])*100) / 100,
		})
	}
	return points
}

func allowedGroupSet(groups []string) map[string]struct{} {
	if groups == nil {
		return nil
	}
	allowed := make(map[string]struct{}, len(groups))
	for _, group := range groups {
		allowed[group] = struct{}{}
	}
	return allowed
}

func bucketStart(ts int64) int64 {
	bucketSeconds := perf_metrics_setting.GetBucketSeconds()
	if bucketSeconds <= 0 {
		bucketSeconds = 3600
	}
	return ts - (ts % bucketSeconds)
}

func mergeCounters(merged map[bucketKey]counters, key bucketKey, value counters) {
	if value.requestCount == 0 {
		return
	}
	current := merged[key]
	current.requestCount += value.requestCount
	current.successCount += value.successCount
	current.totalLatencyMs += value.totalLatencyMs
	current.ttftSumMs += value.ttftSumMs
	current.ttftCount += value.ttftCount
	current.outputTokens += value.outputTokens
	current.generationMs += value.generationMs
	current.cacheRequests += value.cacheRequests
	current.cacheTokenRequests += value.cacheTokenRequests
	current.cacheHits += value.cacheHits
	current.cachedTokens += value.cachedTokens
	current.cacheTokenReadTokens += value.cacheTokenReadTokens
	current.cacheTokenDenominator += value.cacheTokenDenominator
	merged[key] = current
}

func buildCacheQueryResult(groupBuckets map[string]map[int64]counters) CacheQueryResult {
	groupNames := make([]string, 0, len(groupBuckets))
	for group := range groupBuckets {
		groupNames = append(groupNames, group)
	}
	sort.Strings(groupNames)

	thresholds := perf_metrics_setting.GetHealthThresholds()
	results := make([]CacheGroupResult, 0, len(groupNames))
	summaryBuckets := map[string]map[int64]counters{}
	for _, group := range groupNames {
		for ts, value := range groupBuckets[group] {
			mergeCacheGroupBucket(summaryBuckets, "", ts, value)
		}
		result := buildCacheGroupResult(group, groupBuckets[group], thresholds)
		results = append(results, result)
	}

	summary := buildCacheGroupResult("", summaryBuckets[""], thresholds)
	series := make([]CacheSummaryPoint, 0, len(summary.Series))
	for _, point := range summary.Series {
		series = append(series, CacheSummaryPoint{Ts: point.Ts, Health: point.Health, CacheHitRate: point.CacheHitRate, HasData: point.HasData})
	}
	return CacheQueryResult{
		Summary: CacheSummary{Series: series, Health: summary.Health, CacheHitRate: summary.CacheHitRate, HasData: summary.HasData},
		Groups:  results,
	}
}

func buildCacheGroupResult(group string, buckets map[int64]counters, thresholds perf_metrics_setting.HealthThresholds) CacheGroupResult {
	timestamps := make([]int64, 0, len(buckets))
	for ts := range buckets {
		timestamps = append(timestamps, ts)
	}
	sort.Slice(timestamps, func(i, j int) bool { return timestamps[i] < timestamps[j] })

	total := counters{}
	series := make([]CacheBucketPoint, 0, len(timestamps))
	for _, ts := range timestamps {
		value := buckets[ts]
		total.requestCount += value.requestCount
		total.successCount += value.successCount
		total.ttftSumMs += value.ttftSumMs
		total.ttftCount += value.ttftCount
		total.outputTokens += value.outputTokens
		total.generationMs += value.generationMs
		total.cacheRequests += value.cacheRequests
		total.cacheTokenRequests += value.cacheTokenRequests
		total.cacheHits += value.cacheHits
		total.cachedTokens += value.cachedTokens
		total.cacheTokenReadTokens += value.cacheTokenReadTokens
		total.cacheTokenDenominator += value.cacheTokenDenominator
		series = append(series, CacheBucketPoint{
			Health:       monitorHealth(value, thresholds),
			Ts:           ts,
			RequestCount: value.cacheRequests,
			HitCount:     value.cacheHits,
			CachedTokens: value.cachedTokens,
			CacheHitRate: cacheHitRate(value),
			AvgTps:       math.Round(avgTps(value)*100) / 100,
			HasData:      value.cacheTokenDenominator > 0,
		})
	}

	return CacheGroupResult{
		Health:       monitorHealth(total, thresholds),
		Group:        group,
		RequestCount: total.cacheRequests,
		HitCount:     total.cacheHits,
		CachedTokens: total.cachedTokens,
		CacheHitRate: cacheHitRate(total),
		AvgTps:       math.Round(avgTps(total)*100) / 100,
		HasData:      total.cacheTokenDenominator > 0,
		Series:       series,
	}
}

func buildQueryResult(modelName string, merged map[bucketKey]counters) QueryResult {
	groupBuckets := map[string]map[int64]counters{}
	modelBuckets := map[string]map[int64]counters{}
	for key, value := range merged {
		if value.requestCount == 0 {
			continue
		}
		if _, ok := groupBuckets[key.group]; !ok {
			groupBuckets[key.group] = map[int64]counters{}
		}
		groupBuckets[key.group][key.bucketTs] = value
		mergeModelBucket(modelBuckets, modelName, key.bucketTs, value)
	}

	groups := make([]string, 0, len(groupBuckets))
	for group := range groupBuckets {
		groups = append(groups, group)
	}
	sort.Strings(groups)

	all := counters{}
	results := make([]GroupResult, 0, len(groups))
	for _, group := range groups {
		buckets := groupBuckets[group]
		timestamps := make([]int64, 0, len(buckets))
		for ts := range buckets {
			timestamps = append(timestamps, ts)
		}
		sort.Slice(timestamps, func(i, j int) bool {
			return timestamps[i] < timestamps[j]
		})

		total := counters{}
		series := make([]BucketPoint, 0, len(timestamps))
		for _, ts := range timestamps {
			value := buckets[ts]
			total.requestCount += value.requestCount
			total.successCount += value.successCount
			total.totalLatencyMs += value.totalLatencyMs
			total.ttftSumMs += value.ttftSumMs
			total.ttftCount += value.ttftCount
			total.outputTokens += value.outputTokens
			total.generationMs += value.generationMs
			series = append(series, bucketPoint(ts, value))
		}
		all.requestCount += total.requestCount
		all.successCount += total.successCount
		all.totalLatencyMs += total.totalLatencyMs
		all.outputTokens += total.outputTokens
		all.generationMs += total.generationMs

		results = append(results, GroupResult{
			Group:        group,
			AvgTtftMs:    avg(total.ttftSumMs, total.ttftCount),
			AvgLatencyMs: avg(total.totalLatencyMs, total.requestCount),
			SuccessRate:  successRate(total),
			AvgTps:       avgTps(total),
			Series:       series,
		})
	}

	modelSeries := make([]BucketPoint, 0, len(modelBuckets[modelName]))
	for ts, value := range modelBuckets[modelName] {
		modelSeries = append(modelSeries, bucketPoint(ts, value))
	}
	sort.Slice(modelSeries, func(i, j int) bool {
		return modelSeries[i].Ts < modelSeries[j].Ts
	})

	return QueryResult{
		ModelName:    modelName,
		SeriesSchema: seriesSchema,
		Summary:      summarize(all),
		Series:       modelSeries,
		Groups:       results,
	}
}

// summarize returns nil when nothing was sampled, so clients can show
// "no data" instead of a fabricated 0% success rate.
func summarize(total counters) *Summary {
	if total.requestCount <= 0 {
		return nil
	}
	return &Summary{
		AvgLatencyMs: avg(total.totalLatencyMs, total.requestCount),
		SuccessRate:  math.Round(successRate(total)*100) / 100,
		AvgTps:       math.Round(avgTps(total)*100) / 100,
	}
}

func bucketPoint(ts int64, value counters) BucketPoint {
	return BucketPoint{
		Ts:           ts,
		AvgTtftMs:    avg(value.ttftSumMs, value.ttftCount),
		AvgLatencyMs: avg(value.totalLatencyMs, value.requestCount),
		SuccessRate:  successRate(value),
		AvgTps:       avgTps(value),
	}
}

func avg(sum int64, count int64) int64 {
	if count <= 0 {
		return 0
	}
	return sum / count
}

func successRate(value counters) float64 {
	if value.requestCount <= 0 {
		return 0
	}
	return float64(value.successCount) / float64(value.requestCount) * 100
}

func QueryRecentRequestStats() (RecentRequestStats, error) {
	now := perfMetricsNow().Unix()
	counts, err := model.GetRecentRelayRequestCounts(now)
	if err != nil {
		return RecentRequestStats{}, err
	}
	groupCounts, err := model.GetRecentRelayRequestCountsByGroup(now)
	if err != nil {
		return RecentRequestStats{}, err
	}
	stats := RecentRequestStats{
		FiveMinutes:   buildRequestWindowStats(counts.Requests5m, counts.Successes5m, counts.AvgUseTime5m, counts.LastRequest5m),
		ThirtyMinutes: buildRequestWindowStats(counts.Requests30m, counts.Successes30m, counts.AvgUseTime30m, counts.LastRequest30m),
		OneHour:       buildRequestWindowStats(counts.Requests1h, counts.Successes1h, counts.AvgUseTime1h, counts.LastRequest1h),
		ByGroup:       make(map[string]RecentRequestStats, len(groupCounts)),
	}
	for _, group := range groupCounts {
		if group.GroupName == "" {
			continue
		}
		stats.ByGroup[group.GroupName] = RecentRequestStats{
			FiveMinutes:   buildRequestWindowStats(group.Requests5m, group.Successes5m, group.AvgUseTime5m, group.LastRequest5m),
			ThirtyMinutes: buildRequestWindowStats(group.Requests30m, group.Successes30m, group.AvgUseTime30m, group.LastRequest30m),
			OneHour:       buildRequestWindowStats(group.Requests1h, group.Successes1h, group.AvgUseTime1h, group.LastRequest1h),
		}
	}
	return stats, nil
}

// QueryRecentRequestStatus uses final request logs, including existing history,
// independently of performance sampling and external uptime monitors.
func QueryRecentRequestStatus() (RecentRequestStats, error) {
	now := perfMetricsNow().Unix()
	rows, err := model.GetRecentRelayRequestSamples(now)
	if err != nil {
		return RecentRequestStats{}, err
	}
	return buildRecentRequestStatus(rows, now), nil
}

func buildRecentRequestStatus(rows []model.RelayRequestSample, now int64) RecentRequestStats {
	stats := RecentRequestStats{ByGroup: make(map[string]RecentRequestStats)}
	seen := make(map[string]struct{}, len(rows))
	// Rows are newest first. Keep the final log for each request, so retries
	// and duplicate log records never inflate the rate or the timeline.
	for _, row := range rows {
		if _, exists := seen[row.RequestId]; exists {
			continue
		}
		seen[row.RequestId] = struct{}{}
		group := row.Group
		if group == "" {
			group = "default"
		}
		groupStats := stats.ByGroup[group]
		for _, target := range []*RecentRequestStats{&stats, &groupStats} {
			for _, window := range []struct {
				seconds int64
				stats   *RequestWindowStats
			}{{300, &target.FiveMinutes}, {1800, &target.ThirtyMinutes}, {3600, &target.OneHour}} {
				if row.CreatedAt < now-window.seconds {
					continue
				}
				value := window.stats
				value.RequestCount++
				if row.Type == model.LogTypeConsume {
					value.SuccessCount++
				} else {
					value.FailureCount++
				}
				value.AvgLatencyMs += (float64(max(row.UseTime, 0))*1000 - value.AvgLatencyMs) / float64(value.RequestCount)
				value.LastRequestAt = max(value.LastRequestAt, row.CreatedAt)
				value.HasData = true
				value.SuccessRate = float64(value.SuccessCount) / float64(value.RequestCount) * 100
			}
		}
		if len(groupStats.Samples) < 288 {
			groupStats.Samples = append(groupStats.Samples, RequestSample{
				Time: row.CreatedAt, LatencyMs: max(row.UseTime, 0) * 1000, Success: row.Type == model.LogTypeConsume,
			})
		}
		stats.ByGroup[group] = groupStats
	}
	return stats
}

func buildRequestWindowStats(requests int64, successes int64, avgUseTimeSeconds float64, lastRequestAt int64) RequestWindowStats {
	result := RequestWindowStats{
		RequestCount:  requests,
		SuccessCount:  successes,
		FailureCount:  maxInt64(requests-successes, 0),
		AvgLatencyMs:  avgUseTimeSeconds * 1000,
		LastRequestAt: lastRequestAt,
		HasData:       requests > 0,
	}
	if requests > 0 {
		result.SuccessRate = math.Round(float64(successes)/float64(requests)*10_000) / 100
	}
	return result
}

func maxInt64(value int64, minimum int64) int64 {
	if value < minimum {
		return minimum
	}
	return value
}

func cacheHitRate(value counters) float64 {
	if value.cacheTokenDenominator > 0 {
		rate := float64(value.cacheTokenReadTokens) / float64(value.cacheTokenDenominator) * 100
		return math.Round(rate*100) / 100
	}
	// Legacy request-hit counters cannot establish a token read share.
	return 0
}

func avgTps(value counters) float64 {
	if value.outputTokens <= 0 || value.generationMs <= 0 {
		return 0
	}
	return float64(value.outputTokens) / (float64(value.generationMs) / 1000)
}

func recordRedis(key bucketKey, sample Sample) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	redisKey := redisBucketKey(key)
	pipe := common.RDB.TxPipeline()
	pipe.HIncrBy(ctx, redisKey, "req", 1)
	if sample.Success {
		pipe.HIncrBy(ctx, redisKey, "ok", 1)
	}
	if sample.LatencyMs > 0 {
		pipe.HIncrBy(ctx, redisKey, "lat", sample.LatencyMs)
	}
	if sample.HasTtft && sample.TtftMs >= 0 {
		pipe.HIncrBy(ctx, redisKey, "ttft", sample.TtftMs)
		pipe.HIncrBy(ctx, redisKey, "ttft_n", 1)
	}
	if sample.OutputTokens > 0 && sample.GenerationMs > 0 {
		pipe.HIncrBy(ctx, redisKey, "out", sample.OutputTokens)
		pipe.HIncrBy(ctx, redisKey, "gen_ms", sample.GenerationMs)
	}
	pipe.Expire(ctx, redisKey, time.Hour)
	_, _ = pipe.Exec(ctx)
}

func redisBucketKey(key bucketKey) string {
	return fmt.Sprintf("perf:%s:%s:%d", key.model, key.group, key.bucketTs)
}
