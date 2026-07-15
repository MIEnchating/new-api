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
import { useQuery } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import {
  BarChart3,
  CircleDollarSign,
  ReceiptText,
  RefreshCw,
  Users,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'

import { getTopUpStats } from './api'
import { useTopUpStatsColumns } from './components/topup-stats-columns'
import type { TopUpStatsSummary } from './types'

type StatsRange = {
  start: Date
  end: Date
}

const emptySummary: TopUpStatsSummary = {
  order_count: 0,
  user_count: 0,
  total_money: 0,
  average_order_money: 0,
}

function getTodayRange(): StatsRange {
  const now = dayjs()
  return {
    start: now.startOf('day').toDate(),
    end: now.endOf('day').toDate(),
  }
}

export function TopUpStats() {
  const { t } = useTranslation()
  const columns = useTopUpStatsColumns()
  const [range, setRange] = useState<StatsRange>(getTodayRange)
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })

  const startTime = Math.floor(range.start.getTime() / 1000)
  const endTime = Math.floor(range.end.getTime() / 1000)
  const query = useQuery({
    queryKey: [
      'admin-topup-stats',
      startTime,
      endTime,
      globalFilter,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: async () => {
      const response = await getTopUpStats({
        start_time: startTime,
        end_time: endTime,
        keyword: globalFilter.trim() || undefined,
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      })
      if (!response.success || !response.data) {
        throw new Error(response.message || t('Failed to load top-up stats'))
      }
      return response.data
    },
    placeholderData: (previousData) => previousData,
  })

  const handleRangeChange = useCallback(
    (nextRange: { start?: Date; end?: Date }) => {
      if (!nextRange.start || !nextRange.end) return
      setRange({ start: nextRange.start, end: nextRange.end })
      setPagination((current) => ({ ...current, pageIndex: 0 }))
    },
    []
  )

  const resetFilters = useCallback(() => {
    setRange(getTodayRange())
    setGlobalFilter('')
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }, [])

  const isToday =
    dayjs(range.start).isSame(dayjs(), 'day') &&
    dayjs(range.end).isSame(dayjs(), 'day')
  const rows = query.data?.items ?? []
  const summary = query.data?.summary ?? emptySummary

  const { table } = useDataTable({
    data: rows,
    columns,
    pagination,
    onPaginationChange: setPagination,
    globalFilter,
    onGlobalFilterChange: (updater) => {
      setGlobalFilter((current) =>
        typeof updater === 'function' ? updater(current) : updater
      )
      setPagination((current) => ({ ...current, pageIndex: 0 }))
    },
    manualPagination: true,
    manualFiltering: true,
    totalCount: query.data?.total ?? 0,
  })

  const metrics = useMemo(
    () => [
      {
        label: t('Total payment'),
        value: formatNumber(summary.total_money),
        icon: CircleDollarSign,
      },
      {
        label: t('Successful orders'),
        value: formatNumber(summary.order_count),
        icon: ReceiptText,
      },
      {
        label: t('Paying users'),
        value: formatNumber(summary.user_count),
        icon: Users,
      },
      {
        label: t('Average order'),
        value: formatNumber(summary.average_order_money),
        icon: BarChart3,
      },
    ],
    [summary, t]
  )

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Top-up Stats')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-4'>
          <div className='grid shrink-0 overflow-hidden rounded-lg border sm:grid-cols-2 lg:grid-cols-4 lg:[&>*:not(:last-child)]:border-r lg:[&>*:nth-child(2)]:border-r sm:[&>*:nth-child(odd)]:border-r'>
            {metrics.map((metric) => (
              <div
                key={metric.label}
                className='flex min-h-24 items-center gap-3 border-b px-4 py-3 last:border-b-0 lg:border-b-0 sm:[&:nth-child(3)]:border-b-0'
              >
                <div className='bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md'>
                  <metric.icon className='size-4' />
                </div>
                <div className='min-w-0'>
                  <div className='text-muted-foreground text-xs'>
                    {metric.label}
                  </div>
                  {query.isLoading ? (
                    <Skeleton className='mt-2 h-6 w-20' />
                  ) : (
                    <div className='mt-1 truncate text-xl font-semibold tabular-nums'>
                      {metric.value}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className='min-h-0 flex-1'>
            <DataTablePage
              table={table}
              columns={columns}
              isLoading={query.isLoading}
              isFetching={query.isFetching}
              emptyTitle={
                query.isError
                  ? t('Failed to load top-up stats')
                  : t('No top-up data found')
              }
              emptyDescription={
                query.isError
                  ? query.error.message
                  : t(
                      'No successful top-ups were completed in this time range.'
                    )
              }
              skeletonKeyPrefix='topup-stats-skeleton'
              applyHeaderSize
              toolbarProps={{
                searchPlaceholder: t('Search by username or user ID...'),
                searchDebounceMs: 300,
                additionalSearch: (
                  <CompactDateTimeRangePicker
                    start={range.start}
                    end={range.end}
                    onChange={handleRangeChange}
                    className='w-full sm:w-[330px]'
                  />
                ),
                hasAdditionalFilters: !isToday,
                onReset: resetFilters,
                hideViewOptions: true,
                preActions: (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type='button'
                          variant='outline'
                          size='icon'
                          onClick={() => query.refetch()}
                          disabled={query.isFetching}
                          aria-label={t('Refresh')}
                        />
                      }
                    >
                      <RefreshCw
                        className={`size-4 ${query.isFetching ? 'animate-spin' : ''}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent>{t('Refresh')}</TooltipContent>
                  </Tooltip>
                ),
              }}
            />
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
