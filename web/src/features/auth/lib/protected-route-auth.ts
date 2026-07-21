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
import type { RefreshOutcome } from '@/lib/auth-session'
import type { AuthBootstrapState, AuthUser } from '@/stores/auth-store'

type ProtectedRouteAuthState = {
  user: AuthUser | null
  accessToken: string | null
  bootstrapState: AuthBootstrapState
}

type ProtectedRouteAuthRuntime = {
  getAuth: () => ProtectedRouteAuthState
  bootstrap: () => Promise<RefreshOutcome>
}

export class AuthenticationRecoveryUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Authentication recovery is temporarily unavailable', { cause })
    this.name = 'AuthenticationRecoveryUnavailableError'
  }
}

function hasAuthenticatedCredentials(auth: ProtectedRouteAuthState): boolean {
  return Boolean(auth.user && auth.accessToken)
}

export async function resolveProtectedRouteAuthentication(
  runtime: ProtectedRouteAuthRuntime
): Promise<boolean> {
  let auth = runtime.getAuth()
  if (hasAuthenticatedCredentials(auth)) return true
  if (auth.bootstrapState === 'complete') return false

  const outcome = await runtime.bootstrap()
  if (outcome.kind === 'transient_error') {
    throw new AuthenticationRecoveryUnavailableError(outcome.error)
  }

  auth = runtime.getAuth()
  return hasAuthenticatedCredentials(auth)
}
