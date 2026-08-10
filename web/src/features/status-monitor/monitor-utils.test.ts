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

import type {
  RecentRequestStats,
  UptimeHeartbeat,
} from '@/features/dashboard/types'

import {
  getLatestRequestWindow,
  getMonitorRequestStats,
  getOrderedHeartbeats,
  getRealRequestStatus,
} from './monitor-utils'

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

describe('status monitor request statistics mapping', () => {
  const emptyWindow = { success_rate: 0, has_data: false }
  const groupStats: RecentRequestStats = {
    '5m': { success_rate: 75, has_data: true },
    '30m': emptyWindow,
    '1h': emptyWindow,
  }
  const stats: RecentRequestStats = {
    '5m': { success_rate: 99, has_data: true },
    '30m': { success_rate: 98, has_data: true },
    '1h': { success_rate: 97, has_data: true },
    by_group: { 'group-a': groupStats },
  }

  test('returns statistics for the monitor name matching the log group', () => {
    assert.equal(getMonitorRequestStats(stats, 'group-a'), groupStats)
  })

  test('does not fall back to global statistics for an unmatched monitor', () => {
    assert.equal(getMonitorRequestStats(stats, 'missing-group'), null)
  })

  test('falls back to the configured monitor group name', () => {
    assert.equal(
      getMonitorRequestStats(stats, 'display-name', 'group-a'),
      groupStats
    )
  })

  test('uses the shortest request window with data', () => {
    assert.equal(getLatestRequestWindow(groupStats), groupStats['5m'])
    assert.equal(
      getLatestRequestWindow({
        ...groupStats,
        '5m': emptyWindow,
        '30m': { success_rate: 80, has_data: true },
      })?.success_rate,
      80
    )
  })

  test('derives request health from actual success and failure counts', () => {
    const withWindow = (successCount: number, failureCount: number) => ({
      ...groupStats,
      '5m': {
        success_rate:
          successCount + failureCount > 0
            ? (successCount / (successCount + failureCount)) * 100
            : 0,
        success_count: successCount,
        failure_count: failureCount,
        has_data: successCount + failureCount > 0,
      },
    })

    assert.equal(getRealRequestStatus(withWindow(3, 0)), 1)
    assert.equal(getRealRequestStatus(withWindow(2, 1)), 2)
    assert.equal(getRealRequestStatus(withWindow(0, 3)), 0)
    assert.equal(getRealRequestStatus(withWindow(0, 0)), -1)
  })
})
