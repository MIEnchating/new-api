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

import { applyLogSearch, haveSameSearchParams } from '../filter'

describe('usage log search action', () => {
  const keys = ['page', 'model', 'type'] as const

  test('refetches instead of navigating when the user repeats a search', async () => {
    let navigateCalls = 0
    let refetchCalls = 0

    const action = await applyLogSearch({
      currentSearch: { page: 1, model: '', type: ['0'] },
      nextSearch: { page: 1, type: ['0'] },
      keys,
      navigate: () => {
        navigateCalls += 1
      },
      refetch: () => {
        refetchCalls += 1
      },
    })

    assert.equal(action, 'refetched')
    assert.equal(refetchCalls, 1)
    assert.equal(navigateCalls, 0)
  })

  test('navigates instead of refetching when a filter changes', async () => {
    let navigateCalls = 0
    let refetchCalls = 0

    const action = await applyLogSearch({
      currentSearch: { page: 1, model: 'gpt-5', type: ['0'] },
      nextSearch: { page: 1, model: 'claude', type: ['0'] },
      keys,
      navigate: () => {
        navigateCalls += 1
      },
      refetch: () => {
        refetchCalls += 1
      },
    })

    assert.equal(action, 'navigated')
    assert.equal(navigateCalls, 1)
    assert.equal(refetchCalls, 0)
  })

  test('treats a page reset as a new search', () => {
    assert.equal(
      haveSameSearchParams(
        { page: 2, model: 'gpt-5', type: ['0'] },
        { page: 1, model: 'gpt-5', type: ['0'] },
        keys
      ),
      false
    )
  })

  test('compares array filters by value', () => {
    assert.equal(
      haveSameSearchParams(
        { page: 1, type: ['2'] },
        { page: 1, type: ['3'] },
        keys
      ),
      false
    )
  })
})
