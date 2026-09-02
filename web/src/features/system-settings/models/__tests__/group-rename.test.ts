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

import { composeGroupRenames } from '../group-rename'

describe('pending group rename composition', () => {
  test('keeps the original source across repeated edits before save', () => {
    const originalNames = new Set(['default', 'vip'])
    const first = composeGroupRenames([], originalNames, 'vip', 'pro')
    const second = composeGroupRenames(first, originalNames, 'pro', 'premium')

    assert.deepEqual(second, [{ from: 'vip', to: 'premium' }])
  })

  test('removes a pending migration when the name is changed back', () => {
    const originalNames = new Set(['default', 'vip'])
    const first = composeGroupRenames([], originalNames, 'vip', 'pro')

    assert.deepEqual(
      composeGroupRenames(first, originalNames, 'pro', 'vip'),
      []
    )
  })

  test('does not treat renaming a newly added row as a data migration', () => {
    const originalNames = new Set(['default'])

    assert.deepEqual(
      composeGroupRenames([], originalNames, 'group_1', 'internal'),
      []
    )
  })
})
