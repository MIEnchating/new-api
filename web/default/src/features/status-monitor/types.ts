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
  }
}

export type UpdateCacheHitRateBaselineResponse = {
  success: boolean
  message?: string
  data: {
    baseline: number
  }
}
