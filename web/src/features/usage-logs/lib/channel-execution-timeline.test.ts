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
  buildCompactChannelExecutionEvents,
  buildChannelExecutionTimeline,
  getFailedChannelExecutionConclusion,
  getStandbyChannelIds,
} from '../../../lib/channel-execution-timeline.ts'

describe('channel execution timeline', () => {
  test('reconstructs a simple successful trace from its compact summary', () => {
    const events = buildCompactChannelExecutionEvents(
      {
        compact: true,
        status: 'success',
        group: 'codex-special',
        channel_ids: [116],
        channel_name: 'us-sub2-codex-special',
        priority: 900,
        affinity_hit: true,
        started_at: 100,
        updated_at: 370,
      },
      { channelId: 116, channelName: 'sub2api' }
    )

    assert.deepEqual(
      events.map((event) => event.state),
      ['affinity_hit', 'active', 'success']
    )
    assert.equal(events[0]?.channel_name, 'us-sub2-codex-special')
    assert.equal(events[0]?.priority, 900)
    assert.equal(events[1]?.priority, 900)
    assert.equal(events[2]?.priority, 900)
    assert.equal(events[1]?.timestamp, 100)
    assert.equal(events[2]?.timestamp, 370)
  })

  test('does not reconstruct a multi-channel compact summary', () => {
    const events = buildCompactChannelExecutionEvents(
      {
        compact: true,
        status: 'success',
        channel_ids: [116, 92],
      },
      {}
    )

    assert.deepEqual(events, [])
  })

  test('keeps the initial affinity selection, request, and result visible', () => {
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

    assert.equal(timeline.length, 3)
    assert.equal(timeline[0]?.kind, 'event')
    assert.equal(
      timeline[0]?.kind === 'event' ? timeline[0].event.state : undefined,
      'affinity_hit'
    )
    assert.equal(
      timeline[1]?.kind === 'event' ? timeline[1].event.state : undefined,
      'active'
    )
    const result = timeline[2]
    assert.equal(result?.kind, 'event')
    if (result?.kind !== 'event') return
    assert.equal(result.event.state, 'failed')
    assert.equal(result.startedAt, 120)
  })

  test('orders a late group affinity decision before one deduplicated channel request', () => {
    const timeline = buildChannelExecutionTimeline([
      {
        sequence: 1,
        timestamp: 100,
        channel_id: 92,
        channel_name: 'us-sub2-plus',
        state: 'affinity_hit',
        reason: 'route_affinity',
      },
      {
        sequence: 2,
        timestamp: 100,
        channel_id: 92,
        channel_name: 'us-sub2-plus',
        state: 'active',
      },
      {
        sequence: 3,
        timestamp: 100,
        group: 'codex',
        state: 'affinity_hit',
        reason: 'group_affinity',
      },
      {
        sequence: 4,
        timestamp: 100,
        channel_id: 92,
        channel_name: 'us-sub2-plus',
        state: 'active',
      },
      {
        sequence: 5,
        timestamp: 23300,
        channel_id: 92,
        channel_name: 'us-sub2-plus',
        state: 'success',
      },
    ])

    assert.deepEqual(
      timeline.map((item) =>
        item.kind === 'event'
          ? `${item.event.reason ?? 'request'}:${item.event.state}`
          : `attempt:${item.state}`
      ),
      [
        'group_affinity:affinity_hit',
        'route_affinity:affinity_hit',
        'request:active',
        'request:success',
      ]
    )
  })

  test('deduplicates an open channel request when a later routing event changes only the retry index', () => {
    const timeline = buildChannelExecutionTimeline([
      {
        sequence: 1,
        timestamp: 100,
        group: 'codex',
        channel_id: 92,
        channel_name: 'us-sub2-plus',
        priority: 1000,
        state: 'active',
      },
      {
        sequence: 2,
        timestamp: 100,
        group: 'codex',
        channel_id: 92,
        channel_name: 'us-sub2-plus',
        priority: 1000,
        retry_index: 1,
        state: 'active',
      },
      {
        sequence: 3,
        timestamp: 9400,
        group: 'codex',
        channel_id: 92,
        channel_name: 'us-sub2-plus',
        state: 'success',
      },
    ])

    assert.deepEqual(
      timeline.map((item) =>
        item.kind === 'event' ? item.event.state : item.state
      ),
      ['active', 'success']
    )
    const result = timeline[1]
    assert.equal(result?.kind, 'event')
    if (result?.kind !== 'event') return
    assert.equal(result.startedAt, 100)
  })

  test('adds a separate initial success when the terminal event is missing', () => {
    const timeline = buildChannelExecutionTimeline(
      [
        {
          sequence: 1,
          timestamp: 100,
          channel_id: 116,
          channel_name: 'sub2api',
          state: 'affinity_hit',
        },
        {
          sequence: 2,
          timestamp: 120,
          channel_id: 116,
          channel_name: 'sub2api',
          state: 'active',
        },
      ],
      { status: 'success', endedAt: 370 }
    )

    assert.equal(timeline.length, 3)
    assert.equal(
      timeline[1]?.kind === 'event' ? timeline[1].event.state : undefined,
      'active'
    )
    const result = timeline[2]
    assert.equal(result?.kind, 'event')
    if (result?.kind !== 'event') return
    assert.equal(result.event.state, 'success')
    assert.equal(result.startedAt, 120)
    assert.equal(result.event.timestamp, 370)
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

    assert.equal(timeline.length, 3)
    assert.equal(timeline[0]?.kind, 'event')
    assert.equal(timeline[1]?.kind, 'event')
    assert.equal(timeline[2]?.kind, 'attempt')
    if (timeline[2]?.kind !== 'attempt') return
    assert.equal(timeline[2].selectionState, 'same_channel_retry')
    assert.equal(timeline[2].retryIndex, 1)
    assert.equal(timeline[2].endedAt, 240)
  })

  test('keeps a missing retry success inside the merged retry attempt', () => {
    const timeline = buildChannelExecutionTimeline(
      [
        { timestamp: 100, channel_id: 167, state: 'active' },
        { timestamp: 150, channel_id: 167, state: 'failed' },
        {
          timestamp: 160,
          channel_id: 167,
          state: 'same_channel_retry',
          retry_index: 1,
        },
        { timestamp: 170, channel_id: 167, state: 'active' },
      ],
      { status: 'success', endedAt: 240 }
    )

    assert.equal(timeline.length, 3)
    const retry = timeline[2]
    assert.equal(retry?.kind, 'attempt')
    if (retry?.kind !== 'attempt') return
    assert.equal(retry.state, 'success')
    assert.equal(retry.startedAt, 170)
    assert.equal(retry.endedAt, 240)
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

  test('summarizes the final failed channel execution result', () => {
    const conclusion = getFailedChannelExecutionConclusion([
      {
        state: 'active',
        channel_id: 116,
        channel_name: 'primary',
      },
      {
        state: 'failed',
        channel_id: 116,
        channel_name: 'primary',
        reason: 'status_code=503',
      },
      {
        state: 'active',
        channel_id: 116,
        channel_name: 'primary',
      },
      {
        state: 'failed',
        channel_id: 116,
        channel_name: 'primary',
        reason: 'status_code=500',
      },
      {
        state: 'finished',
        reason: 'request_finished_without_success',
      },
    ])

    assert.deepEqual(conclusion, {
      reason: 'status_code=500',
      channelId: 116,
      channelName: 'primary',
      attemptCount: 2,
      channelCount: 1,
    })
  })

  test('hides the internal finished marker after failed attempts', () => {
    const timeline = buildChannelExecutionTimeline([
      {
        timestamp: 100,
        channel_id: 116,
        channel_name: 'us-sub2-codex-special',
        state: 'active',
      },
      {
        timestamp: 169,
        channel_id: 116,
        state: 'failed',
        reason: 'status_code=503, Service temporarily unavailable',
      },
      {
        timestamp: 170,
        channel_id: 116,
        state: 'same_channel_retry',
        retry_index: 1,
      },
      {
        timestamp: 171,
        channel_id: 116,
        state: 'active',
      },
      {
        timestamp: 200,
        channel_id: 116,
        state: 'failed',
        reason: 'status_code=500, upstream error: do request failed',
      },
      {
        timestamp: 201,
        group: 'codex-special',
        state: 'finished',
        reason: 'upstream error: do request failed',
      },
    ])

    assert.equal(timeline.length, 3)
    assert.equal(
      timeline.some(
        (item) => item.kind === 'event' && item.event.state === 'finished'
      ),
      false
    )
    assert.equal(timeline[0]?.kind, 'event')
    assert.equal(timeline[1]?.kind, 'event')
    assert.equal(timeline[2]?.kind, 'attempt')
    const finalAttempt = timeline[2]
    assert.equal(finalAttempt?.kind, 'attempt')
    if (finalAttempt?.kind !== 'attempt') return
    assert.equal(
      finalAttempt.reason,
      'status_code=500, upstream error: do request failed'
    )
  })

  test('closes the last in-flight channel when the request is cancelled', () => {
    const timeline = buildChannelExecutionTimeline(
      [
        {
          timestamp: 100,
          channel_id: 160,
          channel_name: 'primary',
          state: 'active',
        },
        {
          timestamp: 200,
          channel_id: 160,
          state: 'failed',
          reason: 'status_code=500, upstream error: do request failed',
        },
        {
          timestamp: 201,
          channel_id: 161,
          channel_name: 'fallback',
          state: 'active',
        },
        {
          timestamp: 240,
          state: 'finished',
          reason: 'context canceled',
        },
      ],
      { status: 'cancelled', endedAt: 240 }
    )

    assert.equal(timeline.length, 4)
    const cancelled = timeline[3]
    assert.equal(cancelled?.kind, 'event')
    if (cancelled?.kind !== 'event') return
    assert.equal(cancelled.event.channel_id, 161)
    assert.equal(cancelled.event.state, 'cancelled')
    assert.equal(cancelled.startedAt, 201)
    assert.equal(cancelled.event.timestamp, 240)
  })
})
