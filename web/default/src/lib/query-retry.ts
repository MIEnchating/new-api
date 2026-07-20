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
import { isAxiosError, isCancel } from 'axios'

export const MAX_QUERY_RETRIES = 2

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])

export function isRetryableQueryError(error: unknown): boolean {
  if (!isAxiosError(error) || isCancel(error)) return false

  const status = error.response?.status
  if (status === undefined) {
    return true
  }

  return RETRYABLE_STATUS_CODES.has(status)
}

export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
  development = import.meta.env.DEV
): boolean {
  if (development || failureCount >= MAX_QUERY_RETRIES) return false
  return isRetryableQueryError(error)
}
