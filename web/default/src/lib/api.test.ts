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

import { applyUserHeader, getGetRequestKey } from './api.ts'

describe('API user identity header', () => {
  test('adds the cached identity to ordinary requests', () => {
    const config: { headers: Record<string, string> } = { headers: {} }
    applyUserHeader(config, '42')
    assert.equal(config.headers['New-Api-User'], '42')
  })

  test('removes a stale identity when the request opts out', () => {
    const config: {
      skipUserHeader: boolean
      headers: Record<string, string>
    } = {
      skipUserHeader: true,
      headers: { 'New-Api-User': 'stale', 'new-api-user': 'stale' },
    }
    applyUserHeader(config, '42')
    assert.equal(config.headers['New-Api-User'], undefined)
    assert.equal(config.headers['new-api-user'], undefined)
  })

  test('isolates in-flight requests by cached user identity', () => {
    const first = getGetRequestKey('/api/user/self', {}, 'uid:42')
    const second = getGetRequestKey('/api/user/self', {}, 'uid:99')

    assert.notEqual(first, second)
  })

  test('does not deduplicate explicit bearer-token requests', () => {
    const key = getGetRequestKey('/api/user/models', {
      headers: { Authorization: 'Bearer token-a' },
    })

    assert.equal(key, null)
  })

  test('separates cookie-only identity checks from header-authenticated calls', () => {
    const cookieOnly = getGetRequestKey(
      '/api/user/self',
      { skipUserHeader: true },
      'uid:42'
    )
    const withHeader = getGetRequestKey('/api/user/self', {}, 'uid:42')

    assert.notEqual(cookieOnly, withHeader)
  })
})
