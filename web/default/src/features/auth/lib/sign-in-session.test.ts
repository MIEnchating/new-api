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

import { validateCachedSignInSession } from './sign-in-session.ts'

describe('sign-in session validation', () => {
  test('restores a cookie session when local user data is missing', async () => {
    const cookieUser = {
      id: 42,
      username: 'oauth-user',
      role: 1,
      status: 1,
    }
    let fetchCount = 0
    let clearCount = 0
    let persistedUser: typeof cookieUser | undefined
    const valid = await validateCachedSignInSession({
      cachedUser: null,
      fetchCurrentUser: async () => {
        fetchCount += 1
        return { success: true, data: cookieUser }
      },
      persistCurrentUser: (user) => {
        persistedUser = user
      },
      clearCachedUser: () => {
        clearCount += 1
      },
    })

    assert.equal(valid, true)
    assert.equal(fetchCount, 1)
    assert.deepEqual(persistedUser, cookieUser)
    assert.equal(clearCount, 0)
  })

  test('clears local state when no cookie session can be restored', async () => {
    let fetchCount = 0
    let clearCount = 0
    const valid = await validateCachedSignInSession({
      cachedUser: null,
      fetchCurrentUser: async () => {
        fetchCount += 1
        return { success: false }
      },
      persistCurrentUser: () => undefined,
      clearCachedUser: () => {
        clearCount += 1
      },
    })

    assert.equal(valid, false)
    assert.equal(fetchCount, 1)
    assert.equal(clearCount, 1)
  })

  test('keeps only a server-validated cached session', async () => {
    const serverUser = {
      id: 42,
      username: 'server-user',
      role: 1,
      status: 1,
    }
    let persistedUser: typeof serverUser | undefined
    let clearCount = 0
    const valid = await validateCachedSignInSession({
      cachedUser: { id: 7, username: 'cached-user' },
      fetchCurrentUser: async () => ({ success: true, data: serverUser }),
      persistCurrentUser: (user) => {
        persistedUser = user
      },
      clearCachedUser: () => {
        clearCount += 1
      },
    })

    assert.equal(valid, true)
    assert.deepEqual(persistedUser, serverUser)
    assert.equal(clearCount, 0)
  })

  test('clears stale local state when server validation fails', async () => {
    let clearCount = 0
    const valid = await validateCachedSignInSession({
      cachedUser: { id: 7 },
      fetchCurrentUser: async () => {
        throw new Error('unauthorized')
      },
      persistCurrentUser: () => undefined,
      clearCachedUser: () => {
        clearCount += 1
      },
    })

    assert.equal(valid, false)
    assert.equal(clearCount, 1)
  })

  test('rejects a successful response with an invalid user shape', async () => {
    let clearCount = 0
    const valid = await validateCachedSignInSession({
      cachedUser: { id: 7 },
      fetchCurrentUser: async () => ({
        success: true,
        data: { id: 42, username: 'missing-role-and-status' },
      }),
      persistCurrentUser: () => undefined,
      clearCachedUser: () => {
        clearCount += 1
      },
    })

    assert.equal(valid, false)
    assert.equal(clearCount, 1)
  })
})
