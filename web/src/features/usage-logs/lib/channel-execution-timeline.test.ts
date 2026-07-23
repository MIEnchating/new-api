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

import {
  buildChannelExecutionTimeline,
  getStandbyChannelIds,
} from './channel-execution-timeline.ts'

describe('channel execution timeline', () => {
  test('merges affinity selection, request, and result into one attempt', () => {
    const timeline = buildChannelExecutionTimeline([
      {
        sequence: 1,
        timestamp: 100,
        channel_id: 167,
        channel_name: 'SwiftAPI-1',
        state: 'affinity_hit',
        reason: 'route_affinity',
      },
      {
        sequence: 2,
        timestamp: 120,
        channel_id: 167,
        channel_name: 'SwiftAPI-1',
        state: 'active',
        next_ids: [153],
      },
      {
        sequence: 3,
        timestamp: 370,
        channel_id: 167,
        channel_name: 'SwiftAPI-1',
        state: 'failed',
        reason: 'status_code=500',
      },
    ])

    assert.equal(timeline.length, 1)
    const attempt = timeline[0]
    assert.equal(attempt.kind, 'attempt')
    if (attempt.kind !== 'attempt') return
    assert.equal(attempt.selectionState, 'affinity_hit')
    assert.equal(attempt.state, 'failed')
    assert.equal(attempt.startedAt, 120)
    assert.equal(attempt.endedAt, 370)
    assert.deepEqual(attempt.nextIds, [153])
  })

  test('merges each same-channel retry into its own attempt', () => {
    const timeline = buildChannelExecutionTimeline([
      { timestamp: 100, channel_id: 167, state: 'active' },
      { timestamp: 150, channel_id: 167, state: 'failed' },
      {
        timestamp: 160,
        channel_id: 167,
        state: 'same_channel_retry',
        retry_index: 1,
      },
      { timestamp: 170, channel_id: 167, state: 'active' },
      { timestamp: 240, channel_id: 167, state: 'failed' },
    ])

    assert.equal(timeline.length, 2)
    assert.equal(timeline[1]?.kind, 'attempt')
    if (timeline[1]?.kind !== 'attempt') return
    assert.equal(timeline[1].selectionState, 'same_channel_retry')
    assert.equal(timeline[1].retryIndex, 1)
    assert.equal(timeline[1].endedAt, 240)
  })

  test('shows only standby channels that were not later attempted', () => {
    const timeline = buildChannelExecutionTimeline([
      {
        timestamp: 100,
        channel_id: 167,
        state: 'active',
        next_ids: [153, 120],
      },
      { timestamp: 150, channel_id: 167, state: 'failed' },
      { timestamp: 160, channel_id: 153, state: 'active', next_ids: [120] },
      { timestamp: 220, channel_id: 153, state: 'success' },
    ])

    assert.deepEqual(getStandbyChannelIds(timeline), [120])
  })
})
