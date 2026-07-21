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
export type CacheMetricPoint = {
  ts: number
  request_count: number
  hit_count: number
  cached_tokens: number
  cache_hit_rate: number
}

export type CacheMetricGroup = {
  group: string
  request_count: number
  hit_count: number
  cached_tokens: number
  cache_hit_rate: number
  series: CacheMetricPoint[]
}

export type CacheMetricsResponse = {
  success: boolean
  message?: string
  data: {
    total: CacheMetricGroup
    groups: CacheMetricGroup[]
    baseline: number
    bucket_seconds: number
    available_groups: string[]
    display_groups: string[]
    all_groups: boolean
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
}

export type OfficialProviderStatus = {
  provider: string
  available: boolean
  indicator: string
  description: string
  status_url: string
  subscribe_url: string
  incidents: OfficialProviderIncident[]
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
