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
