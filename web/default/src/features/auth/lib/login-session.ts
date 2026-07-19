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

export interface LoginSessionUser {
  id: number
  username: string
  role: number
  status: number
}

export interface LoginSessionResponse {
  success?: boolean
  data?: unknown
}

export function isValidLoginSessionUser(
  value: unknown
): value is LoginSessionUser {
  if (!value || typeof value !== 'object') return false

  const user = value as Record<string, unknown>
  return (
    typeof user.id === 'number' &&
    Number.isSafeInteger(user.id) &&
    user.id > 0 &&
    typeof user.username === 'string' &&
    user.username.trim().length > 0 &&
    typeof user.role === 'number' &&
    Number.isSafeInteger(user.role) &&
    user.role > 0 &&
    user.status === 1
  )
}

interface CompleteLoginSessionOptions<TUser extends LoginSessionUser> {
  fetchCurrentUser: () => Promise<LoginSessionResponse>
  persistUser: (user: TUser) => void
  clearUser: () => void
  onSuccess: () => void
}

/**
 * Complete a login only after the session cookie has been verified by /self.
 * A failed or malformed response must never navigate into the authenticated
 * tree with only stale localStorage state.
 */
export async function completeLoginSession<TUser extends LoginSessionUser>({
  fetchCurrentUser,
  persistUser,
  clearUser,
  onSuccess,
}: CompleteLoginSessionOptions<TUser>): Promise<boolean> {
  try {
    const response = await fetchCurrentUser()
    if (!response?.success || !isValidLoginSessionUser(response.data)) {
      clearUser()
      return false
    }

    persistUser(response.data as TUser)
    onSuccess()
    return true
  } catch {
    clearUser()
    return false
  }
}
