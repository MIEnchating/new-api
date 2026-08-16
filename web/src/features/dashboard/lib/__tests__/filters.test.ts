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

import { getRollingDateRange } from '../../../../lib/time'
import {
  detectDashboardQuickRange,
  getDashboardCalendarRange,
} from '../filters'

const NOW = new Date(2026, 7, 15, 14, 35, 42, 123)

describe('dashboard quick date ranges', () => {
  test('uses the current local day for today', () => {
    const range = getDashboardCalendarRange('today', NOW)

    assert.deepEqual(
      [
        range.start.getFullYear(),
        range.start.getMonth(),
        range.start.getDate(),
        range.start.getHours(),
        range.start.getMinutes(),
        range.start.getSeconds(),
        range.start.getMilliseconds(),
      ],
      [2026, 7, 15, 0, 0, 0, 0]
    )
    assert.equal(range.end.getTime(), NOW.getTime())
    assert.equal(
      detectDashboardQuickRange(
        { start_timestamp: range.start, end_timestamp: range.end },
        NOW
      ),
      'today'
    )
  })

  test('uses the complete previous local day for yesterday', () => {
    const range = getDashboardCalendarRange('yesterday', NOW)

    assert.deepEqual(
      [
        range.start.getDate(),
        range.start.getHours(),
        range.end.getDate(),
        range.end.getHours(),
        range.end.getMinutes(),
        range.end.getSeconds(),
        range.end.getMilliseconds(),
      ],
      [14, 0, 14, 23, 59, 59, 999]
    )
    assert.equal(
      detectDashboardQuickRange(
        { start_timestamp: range.start, end_timestamp: range.end },
        NOW
      ),
      'yesterday'
    )
  })

  test('keeps a rolling day distinct from today and yesterday', () => {
    const range = getRollingDateRange(1, NOW)
    assert.equal(
      detectDashboardQuickRange(
        { start_timestamp: range.start, end_timestamp: range.end },
        NOW
      ),
      1
    )
  })
})
