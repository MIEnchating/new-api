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
  includeSelectedUsageLogGroup,
  normalizeUsageLogGroups,
} from './group-options-api'

describe('usage log group options', () => {
  test('keeps the configured order returned to administrators', () => {
    assert.deepEqual(normalizeUsageLogGroups(['pro', 'default']), [
      'pro',
      'default',
    ])
  })

  test('sorts user-visible groups by their order metadata', () => {
    assert.deepEqual(
      normalizeUsageLogGroups({
        default: { order: 2 },
        auto: { order: 3 },
        pro: { order: 1 },
      }),
      ['pro', 'default', 'auto']
    )
  })

  test('keeps an existing selected group in its configured position', () => {
    assert.deepEqual(
      includeSelectedUsageLogGroup(['pro', 'default', 'auto'], 'auto'),
      ['pro', 'default', 'auto']
    )
  })

  test('appends a selected legacy group only when it is unavailable', () => {
    assert.deepEqual(
      includeSelectedUsageLogGroup(['pro', 'default'], 'legacy'),
      ['pro', 'default', 'legacy']
    )
  })
})
