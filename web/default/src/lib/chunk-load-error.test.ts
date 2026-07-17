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

import { isChunkLoadError } from './chunk-load-error.ts'

describe('isChunkLoadError', () => {
  test('recognizes Rspack chunk load failures', () => {
    assert.equal(
      isChunkLoadError(
        new Error(
          'Loading chunk wallet failed. (error: https://example.com/assets/wallet.js)'
        )
      ),
      true
    )
    assert.equal(isChunkLoadError({ name: 'ChunkLoadError' }), true)
  })

  test('recognizes browser dynamic import failures', () => {
    assert.equal(
      isChunkLoadError('Failed to fetch dynamically imported module'),
      true
    )
  })

  test('does not classify unrelated errors as chunk failures', () => {
    assert.equal(
      isChunkLoadError(new Error('Request failed with status code 500')),
      false
    )
    assert.equal(isChunkLoadError(null), false)
  })
})
