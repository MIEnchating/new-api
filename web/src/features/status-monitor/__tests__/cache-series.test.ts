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

import { describe, test } from 'vitest'

import { buildCacheChartSeries } from '../cache-series'

describe('cache chart series', () => {
  test('fills missing buckets across the complete requested range', () => {
    const result = buildCacheChartSeries(
      [
        {
          ts: 7_200,
          request_count: 2,
          hit_count: 1,
          cached_tokens: 100,
          cache_hit_rate: 50,
          avg_tps: 12.5,
          has_data: true,
        },
      ],
      3_600,
      0,
      10_800
    )

    assert.deepEqual(
      result.map((point) => [point.ts, point.missing]),
      [
        [0, true],
        [3_600, true],
        [7_200, false],
        [10_800, true],
      ]
    )
    assert.equal(result[1]?.avg_tps, null)
    assert.equal(result[2]?.avg_tps, 12.5)
  })

  test('preserves data outside a stale requested boundary', () => {
    const result = buildCacheChartSeries(
      [
        {
          ts: 3_600,
          request_count: 1,
          hit_count: 1,
          cached_tokens: 20,
          cache_hit_rate: 100,
          avg_tps: 8,
          has_data: true,
        },
      ],
      3_600,
      7_200,
      10_800
    )

    assert.equal(result[0]?.ts, 3_600)
    assert.equal(result[0]?.missing, false)
  })
})
