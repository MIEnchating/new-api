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
import type { ChannelExecutionPlan } from '../api'

export type PlanCandidateDisplayStatus =
  | 'current'
  | 'eligible'
  | 'standby'
  | 'cooling'
  | 'excluded'

export function resolvePlanCandidateStatuses(plan: ChannelExecutionPlan) {
  const eligibleByPool = plan.pools.map((pool) => {
    const hasPositiveWeight = pool.candidates.some(
      (candidate) => candidate.weight > 0
    )
    return pool.candidates.filter(
      (candidate) =>
        candidate.state !== 'cooling' &&
        (!hasPositiveWeight || candidate.weight > 0)
    )
  })
  const activePoolIndex = eligibleByPool.findIndex(
    (candidates) => candidates.length > 0
  )
  const statuses = new Map<number, PlanCandidateDisplayStatus>()

  plan.pools.forEach((pool, poolIndex) => {
    const hasPositiveWeight = pool.candidates.some(
      (candidate) => candidate.weight > 0
    )
    const activeCandidates = eligibleByPool[poolIndex] ?? []
    for (const candidate of pool.candidates) {
      if (candidate.state === 'cooling') {
        statuses.set(candidate.channel_id, 'cooling')
      } else if (hasPositiveWeight && candidate.weight === 0) {
        statuses.set(candidate.channel_id, 'excluded')
      } else if (poolIndex === activePoolIndex) {
        statuses.set(
          candidate.channel_id,
          activeCandidates.length === 1 ? 'current' : 'eligible'
        )
      } else {
        statuses.set(candidate.channel_id, 'standby')
      }
    }
  })

  return { activePoolIndex, statuses }
}
