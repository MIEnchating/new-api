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
