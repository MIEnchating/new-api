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

import { resolveRouteGroupProgress } from '../../../lib/route-group-progress.ts'

describe('route group progress', () => {
  test('keeps the current group visible when no route chain was stored', () => {
    const progress = resolveRouteGroupProgress({
      status: 'success',
      group: 'codex-special',
    })

    assert.deepEqual(progress, [{ group: 'codex-special', status: 'success' }])
  })

  test('marks unused fallback groups as not executed after success', () => {
    const progress = resolveRouteGroupProgress({
      status: 'success',
      group: 'codex-special',
      route_groups: ['codex-special', 'codex', 'codex-pro'],
      route_group_statuses: [
        { group: 'codex-special', status: 'success' },
        { group: 'codex', status: 'pending' },
        { group: 'codex-pro', status: 'pending' },
      ],
    })

    assert.deepEqual(progress, [
      { group: 'codex-special', status: 'success' },
      { group: 'codex', status: 'not_executed' },
      { group: 'codex-pro', status: 'not_executed' },
    ])
  })

  test('keeps live and cooling states while a request is running', () => {
    const progress = resolveRouteGroupProgress({
      status: 'running',
      group: 'primary',
      route_groups: ['primary', 'fallback'],
      route_group_statuses: [
        { group: 'primary', status: 'active' },
        { group: 'fallback', status: 'cooling' },
      ],
    })

    assert.deepEqual(progress, [
      { group: 'primary', status: 'active' },
      { group: 'fallback', status: 'cooling' },
    ])
  })
})
