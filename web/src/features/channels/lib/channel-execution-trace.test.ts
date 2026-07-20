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

import { selectExecutionTrace } from './channel-execution-trace.ts'

describe('execution trace selection', () => {
  const recent = { request_id: 'recent' }
  const searched = { request_id: 'searched' }

  test('uses a successful direct search result', () => {
    assert.deepEqual(
      selectExecutionTrace(
        'searched',
        { success: true, data: searched },
        recent
      ),
      searched
    )
  })

  test('does not fall back to a recent trace for a failed search', () => {
    assert.equal(
      selectExecutionTrace('missing', { success: false }, recent),
      undefined
    )
    assert.equal(selectExecutionTrace('missing', undefined, recent), undefined)
  })

  test('uses the selected recent trace when no direct search is active', () => {
    assert.deepEqual(selectExecutionTrace('', undefined, recent), recent)
  })
})
