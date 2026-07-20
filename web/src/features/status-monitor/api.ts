import { api } from '@/lib/api'

import type {
  CacheMetricsResponse,
  OfficialProviderStatusResponse,
  UpdateCacheHitRateBaselineResponse,
  UpdateCacheMonitorGroupsResponse,
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

export function updateCacheMonitorGroups(allGroups: boolean, groups: string[]) {
  return api
    .put<UpdateCacheMonitorGroupsResponse>('/api/status-monitor/cache/groups', {
      all_groups: allGroups,
      groups,
    })
    .then((response) => response.data)
}

export function getOfficialProviderStatuses() {
  return api
    .get<OfficialProviderStatusResponse>('/api/status-monitor/providers')
    .then((response) => response.data)
}
