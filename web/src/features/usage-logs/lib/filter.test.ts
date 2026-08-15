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

import { isExpiredLegacyLiveRange } from './time-range.ts'

describe('usage log time range', () => {
  const now = new Date(2026, 6, 24, 12, 0, 0)
  const todayStart = new Date(2026, 6, 24, 0, 0, 0).getTime()

  test('detects an expired legacy default range for today', () => {
    assert.equal(
      isExpiredLegacyLiveRange(
        todayStart,
        new Date(2026, 6, 24, 11, 0, 0).getTime(),
        now
      ),
      true
    )
  })

  test('keeps a future range and a historical range fixed', () => {
    assert.equal(
      isExpiredLegacyLiveRange(
        todayStart,
        new Date(2026, 6, 24, 13, 0, 0).getTime(),
        now
      ),
      false
    )
    assert.equal(
      isExpiredLegacyLiveRange(
        new Date(2026, 6, 23, 0, 0, 0).getTime(),
        new Date(2026, 6, 23, 23, 59, 59).getTime(),
        now
      ),
      false
    )
  })
})
