package perf_metrics_setting

import (
	"fmt"
	"math"

	"github.com/QuantumNous/new-api/setting/config"
)

type HealthThresholds struct {
	MinimumSample     int64   `json:"minimum_sample"`
	WarningErrorRate  float64 `json:"warning_error_rate"`
	CriticalErrorRate float64 `json:"critical_error_rate"`
	TargetTTFTMs      int64   `json:"target_ttft_ms"`
	WarningTTFTMs     int64   `json:"warning_ttft_ms"`
	CriticalTTFTMs    int64   `json:"critical_ttft_ms"`
	WarningCacheRate  float64 `json:"warning_cache_rate"`
	CriticalCacheRate float64 `json:"critical_cache_rate"`
}

// Rates use percentages (0–100), matching the cache metrics API.
func (h HealthThresholds) Validate() error {
	for _, rate := range []float64{h.WarningErrorRate, h.CriticalErrorRate, h.WarningCacheRate, h.CriticalCacheRate} {
		if math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 || rate > 100 {
			return fmt.Errorf("健康阈值百分比必须在 0 到 100 之间")
		}
	}
	if h.MinimumSample < 1 || h.MinimumSample > 1_000_000 {
		return fmt.Errorf("最小样本数必须在 1 到 1000000 之间")
	}
	if h.WarningErrorRate >= h.CriticalErrorRate {
		return fmt.Errorf("错误率关注阈值必须低于异常阈值")
	}
	if h.TargetTTFTMs < 1 || h.TargetTTFTMs > h.WarningTTFTMs || h.WarningTTFTMs >= h.CriticalTTFTMs || h.CriticalTTFTMs > 3_600_000 {
		return fmt.Errorf("TTFT 阈值必须满足 0 < 目标 ≤ 关注 < 异常 ≤ 3600000 ms")
	}
	if h.CriticalCacheRate > h.WarningCacheRate {
		return fmt.Errorf("缓存率异常阈值不能高于关注阈值")
	}
	return nil
}

type PerfMetricsSetting struct {
	HealthThresholds     *HealthThresholds `json:"health_thresholds"`
	Enabled              bool              `json:"enabled"`
	FlushInterval        int               `json:"flush_interval"`
	BucketTime           string            `json:"bucket_time"`
	RetentionDays        int               `json:"retention_days"`
	CacheHitRateBaseline int               `json:"cache_hit_rate_baseline"`
	CacheMonitorGroups   []string          `json:"cache_monitor_groups"`
}

var perfMetricsSetting = PerfMetricsSetting{
	Enabled:              true,
	FlushInterval:        5,
	BucketTime:           "hour",
	RetentionDays:        0,
	CacheHitRateBaseline: 85,
	CacheMonitorGroups:   []string{},
}

func init() {
	config.GlobalConfig.Register("perf_metrics_setting", &perfMetricsSetting)
}

func GetSetting() PerfMetricsSetting {
	return perfMetricsSetting
}

func GetBucketSeconds() int64 {
	switch perfMetricsSetting.BucketTime {
	case "minute":
		return 60
	case "5min":
		return 300
	case "hour":
		return 3600
	default:
		return 3600
	}
}

func GetFlushIntervalMinutes() int {
	if perfMetricsSetting.FlushInterval < 1 {
		return 1
	}
	return perfMetricsSetting.FlushInterval
}

func GetCacheHitRateBaseline() int {
	return int(GetHealthThresholds().WarningCacheRate)
}

func GetCacheMonitorGroups() []string {
	return append([]string(nil), perfMetricsSetting.CacheMonitorGroups...)
}

func GetHealthThresholds() HealthThresholds {
	if h := perfMetricsSetting.HealthThresholds; h != nil && h.Validate() == nil {
		return *h
	}
	return HealthThresholds{
		MinimumSample: 50, WarningErrorRate: 5, CriticalErrorRate: 20,
		TargetTTFTMs: 3000, WarningTTFTMs: 8000, CriticalTTFTMs: 20000,
		WarningCacheRate:  float64(perfMetricsSetting.CacheHitRateBaseline),
		CriticalCacheRate: float64(min(60, perfMetricsSetting.CacheHitRateBaseline)),
	}
}
