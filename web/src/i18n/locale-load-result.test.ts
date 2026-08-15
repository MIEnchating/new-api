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

import { evaluateLocaleLoader } from './locale-load-result'

describe('locale loader result', () => {
  test('reports a successfully loaded locale resource', async () => {
    const resource = { translation: { Dashboard: 'Dashboard' } }
    const result = await evaluateLocaleLoader('en', async () => resource)

    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.language, 'en')
      assert.equal(result.value, resource)
    }
  })

  test('reports a rejected locale chunk without hiding its error', async () => {
    const chunkError = new Error('Loading chunk zhCN failed')
    const result = await evaluateLocaleLoader('zhCN', async () => {
      throw chunkError
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.language, 'zhCN')
      assert.equal(result.error, chunkError)
    }
  })

  test('normalizes non-Error rejections into an actionable error', async () => {
    const result = await evaluateLocaleLoader('fr', async () => {
      throw 'network unavailable'
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.message, 'Unable to load locale: fr')
    }
  })
})
