/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

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

import { buildOAuthCallbackKey } from './oauth-callback.ts'

describe('OAuth callback identity', () => {
  test('is stable for the same callback', () => {
    const identity = {
      provider: 'github',
      code: 'one-time-code',
      state: 'state-1',
      redirect: '/dashboard',
    }
    assert.equal(
      buildOAuthCallbackKey(identity),
      buildOAuthCallbackKey(identity)
    )
  })

  test('changes when the authorization code changes', () => {
    const base = { provider: 'github', state: 'state-1' }
    assert.notEqual(
      buildOAuthCallbackKey({ ...base, code: 'code-a' }),
      buildOAuthCallbackKey({ ...base, code: 'code-b' })
    )
  })

  test('does not collide when values contain separators', () => {
    assert.notEqual(
      buildOAuthCallbackKey({ provider: 'a|b', code: 'c' }),
      buildOAuthCallbackKey({ provider: 'a', code: 'b|c' })
    )
  })
})
