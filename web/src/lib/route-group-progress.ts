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
type StoredRouteGroupStatus =
  | 'pending'
  | 'active'
  | 'cooling'
  | 'skipped'
  | 'success'
  | 'failed'

type RouteGroupTrace = {
  group?: string
  route_groups?: string[]
  route_group_statuses?: Array<{
    group: string
    status?: StoredRouteGroupStatus
  }>
  status?: 'running' | 'success' | 'failed' | 'cancelled'
}

export type DisplayRouteGroupStatus = StoredRouteGroupStatus | 'not_executed'

export function resolveRouteGroupProgress(trace: RouteGroupTrace) {
  const statusByGroup = new Map(
    trace.route_group_statuses?.map((item) => [item.group, item.status]) ?? []
  )
  let groups = trace.route_groups ?? []
  if (groups.length === 0 && statusByGroup.size > 0) {
    groups = [...statusByGroup.keys()]
  }
  if (groups.length === 0 && trace.group) groups = [trace.group]
  const terminal =
    trace.status === 'success' ||
    trace.status === 'failed' ||
    trace.status === 'cancelled'

  return groups.map((group) => {
    let status: DisplayRouteGroupStatus = statusByGroup.get(group) ?? 'pending'
    if (group === trace.group) {
      if (trace.status === 'success') status = 'success'
      if (trace.status === 'failed' || trace.status === 'cancelled') {
        status = 'failed'
      }
    } else if (terminal && status === 'pending') {
      status = 'not_executed'
    }
    return { group, status }
  })
}
