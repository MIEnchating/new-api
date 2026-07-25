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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { ChannelExecutionPlan } from '../api.ts'
import { resolvePlanCandidateStatuses } from './channel-execution-plan.ts'

function plan(pools: ChannelExecutionPlan['pools']): ChannelExecutionPlan {
  return {
    mode: 'route',
    group: 'default',
    model: 'model',
    request_path: '/v1/responses',
    max_attempts: 3,
    pools,
  }
}

function candidate(
  channelId: number,
  weight = 0,
  state: 'candidate' | 'cooling' = 'candidate'
) {
  return {
    channel_id: channelId,
    channel_name: `channel-${channelId}`,
    priority: 1000 - channelId,
    weight,
    state,
  }
}

describe('channel execution plan display status', () => {
  test('marks one highest-priority channel current and lower levels standby', () => {
    const result = resolvePlanCandidateStatuses(
      plan([
        { priority: 900, candidates: [candidate(1)] },
        { priority: 800, candidates: [candidate(2)] },
        { priority: 700, candidates: [candidate(3)] },
      ])
    )

    assert.equal(result.activePoolIndex, 0)
    assert.equal(result.statuses.get(1), 'current')
    assert.equal(result.statuses.get(2), 'standby')
    assert.equal(result.statuses.get(3), 'standby')
  })

  test('keeps multiple channels in the active weighted pool eligible', () => {
    const result = resolvePlanCandidateStatuses(
      plan([
        { priority: 900, candidates: [candidate(1, 10), candidate(2, 20)] },
        { priority: 800, candidates: [candidate(3)] },
      ])
    )

    assert.equal(result.statuses.get(1), 'eligible')
    assert.equal(result.statuses.get(2), 'eligible')
    assert.equal(result.statuses.get(3), 'standby')
  })

  test('skips cooling and zero-weight exclusions before selecting a lower pool', () => {
    const result = resolvePlanCandidateStatuses(
      plan([
        {
          priority: 900,
          candidates: [candidate(1, 10, 'cooling'), candidate(2, 0)],
        },
        { priority: 800, candidates: [candidate(3)] },
      ])
    )

    assert.equal(result.activePoolIndex, 1)
    assert.equal(result.statuses.get(1), 'cooling')
    assert.equal(result.statuses.get(2), 'excluded')
    assert.equal(result.statuses.get(3), 'current')
  })
})
