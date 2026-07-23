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

import type { ChannelExecutionTraceInfo } from '../types'
import { mergeExecutionTrace } from './execution-trace.ts'

const storedTerminal: ChannelExecutionTraceInfo = {
  compact: true,
  mode: 'route',
  status: 'success',
  group: 'codex-special',
  route_groups: ['codex-special', 'codex-pro'],
  route_group_statuses: [
    { group: 'codex-special', status: 'success' },
    { group: 'codex-pro', status: 'skipped' },
  ],
  channel_ids: [116, 92],
  affinity_hit: false,
}

const staleFetched: ChannelExecutionTraceInfo = {
  request_id: 'request-1',
  mode: 'route',
  status: 'running',
  group: 'codex-pro',
  route_groups: ['codex-pro'],
  route_group_statuses: [{ group: 'codex-pro', status: 'active' }],
  channel_ids: [92],
  affinity_hit: true,
  model: 'gpt-5.6',
  request_path: '/v1/responses',
  started_at: 100,
  updated_at: 200,
  events: [
    {
      sequence: 1,
      timestamp: 100,
      group: 'codex-pro',
      channel_id: 92,
      state: 'active',
    },
  ],
}

describe('execution trace merge', () => {
  test('keeps terminal SQL routing metadata over a stale Redis trace', () => {
    const merged = mergeExecutionTrace(storedTerminal, staleFetched)

    assert.equal(merged?.compact, false)
    assert.equal(merged?.status, 'success')
    assert.equal(merged?.group, 'codex-special')
    assert.deepEqual(merged?.route_groups, storedTerminal.route_groups)
    assert.deepEqual(
      merged?.route_group_statuses,
      storedTerminal.route_group_statuses
    )
    assert.deepEqual(merged?.channel_ids, [116, 92])
    assert.equal(merged?.affinity_hit, false)
  })

  test('fills event context from the full Redis trace', () => {
    const merged = mergeExecutionTrace(storedTerminal, staleFetched)

    assert.equal(merged?.request_id, 'request-1')
    assert.equal(merged?.model, 'gpt-5.6')
    assert.equal(merged?.request_path, '/v1/responses')
    assert.equal(merged?.started_at, 100)
    assert.equal(merged?.updated_at, 200)
    assert.deepEqual(merged?.events, staleFetched.events)
  })

  test('treats omitted terminal summary fields as empty and false', () => {
    const merged = mergeExecutionTrace(
      { compact: true, mode: 'route', status: 'success' },
      staleFetched
    )

    assert.equal(merged?.group, '')
    assert.deepEqual(merged?.route_groups, [])
    assert.deepEqual(merged?.route_group_statuses, [])
    assert.deepEqual(merged?.channel_ids, [])
    assert.equal(merged?.affinity_hit, false)
  })

  test('uses the fetched metadata while the stored trace is not terminal', () => {
    const merged = mergeExecutionTrace(
      { ...storedTerminal, status: 'running' },
      { ...staleFetched, status: 'success' }
    )

    assert.equal(merged?.status, 'success')
    assert.equal(merged?.group, 'codex-pro')
    assert.deepEqual(merged?.channel_ids, [92])
    assert.equal(merged?.affinity_hit, true)
  })

  test('replaces a non-compact intermediate failure with the final trace', () => {
    const intermediateFailure: ChannelExecutionTraceInfo = {
      ...staleFetched,
      status: 'failed',
      updated_at: 150,
    }
    const completedFallback: ChannelExecutionTraceInfo = {
      ...staleFetched,
      status: 'success',
      updated_at: 300,
      channel_ids: [167, 153],
      events: [
        ...(staleFetched.events ?? []),
        {
          sequence: 2,
          timestamp: 300,
          group: 'codex-pro',
          channel_id: 153,
          state: 'success',
        },
      ],
    }

    const merged = mergeExecutionTrace(intermediateFailure, completedFallback)

    assert.equal(merged?.status, 'success')
    assert.equal(merged?.updated_at, 300)
    assert.deepEqual(merged?.channel_ids, [167, 153])
    assert.equal(merged?.events?.at(-1)?.channel_id, 153)
  })

  test('returns the stored summary when no full trace is available', () => {
    assert.equal(mergeExecutionTrace(storedTerminal, undefined), storedTerminal)
  })
})
