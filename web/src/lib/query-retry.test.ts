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

import { AxiosError, CanceledError, type AxiosResponse } from 'axios'
import { describe, test } from 'vitest'

import {
  isRetryableQueryError,
  MAX_QUERY_RETRIES,
  shouldRetryQuery,
} from './query-retry'

function makeHttpError(status: number): AxiosError {
  const error = new AxiosError('Request failed')
  error.response = { status } as AxiosResponse
  return error
}

describe('query retry policy', () => {
  test('retries Axios network failures and transient HTTP responses', () => {
    assert.equal(
      isRetryableQueryError(new AxiosError('Network error', 'ERR_NETWORK')),
      true
    )

    for (const status of [408, 429, 500, 502, 503, 504]) {
      assert.equal(isRetryableQueryError(makeHttpError(status)), true)
    }
  })

  test('does not retry client errors, permanent server errors, or cancellation', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 501, 505]) {
      assert.equal(isRetryableQueryError(makeHttpError(status)), false)
    }

    assert.equal(isRetryableQueryError(new CanceledError()), false)
    assert.equal(isRetryableQueryError(new Error('Application error')), false)
  })

  test('limits production queries to two retries and disables retries in dev', () => {
    const error = makeHttpError(503)
    assert.equal(shouldRetryQuery(0, error, false), true)
    assert.equal(shouldRetryQuery(1, error, false), true)
    assert.equal(shouldRetryQuery(MAX_QUERY_RETRIES, error, false), false)
    assert.equal(shouldRetryQuery(0, error, true), false)
  })
})
