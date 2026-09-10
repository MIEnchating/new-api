package perfmetrics

import (
	"math"

	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
)

// MonitorHealth exposes assessments without exposing request/sample counts.
// The existing aggregates retain average TTFT, not latency percentiles.
type MonitorHealth struct {
	Overall          string   `json:"overall"`
	ErrorRate        string   `json:"error_rate"`
	TTFT             string   `json:"ttft"`
	Cache            string   `json:"cache"`
	Score            *float64 `json:"score"`
	ErrorRatePercent *float64 `json:"error_rate_percent"`
	AvgTTFTMs        *float64 `json:"avg_ttft_ms"`
}

func monitorHealth(value counters, thresholds perf_metrics_setting.HealthThresholds) MonitorHealth {
	result := MonitorHealth{Overall: "unknown", ErrorRate: "unknown", TTFT: "unknown", Cache: "unknown"}
	var scoreSum, weightSum float64
	if value.requestCount > 0 {
		rate := 100 * float64(value.requestCount-value.successCount) / float64(value.requestCount)
		rate = max(0, min(100, rate))
		result.ErrorRatePercent = &rate
	}
	if value.requestCount >= thresholds.MinimumSample {
		rate := *result.ErrorRatePercent
		result.ErrorRate = healthBand(rate, thresholds.WarningErrorRate, thresholds.CriticalErrorRate)
		scoreSum += 0.6 * max(0, 100*(1-rate/thresholds.CriticalErrorRate))
		weightSum += 0.6
	}
	if value.ttftCount > 0 {
		ttft := float64(value.ttftSumMs) / float64(value.ttftCount)
		result.AvgTTFTMs = &ttft
	}
	if value.ttftCount >= thresholds.MinimumSample {
		ttft := *result.AvgTTFTMs
		result.TTFT = healthBand(ttft, float64(thresholds.WarningTTFTMs), float64(thresholds.CriticalTTFTMs))
		score := 100 * (1 - (ttft-float64(thresholds.TargetTTFTMs))/float64(thresholds.CriticalTTFTMs-thresholds.TargetTTFTMs))
		scoreSum += 0.2 * max(0, min(100, score))
		weightSum += 0.2
	}
	// Cache rates are token-weighted where available; require enough eligible
	// requests as well so one large prompt cannot masquerade as a large sample.
	if value.cacheRequests >= thresholds.MinimumSample {
		rate := cacheHitRate(value)
		result.Cache = "healthy"
		if rate < thresholds.CriticalCacheRate {
			result.Cache = "critical"
		} else if rate < thresholds.WarningCacheRate {
			result.Cache = "warning"
		}
		if thresholds.WarningCacheRate == 0 && thresholds.CriticalCacheRate == 0 {
			rate = 100
		}
		scoreSum += 0.2 * rate
		weightSum += 0.2
	}
	if weightSum > 0 {
		score := math.Round(scoreSum/weightSum*100) / 100
		result.Score = &score
		result.Overall = "healthy"
		if score < 50 {
			result.Overall = "critical"
		} else if score < 80 {
			result.Overall = "warning"
		}
	}
	return result
}

func healthBand(value, warning, critical float64) string {
	if value >= critical {
		return "critical"
	}
	if value >= warning {
		return "warning"
	}
	return "healthy"
}
