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

import type { UptimeHeartbeat } from '@/features/dashboard/types'

import { getOrderedHeartbeats } from './monitor-utils'

function heartbeat(time: string): UptimeHeartbeat {
  return { time, status: 1, ping: 10 }
}

describe('status monitor heartbeat ordering', () => {
  test('sorts heartbeats without mutating the API response', () => {
    const heartbeats = [
      heartbeat('2026-07-19T03:00:00Z'),
      heartbeat('2026-07-19T01:00:00Z'),
      heartbeat('2026-07-19T02:00:00Z'),
    ]

    assert.deepEqual(
      getOrderedHeartbeats(heartbeats).map((item) => item.time),
      ['2026-07-19T01:00:00Z', '2026-07-19T02:00:00Z', '2026-07-19T03:00:00Z']
    )
    assert.equal(heartbeats[0]?.time, '2026-07-19T03:00:00Z')
  })

  test('keeps only the latest 288 heartbeats', () => {
    const heartbeats = Array.from({ length: 300 }, (_, index) =>
      heartbeat(new Date(index * 1000).toISOString())
    )

    const result = getOrderedHeartbeats(heartbeats)

    assert.equal(result.length, 288)
    assert.equal(result[0]?.time, new Date(12_000).toISOString())
    assert.equal(result.at(-1)?.time, new Date(299_000).toISOString())
  })
})
