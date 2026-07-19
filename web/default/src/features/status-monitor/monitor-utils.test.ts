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
      [
        '2026-07-19T01:00:00Z',
        '2026-07-19T02:00:00Z',
        '2026-07-19T03:00:00Z',
      ]
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
