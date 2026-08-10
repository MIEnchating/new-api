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
import type {
  RecentRequestStats,
  RequestWindowStats,
  UptimeHeartbeat,
} from '@/features/dashboard/types'

export function getOrderedHeartbeats(heartbeats?: UptimeHeartbeat[]) {
  return [...(heartbeats ?? [])]
    .sort((left, right) => {
      const leftTime = left.time ? new Date(left.time).getTime() : 0
      const rightTime = right.time ? new Date(right.time).getTime() : 0
      return leftTime - rightTime
    })
    .slice(-288)
}

export function getMonitorRequestStats(
  stats: RecentRequestStats | null,
  monitorName?: string,
  monitorGroup?: string
): RecentRequestStats | null {
  const names = [monitorName, monitorGroup]
    .map((name) => name?.trim())
    .filter((name): name is string => Boolean(name))
  for (const name of names) {
    const matched = stats?.by_group?.[name]
    if (matched) return matched
  }
  return null
}

export function getLatestRequestWindow(
  stats: RecentRequestStats | null | undefined
): RequestWindowStats | null {
  if (stats?.['5m']?.has_data) return stats['5m']
  if (stats?.['30m']?.has_data) return stats['30m']
  if (stats?.['1h']?.has_data) return stats['1h']
  return null
}

export function getRealRequestStatus(
  stats: RecentRequestStats | null | undefined
): number {
  const window = getLatestRequestWindow(stats)
  if (!window) return -1
  if (window.failure_count !== undefined) {
    if (window.failure_count <= 0) return 1
    if ((window.success_count ?? 0) <= 0) return 0
    return 2
  }
  if (window.success_rate >= 100) return 1
  if (window.success_rate <= 0) return 0
  return 2
}
