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

import {
  completeLoginSession,
  isValidLoginSessionUser,
} from './login-session.ts'

const validUser = {
  id: 42,
  username: 'user-42',
  role: 1,
  status: 1,
}

describe('login session completion', () => {
  test('persists and navigates only after a valid self response', async () => {
    let persisted: typeof validUser | undefined
    let cleared = 0
    let navigated = 0

    const completed = await completeLoginSession({
      fetchCurrentUser: async () => ({ success: true, data: validUser }),
      persistUser: (user) => {
        persisted = user
      },
      clearUser: () => {
        cleared += 1
      },
      onSuccess: () => {
        navigated += 1
      },
    })

    assert.equal(completed, true)
    assert.deepEqual(persisted, validUser)
    assert.equal(cleared, 0)
    assert.equal(navigated, 1)
  })

  test('clears stale state and does not navigate on malformed success data', async () => {
    let cleared = 0
    let navigated = 0

    const completed = await completeLoginSession({
      fetchCurrentUser: async () => ({
        success: true,
        data: { id: validUser.id, username: validUser.username },
      }),
      persistUser: () => undefined,
      clearUser: () => {
        cleared += 1
      },
      onSuccess: () => {
        navigated += 1
      },
    })

    assert.equal(completed, false)
    assert.equal(cleared, 1)
    assert.equal(navigated, 0)
  })

  test('clears stale state and does not navigate when self lookup fails', async () => {
    let cleared = 0
    let navigated = 0

    const completed = await completeLoginSession({
      fetchCurrentUser: async () => {
        throw new Error('session unavailable')
      },
      persistUser: () => undefined,
      clearUser: () => {
        cleared += 1
      },
      onSuccess: () => {
        navigated += 1
      },
    })

    assert.equal(completed, false)
    assert.equal(cleared, 1)
    assert.equal(navigated, 0)
  })

  test('requires identity fields used by authenticated routes', () => {
    assert.equal(isValidLoginSessionUser(validUser), true)
    assert.equal(
      isValidLoginSessionUser({ ...validUser, role: undefined }),
      false
    )
    assert.equal(
      isValidLoginSessionUser({ ...validUser, status: Number.NaN }),
      false
    )
    assert.equal(isValidLoginSessionUser({ ...validUser, status: 2 }), false)
    assert.equal(isValidLoginSessionUser({ ...validUser, role: 0 }), false)
  })
})
