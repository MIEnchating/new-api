package perfmetrics

import (
	"context"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
)

var hotBuckets sync.Map

// seriesSchema is a stable client cache/schema marker. Do not change it when
// hiding fields or making response-only privacy hardening changes.
const seriesSchema = "dbcd0a3c01b55203"

func Init() {
	go flushLoop()
}

func RecordRelaySample(info *relaycommon.RelayInfo, success bool, outputTokens int64) {
	recordRelaySample(info, success, outputTokens, false, 0)
}

func RecordRelayUsageSample(info *relaycommon.RelayInfo, outputTokens int64, cachedTokens int64) {
	recordRelaySample(info, true, outputTokens, true, cachedTokens)
}

func recordRelaySample(info *relaycommon.RelayInfo, success bool, outputTokens int64, cacheEligible bool, cachedTokens int64) {
	if info == nil {
		return
	}
	now := time.Now()
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
		Model:         info.OriginModelName,
		Group:         info.UsingGroup,
		LatencyMs:     latencyMs,
		TtftMs:        ttftMs,
		HasTtft:       hasTtft,
		Success:       success,
		OutputTokens:  outputTokens,
		GenerationMs:  generationMs,
		CacheEligible: cacheEligible,
		CachedTokens:  cachedTokens,
	})
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
		bucketTs: bucketStart(time.Now().Unix()),
	}
	actual, _ := hotBuckets.LoadOrStore(key, &atomicBucket{})
	actual.(*atomicBucket).add(sample)
	recordRedis(key, sample)
}

func Query(params QueryParams) (QueryResult, error) {
	if params.Hours <= 0 {
		params.Hours = 24
	}
	if params.Hours > 24*30 {
		params.Hours = 24 * 30
	}
	endTs := time.Now().Unix()
	startTs := endTs - int64(params.Hours)*3600

	merged := map[bucketKey]counters{}
	rows, err := model.GetPerfMetrics(params.Model, params.Group, startTs, endTs)
	if err != nil {
		return QueryResult{}, err
	}
	for _, row := range rows {
		mergeCounters(merged, bucketKey{
			model:    row.ModelName,
			group:    row.Group,
			bucketTs: row.BucketTs,
		}, counters{
			requestCount:   row.RequestCount,
			successCount:   row.SuccessCount,
			totalLatencyMs: row.TotalLatencyMs,
			ttftSumMs:      row.TtftSumMs,
			ttftCount:      row.TtftCount,
			outputTokens:   row.OutputTokens,
			generationMs:   row.GenerationMs,
			cacheRequests:  row.CacheRequests,
			cacheHits:      row.CacheHits,
			cachedTokens:   row.CachedTokens,
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
		mergeCounters(merged, k, value.(*atomicBucket).snapshot())
		return true
	})

	return buildQueryResult(params.Model, merged), nil
}

func QuerySummaryAll(hours int, groups []string) (SummaryAllResult, error) {
	if hours <= 0 {
		hours = 24
	}
	if hours > 24*30 {
		hours = 24 * 30
	}
	endTs := time.Now().Unix()
	startTs := endTs - int64(hours)*3600
	allowedGroups := allowedGroupSet(groups)

	rows, err := model.GetPerfMetricsSummaryBucketsAll(startTs, endTs, groups)
	if err != nil {
		return SummaryAllResult{}, err
	}

	totals := map[string]counters{}
	modelBuckets := map[string]map[int64]counters{}
	for _, row := range rows {
		value := counters{
			requestCount:   row.RequestCount,
			successCount:   row.SuccessCount,
			totalLatencyMs: row.TotalLatencyMs,
			outputTokens:   row.OutputTokens,
			generationMs:   row.GenerationMs,
		}
		mergeModelTotals(totals, row.ModelName, value)
		mergeModelBucket(modelBuckets, row.ModelName, row.BucketTs, value)
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
		snap := value.(*atomicBucket).snapshot()
		if snap.requestCount == 0 {
			return true
		}
		mergeModelTotals(totals, k.model, snap)
		mergeModelBucket(modelBuckets, k.model, k.bucketTs, snap)
		return true
	})

	models := make([]ModelSummary, 0, len(totals))
	for name, total := range totals {
		if total.requestCount == 0 {
			continue
		}
		avgLatency := total.totalLatencyMs / total.requestCount
		successRate := float64(total.successCount) / float64(total.requestCount) * 100
		avgTps := 0.0
		if total.generationMs > 0 {
			avgTps = float64(total.outputTokens) / (float64(total.generationMs) / 1000.0)
		}
		models = append(models, ModelSummary{
			ModelName:          name,
			AvgLatencyMs:       avgLatency,
			SuccessRate:        math.Round(successRate*100) / 100,
			AvgTps:             math.Round(avgTps*100) / 100,
			RecentSuccessRates: recentSuccessRates(modelBuckets[name], 3),
			RequestCount:       total.requestCount,
		})
	}
	sort.Slice(models, func(i, j int) bool {
		return models[i].RequestCount > models[j].RequestCount
	})

	return SummaryAllResult{Models: models}, nil
}

