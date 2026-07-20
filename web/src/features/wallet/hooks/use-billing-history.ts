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
import i18next from 'i18next'
import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'

import { useIsAdmin } from '@/hooks/use-admin'

import {
  getUserBillingHistory,
  getAllBillingHistory,
  completeOrder,
  isApiSuccess,
} from '../api'
import { isLatestBillingRequest } from '../lib/billing'
import type { BillingRecord, BillingRecordType } from '../types'

const ALL_BILLING_TYPES: BillingRecordType[] = [
  'online_topup',
  'redemption',
  'affiliate_transfer',
  'admin_adjustment',
]

function defaultStartTime() {
  const value = new Date()
  value.setDate(value.getDate() - 30)
  value.setHours(0, 0, 0, 0)
  return value
}

interface BillingHistoryFilters {
  keyword: string
  userKeyword: string
  types: BillingRecordType[]
  startTime?: Date
  endTime?: Date
}

function createDefaultFilters(): BillingHistoryFilters {
  return {
    keyword: '',
    userKeyword: '',
    types: [...ALL_BILLING_TYPES],
    startTime: defaultStartTime(),
    endTime: new Date(),
  }
}

function snapshotFilters(
  filters: BillingHistoryFilters
): BillingHistoryFilters {
  return {
    keyword: filters.keyword.trim(),
    userKeyword: filters.userKeyword.trim(),
    types: [...filters.types],
    startTime: filters.startTime
      ? new Date(filters.startTime.getTime())
      : undefined,
    endTime: filters.endTime ? new Date(filters.endTime.getTime()) : undefined,
  }
}

// ============================================================================
// Billing History Hook
// ============================================================================

interface UseBillingHistoryOptions {
  /** Initial page number */
  initialPage?: number
  /** Initial page size */
  initialPageSize?: number
  /** Only load records while the dialog is open */
  enabled?: boolean
}

export function useBillingHistory(options: UseBillingHistoryOptions = {}) {
  const { initialPage = 1, initialPageSize = 10, enabled = true } = options
  const isAdmin = useIsAdmin()

  const [records, setRecords] = useState<BillingRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [filters, setFilters] =
    useState<BillingHistoryFilters>(createDefaultFilters)
  const [appliedFilters, setAppliedFilters] = useState<BillingHistoryFilters>(
    () => snapshotFilters(filters)
  )
  const [loading, setLoading] = useState(false)
  const [completing, setCompleting] = useState(false)
  const requestSequenceRef = useRef(0)

  /**
   * Fetch billing history
   */
  const fetchBillingHistory = useCallback(async () => {
    const requestSequence = ++requestSequenceRef.current
    setLoading(true)
    try {
      const params = {
        page,
        pageSize,
        keyword: appliedFilters.keyword,
        userKeyword: isAdmin ? appliedFilters.userKeyword : undefined,
        types: appliedFilters.types,
        startTimestamp: appliedFilters.startTime
          ? Math.floor(appliedFilters.startTime.getTime() / 1000)
          : undefined,
        endTimestamp: appliedFilters.endTime
          ? Math.floor(appliedFilters.endTime.getTime() / 1000)
          : undefined,
      }
      const response = isAdmin
        ? await getAllBillingHistory(params)
        : await getUserBillingHistory(params)

      if (
        !isLatestBillingRequest(requestSequence, requestSequenceRef.current)
      ) {
        return
      }

      if (isApiSuccess(response) && response.data) {
        setRecords(response.data.items || [])
        setTotal(response.data.total || 0)
      } else {
        toast.error(
          response.message || i18next.t('Failed to load billing history')
        )
        setRecords([])
        setTotal(0)
      }
    } catch (error) {
      if (
        !isLatestBillingRequest(requestSequence, requestSequenceRef.current)
      ) {
        return
      }
      // eslint-disable-next-line no-console
      console.error('Failed to fetch billing history:', error)
      toast.error(i18next.t('Failed to load billing history'))
      setRecords([])
      setTotal(0)
    } finally {
      if (isLatestBillingRequest(requestSequence, requestSequenceRef.current)) {
        setLoading(false)
      }
    }
  }, [isAdmin, page, pageSize, appliedFilters])

  /**
   * Complete a pending order (admin only)
   */
  const handleCompleteOrder = useCallback(
    async (tradeNo: string) => {
      if (!isAdmin) {
        toast.error(i18next.t('Admin access required'))
        return false
      }

      setCompleting(true)
      try {
        const response = await completeOrder({ trade_no: tradeNo })
        if (isApiSuccess(response)) {
          toast.success(i18next.t('Order completed successfully'))
          // Refresh the list
          await fetchBillingHistory()
          return true
        } else {
          toast.error(response.message || i18next.t('Failed to complete order'))
          return false
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to complete order:', error)
        toast.error(i18next.t('Failed to complete order'))
        return false
      } finally {
        setCompleting(false)
      }
    },
    [isAdmin, fetchBillingHistory]
  )

  /**
   * Change page
   */
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  /**
   * Change page size
   */
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize)
    setPage(1) // Reset to first page when changing page size
  }, [])

  /**
   * Search by keyword
   */
  const handleKeywordChange = useCallback((newKeyword: string) => {
    setFilters((current) => ({ ...current, keyword: newKeyword }))
  }, [])

  const handleUserKeywordChange = useCallback((newKeyword: string) => {
    setFilters((current) => ({ ...current, userKeyword: newKeyword }))
  }, [])

  const handleTypesChange = useCallback((newTypes: string[]) => {
    setFilters((current) => ({
      ...current,
      types: newTypes as BillingRecordType[],
    }))
  }, [])

  const handleStartTimeChange = useCallback((value: Date | undefined) => {
    setFilters((current) => ({ ...current, startTime: value }))
  }, [])

  const handleEndTimeChange = useCallback((value: Date | undefined) => {
    setFilters((current) => ({ ...current, endTime: value }))
  }, [])

  const handleApplyFilters = useCallback(() => {
    setPage(1)
    setAppliedFilters(snapshotFilters(filters))
  }, [filters])

  // Fetch the initial page and subsequent applied-filter or pagination changes.
  useEffect(() => {
    if (enabled) {
      fetchBillingHistory()
    }
  }, [enabled, fetchBillingHistory])

  return {
    records,
    total,
    page,
    pageSize,
    keyword: filters.keyword,
    userKeyword: filters.userKeyword,
    types: filters.types,
    startTime: filters.startTime,
    endTime: filters.endTime,
    loading,
    completing,
    isAdmin,
    handlePageChange,
    handlePageSizeChange,
    handleKeywordChange,
    handleUserKeywordChange,
    handleTypesChange,
    handleStartTimeChange,
    handleEndTimeChange,
    handleApplyFilters,
    handleCompleteOrder,
    refresh: fetchBillingHistory,
  }
}
