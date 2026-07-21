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
/**
 * Utility functions for usage logs filters
 */
import { LOG_CATEGORY_LABELS } from '../constants'
import type {
  LogCategory,
  LogFilters,
  CommonLogFilters,
  DrawingLogFilters,
  TaskLogFilters,
} from '../types'

function normalizeSearchValue(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value)) return value.map(String)
  return value
}

/**
 * Compare only the URL fields owned by a search action. Route schemas often
 * normalize omitted string fields to an empty string, so those values must be
 * treated as equivalent or repeated searches turn into no-op navigations.
 */
export function haveSameSearchParams(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  return keys.every((key) => {
    const currentValue = normalizeSearchValue(current[key])
    const nextValue = normalizeSearchValue(next[key])
    if (Array.isArray(currentValue) || Array.isArray(nextValue)) {
      return JSON.stringify(currentValue) === JSON.stringify(nextValue)
    }
    return currentValue === nextValue
  })
}

interface ApplyLogSearchOptions {
  currentSearch: Record<string, unknown>
  nextSearch: Record<string, unknown>
  keys: readonly string[]
  navigate: () => void | Promise<unknown>
  refetch: () => void | Promise<unknown>
}

export async function applyLogSearch(
  options: ApplyLogSearchOptions
): Promise<'refetched' | 'navigated'> {
  if (
    haveSameSearchParams(
      options.currentSearch,
      options.nextSearch,
      options.keys
    )
  ) {
    await options.refetch()
    return 'refetched'
  }
  await options.navigate()
  return 'navigated'
}

// ============================================================================
// Filter Building Functions
// ============================================================================

/**
 * Build search params from filters based on log category
 */
export function buildSearchParams(
  filters: LogFilters,
  logCategory: LogCategory
): Record<string, unknown> {
  const baseParams: Record<string, unknown> = {
    ...(filters.startTime && { startTime: filters.startTime.getTime() }),
    ...(filters.endTime && { endTime: filters.endTime.getTime() }),
    ...(filters.channel && { channel: filters.channel }),
  }

  switch (logCategory) {
    case 'common': {
      const commonFilters = filters as CommonLogFilters
      return {
        ...baseParams,
        ...(commonFilters.model && { model: commonFilters.model }),
        ...(commonFilters.token && { token: commonFilters.token }),
        ...(commonFilters.group && { group: commonFilters.group }),
        ...(commonFilters.username && { username: commonFilters.username }),
        ...(commonFilters.requestId && { requestId: commonFilters.requestId }),
        ...(commonFilters.upstreamRequestId && {
          upstreamRequestId: commonFilters.upstreamRequestId,
        }),
      }
    }
    case 'drawing': {
      const drawingFilters = filters as DrawingLogFilters
      return {
        ...baseParams,
        ...(drawingFilters.mjId && { filter: drawingFilters.mjId }),
      }
    }
    case 'task': {
      const taskFilters = filters as TaskLogFilters
      return {
        ...baseParams,
        ...(taskFilters.taskId && { filter: taskFilters.taskId }),
      }
    }
    default:
      return baseParams
  }
}

/**
 * Get log category display name
 */
export function getLogCategoryLabel(category: LogCategory): string {
  return LOG_CATEGORY_LABELS[category]
}