func QueryCache(hours int, groups []string) (CacheQueryResult, error) {
	if hours <= 0 {
		hours = 24
	}
	if hours > 24*30 {
		hours = 24 * 30
	}
	endTs := time.Now().Unix()
	startTs := endTs - int64(hours)*3600
	allowedGroups := allowedGroupSet(groups)
	groupBuckets := map[string]map[int64]counters{}

	rows, err := model.GetPerfMetricCacheBucketsAll(startTs, endTs, groups)
	if err != nil {
		return CacheQueryResult{}, err
	}
	for _, row := range rows {
		mergeCacheGroupBucket(groupBuckets, row.Group, row.BucketTs, counters{
			requestCount:  row.RequestCount,
			outputTokens:  row.OutputTokens,
			generationMs:  row.GenerationMs,
			cacheRequests: row.CacheRequests,
			cacheHits:     row.CacheHits,
			cachedTokens:  row.CachedTokens,
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

	result := buildCacheQueryResult(groupBuckets)
	result.StartTs = startTs
	result.EndTs = endTs
	return result, nil
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
	current.outputTokens += value.outputTokens
	current.generationMs += value.generationMs
	current.cacheRequests += value.cacheRequests
	current.cacheHits += value.cacheHits
	current.cachedTokens += value.cachedTokens
	groupBuckets[group][bucketTs] = current
}

func recentSuccessRates(buckets map[int64]counters, limit int) []float64 {
	if len(buckets) == 0 || limit <= 0 {
		return nil
	}
	timestamps := make([]int64, 0, len(buckets))
	for ts := range buckets {
		timestamps = append(timestamps, ts)
	}
	sort.Slice(timestamps, func(i, j int) bool {
		return timestamps[i] < timestamps[j]
	})
	if len(timestamps) > limit {
		timestamps = timestamps[len(timestamps)-limit:]
	}
	rates := make([]float64, 0, len(timestamps))
	for _, ts := range timestamps {
		rates = append(rates, math.Round(successRate(buckets[ts])*100)/100)
	}
	return rates
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
	current.cacheHits += value.cacheHits
	current.cachedTokens += value.cachedTokens
	merged[key] = current
}

func buildCacheQueryResult(groupBuckets map[string]map[int64]counters) CacheQueryResult {
	groupNames := make([]string, 0, len(groupBuckets))
	for group := range groupBuckets {
		groupNames = append(groupNames, group)
	}
	sort.Strings(groupNames)

	results := make([]CacheGroupResult, 0, len(groupNames))
	for _, group := range groupNames {
		result := buildCacheGroupResult(group, groupBuckets[group])
		results = append(results, result)
	}

	return CacheQueryResult{
		Groups: results,
	}
}

func buildCacheGroupResult(group string, buckets map[int64]counters) CacheGroupResult {
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
		total.outputTokens += value.outputTokens
		total.generationMs += value.generationMs
		total.cacheRequests += value.cacheRequests
		total.cacheHits += value.cacheHits
		total.cachedTokens += value.cachedTokens
		series = append(series, CacheBucketPoint{
			Ts:           ts,
			RequestCount: value.cacheRequests,
			HitCount:     value.cacheHits,
			CachedTokens: value.cachedTokens,
			CacheHitRate: cacheHitRate(value),
			AvgTps:       math.Round(avgTps(value)*100) / 100,
			HasData:      value.cacheRequests > 0,
		})
	}

	return CacheGroupResult{
		Group:        group,
		RequestCount: total.cacheRequests,
		HitCount:     total.cacheHits,
		CachedTokens: total.cachedTokens,
		CacheHitRate: cacheHitRate(total),
		AvgTps:       math.Round(avgTps(total)*100) / 100,
		HasData:      total.cacheRequests > 0,
		Series:       series,
	}
}

func buildQueryResult(modelName string, merged map[bucketKey]counters) QueryResult {
	groupBuckets := map[string]map[int64]counters{}
	for key, value := range merged {
		if value.requestCount == 0 {
			continue
		}
		if _, ok := groupBuckets[key.group]; !ok {
			groupBuckets[key.group] = map[int64]counters{}
		}
		groupBuckets[key.group][key.bucketTs] = value
	}

	groups := make([]string, 0, len(groupBuckets))
	for group := range groupBuckets {
		groups = append(groups, group)
	}
	sort.Strings(groups)

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

		results = append(results, GroupResult{
			Group:        group,
			AvgTtftMs:    avg(total.ttftSumMs, total.ttftCount),
			AvgLatencyMs: avg(total.totalLatencyMs, total.requestCount),
			SuccessRate:  successRate(total),
			AvgTps:       avgTps(total),
			Series:       series,
		})
	}

	return QueryResult{
		ModelName:    modelName,
		SeriesSchema: seriesSchema,
		Groups:       results,
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
	now := time.Now().Unix()
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
	if value.cacheRequests <= 0 {
		return 0
	}
	rate := float64(value.cacheHits) / float64(value.cacheRequests) * 100
	return math.Round(rate*100) / 100
}

func avgTps(value counters) float64 {
	if value.outputTokens <= 0 || value.generationMs <= 0 {
		return 0
	}
	return float64(value.outputTokens) / (float64(value.generationMs) / 1000)
}

func recordRedis(key bucketKey, sample Sample) {
	if !common.RedisEnabled || common.RDB == nil {
		return
	}
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

func mergeRedisActiveBuckets(merged map[bucketKey]counters, params QueryParams, startTs int64, endTs int64) {
	if !common.RedisEnabled || common.RDB == nil || params.Model == "" || params.Group == "" {
		return
	}
	active := bucketStart(time.Now().Unix())
	if active < startTs || active > endTs {
		return
	}
	key := bucketKey{model: params.Model, group: params.Group, bucketTs: active}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	values, err := common.RDB.HGetAll(ctx, redisBucketKey(key)).Result()
	if err != nil || len(values) == 0 {
		return
	}
	mergeCounters(merged, key, redisCounters(values))
}

func redisBucketKey(key bucketKey) string {
	return fmt.Sprintf("perf:%s:%s:%d", key.model, key.group, key.bucketTs)
}
