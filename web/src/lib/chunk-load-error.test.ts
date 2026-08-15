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

import {
  buildChunkRecoveryURL,
  getChunkErrorSignature,
  isChunkAssetURL,
  isChunkLoadError,
  readChunkRecoveryAttempt,
  shouldReloadAfterChunkError,
} from './chunk-load-error.ts'

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

  test('recognizes async production assets without matching API URLs', () => {
    assert.equal(
      isChunkAssetURL('https://example.com/static/js/async/123.js'),
      true
    )
    assert.equal(
      isChunkAssetURL('https://example.com/static/css/123.css'),
      true
    )
    assert.equal(
      isChunkAssetURL('https://example.com/static/js/vendor-react.js'),
      true
    )
    assert.equal(isChunkAssetURL('https://example.com/api/status'), false)
  })

  test('isolates recovery attempts by build and failed asset', () => {
    const firstError = new Error(
      'Loading chunk https://example.com/static/js/async/sign-in.js failed'
    )
    const otherError = new Error(
      'Loading chunk https://example.com/static/js/async/dashboard.js failed'
    )
    const firstSignature = getChunkErrorSignature(firstError)
    assert.ok(firstSignature)
    const previous = {
      buildRevision: 'build-a',
      signature: firstSignature,
      attemptedAt: 90_000,
    }

    assert.equal(
      shouldReloadAfterChunkError(firstError, previous, 'build-a', 100_000),
      false
    )
    assert.equal(
      shouldReloadAfterChunkError(otherError, previous, 'build-a', 100_000),
      true
    )
    assert.equal(
      shouldReloadAfterChunkError(
        otherError,
        { ...previous, attemptCount: 2 },
        'build-a',
        100_000
      ),
      false
    )
    assert.equal(
      shouldReloadAfterChunkError(firstError, previous, 'build-b', 100_000),
      true
    )
    assert.equal(
      shouldReloadAfterChunkError(firstError, previous, 'build-a', 130_001),
      true
    )
    assert.equal(
      shouldReloadAfterChunkError(
        firstError,
        { ...previous, attemptedAt: 110_000 },
        'build-a',
        100_000
      ),
      true
    )
    assert.equal(
      shouldReloadAfterChunkError(
        new Error('Request failed'),
        previous,
        'build-a',
        100_000
      ),
      false
    )
  })

  test('ignores the legacy timestamp and malformed recovery state', () => {
    assert.equal(readChunkRecoveryAttempt('100000'), null)
    assert.equal(readChunkRecoveryAttempt('{not-json'), null)
    assert.equal(readChunkRecoveryAttempt(null), null)

    assert.deepEqual(
      readChunkRecoveryAttempt(
        JSON.stringify({
          buildRevision: 'build-a',
          signature: '/static/js/async/sign-in.js',
          attemptedAt: 100_000,
        })
      ),
      {
        buildRevision: 'build-a',
        signature: '/static/js/async/sign-in.js',
        attemptedAt: 100_000,
      }
    )
    assert.deepEqual(
      readChunkRecoveryAttempt(
        JSON.stringify({
          buildRevision: 'build-a',
          signature: '/static/js/async/sign-in.js',
          attemptedAt: 100_000,
          attemptCount: 2,
        })
      )?.attemptCount,
      2
    )
  })

  test('adds a cache buster without dropping the current location', () => {
    assert.equal(
      buildChunkRecoveryURL('https://example.com/?from=home#section', 1234),
      'https://example.com/?from=home&__newapi_reload=1234#section'
    )
  })
})
