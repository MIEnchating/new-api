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

import type { AuthBootstrapState, AuthUser } from '@/stores/auth-store'

import {
  AuthenticationRecoveryUnavailableError,
  resolveProtectedRouteAuthentication,
} from '../protected-route-auth'

type AuthState = {
  user: AuthUser | null
  accessToken: string | null
  bootstrapState: AuthBootstrapState
}

const authenticatedState: AuthState = {
  user: { id: 42, username: 'test-user', role: 1 },
  accessToken: 'access-token',
  bootstrapState: 'complete',
}

describe('protected route authentication recovery', () => {
  test('allows an already authenticated user without another refresh', async () => {
    let bootstrapCalls = 0

    const allowed = await resolveProtectedRouteAuthentication({
      getAuth: () => authenticatedState,
      bootstrap: async () => {
        bootstrapCalls += 1
        return { kind: 'anonymous' }
      },
    })

    assert.equal(allowed, true)
    assert.equal(bootstrapCalls, 0)
  })

  test('retries an incomplete bootstrap before deciding to redirect', async () => {
    let auth: AuthState = {
      user: null,
      accessToken: null,
      bootstrapState: 'idle',
    }

    const allowed = await resolveProtectedRouteAuthentication({
      getAuth: () => auth,
      bootstrap: async () => {
        auth = authenticatedState
        return {
          kind: 'authenticated',
          bundle: {
            access_token: 'access-token',
            token_type: 'Bearer',
            access_expires_at: 1,
            user: { id: 42, username: 'test-user', role: 1 },
            session: {
              sid: 'session-a',
              current: true,
              login_method: 'password',
              ip: '127.0.0.1',
              user_agent: 'test',
              created_at: 1,
              last_active_at: 1,
              expires_at: 2,
            },
          },
        }
      },
    })

    assert.equal(allowed, true)
  })

  test('redirects only after the bootstrap has confirmed an anonymous user', async () => {
    let bootstrapCalls = 0

    const allowed = await resolveProtectedRouteAuthentication({
      getAuth: () => ({
        user: null,
        accessToken: null,
        bootstrapState: 'complete',
      }),
      bootstrap: async () => {
        bootstrapCalls += 1
        return { kind: 'anonymous' }
      },
    })

    assert.equal(allowed, false)
    assert.equal(bootstrapCalls, 0)
  })

  test('keeps a temporary refresh failure distinct from signed out', async () => {
    const networkError = new Error('network unavailable')

    await assert.rejects(
      resolveProtectedRouteAuthentication({
        getAuth: () => ({
          user: null,
          accessToken: null,
          bootstrapState: 'idle',
        }),
        bootstrap: async () => ({
          kind: 'transient_error',
          error: networkError,
        }),
      }),
      (error: unknown) => {
        assert.ok(error instanceof AuthenticationRecoveryUnavailableError)
        assert.equal(error.cause, networkError)
        return true
      }
    )
  })
})
