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

// ============================================================================
// Billing History Hook
// ============================================================================

interface UseBillingHistoryOptions {
  /** Initial page number */
  initialPage?: number
  /** Initial page size */
  initialPageSize?: number
}

export function useBillingHistory(options: UseBillingHistoryOptions = {}) {
  const { initialPage = 1, initialPageSize = 10 } = options
  const isAdmin = useIsAdmin()

  const [records, setRecords] = useState<BillingRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [keyword, setKeyword] = useState('')
  const [userKeyword, setUserKeyword] = useState('')
  const [types, setTypes] = useState<BillingRecordType[]>(ALL_BILLING_TYPES)
  const [startTime, setStartTime] = useState<Date | undefined>(defaultStartTime)
  const [endTime, setEndTime] = useState<Date | undefined>(() => new Date())
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
        keyword,
        userKeyword: isAdmin ? userKeyword : undefined,
        types,
        startTimestamp: startTime
          ? Math.floor(startTime.getTime() / 1000)
          : undefined,
        endTimestamp: endTime
          ? Math.floor(endTime.getTime() / 1000)
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
  }, [isAdmin, page, pageSize, keyword, userKeyword, types, startTime, endTime])

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
  const handleSearch = useCallback((newKeyword: string) => {
    setKeyword(newKeyword)
    setPage(1) // Reset to first page when searching
  }, [])

  const handleUserSearch = useCallback((newKeyword: string) => {
    setUserKeyword(newKeyword)
    setPage(1)
  }, [])

  const handleTypesChange = useCallback((newTypes: string[]) => {
    setTypes(newTypes as BillingRecordType[])
    setPage(1)
  }, [])

  const handleStartTimeChange = useCallback((value: Date | undefined) => {
    setStartTime(value)
    setPage(1)
  }, [])

  const handleEndTimeChange = useCallback((value: Date | undefined) => {
    setEndTime(value)
    setPage(1)
  }, [])

  // Fetch data when dependencies change
  useEffect(() => {
    fetchBillingHistory()
  }, [fetchBillingHistory])

  return {
    records,
    total,
    page,
    pageSize,
    keyword,
    userKeyword,
    types,
    startTime,
    endTime,
    loading,
    completing,
    isAdmin,
    handlePageChange,
    handlePageSizeChange,
    handleSearch,
    handleUserSearch,
    handleTypesChange,
    handleStartTimeChange,
    handleEndTimeChange,
    handleCompleteOrder,
    refresh: fetchBillingHistory,
  }
}
