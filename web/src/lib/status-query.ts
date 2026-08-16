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
import { queryOptions } from '@tanstack/react-query'

import type { SystemStatus } from '@/features/auth/types'

import { getStatus } from './api'

export const STATUS_QUERY_KEY = ['status'] as const
const STATUS_STALE_TIME = 5 * 60 * 1000
const STATUS_GC_TIME = 30 * 60 * 1000

let cachedStatusLoaded = false
let cachedStatus: SystemStatus | undefined

export function getCachedStatus(): SystemStatus | undefined {
  if (cachedStatusLoaded) return cachedStatus
  cachedStatusLoaded = true

  try {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('status')
      cachedStatus = saved ? (JSON.parse(saved) as SystemStatus) : undefined
    }
  } catch {
    cachedStatus = undefined
  }

  return cachedStatus
}

export function cacheStatus(status: SystemStatus): void {
  cachedStatusLoaded = true
  cachedStatus = status

  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('status', JSON.stringify(status))
    }
  } catch {
    /* Storage can be unavailable in private mode. */
  }
}

export const statusQueryOptions = queryOptions({
  queryKey: STATUS_QUERY_KEY,
  queryFn: async (): Promise<SystemStatus | null> => {
    return (await getStatus()) as SystemStatus | null
  },
  placeholderData: getCachedStatus,
  staleTime: STATUS_STALE_TIME,
  gcTime: STATUS_GC_TIME,
})
