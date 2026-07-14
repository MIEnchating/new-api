import { api } from '@/lib/api'

import type {
  CacheMetricsResponse,
  UpdateCacheHitRateBaselineResponse,
} from './types'

export function getCacheMetrics(hours = 24) {
  return api
    .get<CacheMetricsResponse>('/api/status-monitor/cache', {
      params: { hours },
    })
    .then((response) => response.data)
}

export function updateCacheHitRateBaseline(baseline: number) {
  return api
    .put<UpdateCacheHitRateBaselineResponse>(
      '/api/status-monitor/cache/baseline',
      { baseline }
    )
    .then((response) => response.data)
}
