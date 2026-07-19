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

import { isValidLoginSessionUser, type LoginSessionUser } from './login-session'

interface CurrentUserResponse {
  success?: boolean
  data?: unknown
}

interface ValidateCachedSignInSessionOptions {
  cachedUser: unknown
  fetchCurrentUser: () => Promise<CurrentUserResponse>
  persistCurrentUser: (user: LoginSessionUser) => void
  clearCachedUser: () => void
}

export async function validateCachedSignInSession(
  options: ValidateCachedSignInSessionOptions
): Promise<boolean> {
  const { fetchCurrentUser, persistCurrentUser, clearCachedUser } = options
  try {
    // Do a cookie-only check even when localStorage has no user. This is
    // required when OAuth returns from another trusted subdomain: localStorage
    // is origin-scoped, while the shared session cookie may already be valid.
    const response = await fetchCurrentUser()
    if (response?.success && isValidLoginSessionUser(response.data)) {
      persistCurrentUser(response.data)
      return true
    }
  } catch {
    // A stale or malformed server session must not block the sign-in page.
  }

  // Clear both local keys after the cookie check fails. This also removes a
  // previous session's uid before a new login attempt sends any API request.
  clearCachedUser()
  return false
}
