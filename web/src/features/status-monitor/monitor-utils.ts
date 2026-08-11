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
