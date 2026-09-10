/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
export type HealthThresholds = {
  minimum_sample: number
  warning_error_rate: number
  critical_error_rate: number
  target_ttft_ms: number
  warning_ttft_ms: number
  critical_ttft_ms: number
  warning_cache_rate: number
  critical_cache_rate: number
}

export type MonitorHealth = {
  overall: 'healthy' | 'warning' | 'critical' | 'unknown'
  error_rate: 'healthy' | 'warning' | 'critical' | 'unknown'
  ttft: 'healthy' | 'warning' | 'critical' | 'unknown'
  cache: 'healthy' | 'warning' | 'critical' | 'unknown'
  score: number | null
  error_rate_percent: number | null
  avg_ttft_ms: number | null
}

export function defaultHealthThresholds(baseline = 85): HealthThresholds {
  return {
    minimum_sample: 50,
    warning_error_rate: 5,
    critical_error_rate: 20,
    target_ttft_ms: 3000,
    warning_ttft_ms: 8000,
    critical_ttft_ms: 20000,
    warning_cache_rate: baseline,
    critical_cache_rate: Math.min(60, baseline),
  }
}

export type CacheMetricPoint = {
  health?: MonitorHealth
  ts: number
  request_count?: number
  hit_count?: number
  cached_tokens: number
  cache_hit_rate: number
  avg_tps: number
  has_data: boolean
}

export type CacheMetricGroup = {
  health?: MonitorHealth
  group: string
  request_count?: number
  hit_count?: number
  cached_tokens: number
  cache_hit_rate: number
  avg_tps: number
  has_data: boolean
  series: CacheMetricPoint[]
}

export type CacheMetricsResponse = {
  success: boolean
  message?: string
  data: {
    start_ts: number
    end_ts: number
    groups: CacheMetricGroup[]
    summary?: {
      series?: Pick<
        CacheMetricPoint,
        'ts' | 'health' | 'cache_hit_rate' | 'has_data'
      >[]
      health: MonitorHealth
      cache_hit_rate: number
      has_data: boolean
    }
    baseline: number
    health_thresholds?: HealthThresholds
    bucket_seconds: number
    available_groups: string[]
    display_groups: string[]
    all_groups: boolean
    counts_visible: boolean
  }
}

export type UpdateCacheMonitorGroupsResponse = {
  success: boolean
  message?: string
  data: {
    all_groups: boolean
    display_groups: string[]
  }
}

export type OfficialProviderIncident = {
  name: string
  status: string
  impact: string
  message: string
  updated_at: string
  url: string
  components: OfficialProviderComponent[]
}

export type OfficialProviderComponent = {
  id: string
  name: string
  status: string
  updated_at: string
  group?: boolean
  group_id?: string
}

export type OfficialProviderStatus = {
  provider: string
  available: boolean
  indicator: string
  description: string
  status_url: string
  subscribe_url: string
  checked_at: string
  components: OfficialProviderComponent[]
  incidents: OfficialProviderIncident[]
  error_code?: string
  error_message?: string
}

export type OfficialProviderStatusResponse = {
  success: boolean
  message?: string
  data: {
    providers: OfficialProviderStatus[]
  }
}

export type UpdateCacheHitRateBaselineResponse = {
  success: boolean
  message?: string
  data: {
    baseline: number
  }
}
