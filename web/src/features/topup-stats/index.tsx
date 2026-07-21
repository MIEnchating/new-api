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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ColumnFiltersState,
  PaginationState,
  RowSelectionState,
} from '@tanstack/react-table'
import {
  CircleDollarSign,
  FileCheck2,
  ReceiptText,
  RefreshCw,
  Undo2,
  Users,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CompactDateTimeRangePicker } from '@/components/compact-date-time-range-picker'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTableBulkActions,
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'

import { getTopUpStats, updateTopUpInvoice, updateTopUpInvoices } from './api'
import { useTopUpStatsColumns } from './components/topup-stats-columns'
import { TopUpStatsMobileList } from './components/topup-stats-mobile-list'
import type { InvoiceAction, TopUpStatsItem, TopUpStatsSummary } from './types'

type StatsRange = {
  start: Date
  end: Date
}

type AppliedFilters = {
  range: StatsRange
  keyword: string
  userKeyword: string
  types: string[]
  statuses: string[]
  paymentMethods: string[]
  invoiceStatuses: string[]
}

const emptySummary: TopUpStatsSummary = {
  order_count: 0,
  user_count: 0,
  total_money: 0,
  invoice_count: 0,
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
  const queryClient = useQueryClient()
  const [range, setRange] = useState<StatsRange>(getTodayRange)
  const [globalFilter, setGlobalFilter] = useState('')
  const [userKeyword, setUserKeyword] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>(() => ({
    range: getTodayRange(),
    keyword: '',
    userKeyword: '',
    types: [],
    statuses: [],
    paymentMethods: [],
    invoiceStatuses: [],
  }))
  const [invoiceTarget, setInvoiceTarget] = useState<{
    items: TopUpStatsItem[]
    action: InvoiceAction
  } | null>(null)
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })

  const invoiceMutation = useMutation({
    mutationFn: async ({
      items,
      action,
    }: {
      items: TopUpStatsItem[]
      action: InvoiceAction
    }) => {
      const topUpIds = items
        .map((item) => item.topup_id)
        .filter((id): id is number => typeof id === 'number' && id > 0)
      if (topUpIds.length !== items.length) {
        throw new Error(t('Failed to update invoice'))
      }
      const response =
        items.length === 1
          ? await updateTopUpInvoice(topUpIds[0], action)
          : await updateTopUpInvoices(topUpIds, action)
      if (!response.success) {
        throw new Error(response.message || t('Failed to update invoice'))
      }
      return { action, count: items.length }
    },
    onSuccess: async ({ action, count }) => {
      toast.success(
        action === 'issue'
          ? t('{{count}} orders marked as invoiced', { count })
          : t('{{count}} invoice markers returned', { count })
      )
      setInvoiceTarget(null)
      setRowSelection({})
      await queryClient.invalidateQueries({ queryKey: ['admin-topup-stats'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const handleInvoiceAction = useCallback(
    (item: TopUpStatsItem, action: InvoiceAction) => {
      setInvoiceTarget({ items: [item], action })
    },
    []
  )
  const columns = useTopUpStatsColumns({
    onInvoiceAction: handleInvoiceAction,
    updatingId: invoiceMutation.isPending
      ? invoiceMutation.variables?.items[0]?.topup_id
      : undefined,
  })

  const startTime = Math.floor(appliedFilters.range.start.getTime() / 1000)
  const endTime = Math.floor(appliedFilters.range.end.getTime() / 1000)
  const query = useQuery({
    queryKey: [
      'admin-topup-stats',
      startTime,
      endTime,
      appliedFilters.keyword,
      appliedFilters.userKeyword,
      appliedFilters.types.join(','),
      appliedFilters.statuses.join(','),
      appliedFilters.paymentMethods.join(','),
      appliedFilters.invoiceStatuses.join(','),
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: async () => {
      const response = await getTopUpStats({
        start_time: startTime,
        end_time: endTime,
        keyword: appliedFilters.keyword || undefined,
        user_keyword: appliedFilters.userKeyword || undefined,
        types: appliedFilters.types.join(',') || undefined,
        status: appliedFilters.statuses.join(',') || undefined,
        payment_method: appliedFilters.paymentMethods.join(',') || undefined,
        invoice_status: appliedFilters.invoiceStatuses.join(',') || undefined,
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      })
      if (!response.success || !response.data) {
        throw new Error(response.message || t('Failed to load order history'))
      }
      return response.data
    },
    placeholderData: (previousData) => previousData,
  })

  const handleRangeChange = useCallback(
    (nextRange: { start?: Date; end?: Date }) => {
      if (!nextRange.start || !nextRange.end) return
      setRange({ start: nextRange.start, end: nextRange.end })
    },
    []
  )

  const resetFilters = useCallback(() => {
    const today = getTodayRange()
    setRange(today)
    setGlobalFilter('')
    setUserKeyword('')
    setColumnFilters([])
    setAppliedFilters({
      range: today,
      keyword: '',
      userKeyword: '',
      types: [],
      statuses: [],
      paymentMethods: [],
      invoiceStatuses: [],
    })
    setRowSelection({})
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
    columnFilters,
    onColumnFiltersChange: setColumnFilters,
    rowSelection,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: (row) =>
      row.original.type === 'online_topup' &&
      row.original.status === 'success' &&
      Boolean(row.original.topup_id),
    getRowId: (row) => row.id,
    onPaginationChange: setPagination,
    globalFilter,
    onGlobalFilterChange: (updater) => {
      setGlobalFilter((current) =>
        typeof updater === 'function' ? updater(current) : updater
      )
    },
    manualPagination: true,
    manualFiltering: true,
    totalCount: query.data?.total ?? 0,
  })

  const readStringFilter = useCallback(
    (columnId: string) =>
      (columnFilters.find((filter) => filter.id === columnId)?.value as
        | string[]
        | undefined) ?? [],
    [columnFilters]
  )
  const handleSearch = useCallback(() => {
    setAppliedFilters({
      range,
      keyword: globalFilter.trim(),
      userKeyword: userKeyword.trim(),
      types: readStringFilter('type'),
      statuses: readStringFilter('status'),
      paymentMethods: readStringFilter('payment_method'),
      invoiceStatuses: readStringFilter('invoice_status'),
    })
    setRowSelection({})
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }, [globalFilter, range, readStringFilter, userKeyword])

  const selectedItems = table
    .getSelectedRowModel()
    .rows.map((row) => row.original)
  const bulkIssueItems = selectedItems.filter(
    (item) =>
      item.type === 'online_topup' &&
      item.status === 'success' &&
      item.invoice_status !== 1
  )
  const bulkReturnItems = selectedItems.filter(
    (item) =>
      item.type === 'online_topup' &&
      item.status === 'success' &&
      item.invoice_status === 1
  )
  const selectedIds = new Set(selectedItems.map((item) => item.id))

  const metrics = useMemo(
    () => [
      {
        label: t('Total payment'),
        value: formatNumber(summary.total_money),
        icon: CircleDollarSign,
        iconClassName:
          'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      },
      {
        label: t('Successful orders'),
        value: formatNumber(summary.order_count),
        icon: ReceiptText,
        iconClassName: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
      },
      {
        label: t('Paying users'),
        value: formatNumber(summary.user_count),
        icon: Users,
        iconClassName: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      },
      {
        label: t('Invoiced orders'),
        value: formatNumber(summary.invoice_count),
        icon: FileCheck2,
        iconClassName: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
      },
    ],
    [summary, t]
  )

  let invoiceDialogDescription = ''
  if (invoiceTarget) {
    const count = invoiceTarget.items.length
    if (count > 1) {
      invoiceDialogDescription =
        invoiceTarget.action === 'return'
          ? t(
              'Return invoice markers for {{count}} selected orders? This does not change payments or user balances.',
              { count }
            )
          : t(
              'Mark {{count}} selected orders as invoiced? These are internal markers only.',
              { count }
            )
    } else {
      invoiceDialogDescription =
        invoiceTarget.action === 'return'
          ? t(
              'Return the invoice marker for order {{tradeNo}}? This does not change the payment or user balance.',
              { tradeNo: invoiceTarget.items[0].reference }
            )
          : t(
              'Mark order {{tradeNo}} as invoiced? This is an internal marker only.',
              { tradeNo: invoiceTarget.items[0].reference }
            )
    }
  }

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('Order History')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
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
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 flex-col gap-3 sm:gap-4'>
            <div className='bg-border grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border sm:grid-cols-4'>
              {metrics.map((metric) => (
                <div
                  key={metric.label}
                  className='bg-card flex min-w-0 flex-col items-start gap-2 px-3 py-3 sm:min-h-24 sm:flex-row sm:items-center sm:gap-3 sm:px-4'
                >
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded-md sm:size-9 ${metric.iconClassName}`}
                  >
                    <metric.icon className='size-4' aria-hidden='true' />
                  </div>
                  <div className='min-w-0'>
                    <div className='text-muted-foreground truncate text-[11px] leading-4 sm:text-xs'>
                      {metric.label}
                    </div>
                    {query.isLoading ? (
                      <Skeleton className='mt-1 h-6 w-14 sm:mt-2 sm:w-20' />
                    ) : (
                      <div
                        className='mt-0.5 truncate text-lg font-semibold tabular-nums sm:mt-1 sm:text-xl'
                        title={metric.value}
                      >
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
                    ? t('Failed to load order history')
                    : t('No billing records found')
                }
                emptyDescription={
                  query.isError
                    ? query.error.message
                    : t('Try adjusting your search')
                }
                skeletonKeyPrefix='topup-stats-skeleton'
                applyHeaderSize
                mobile={
                  <TopUpStatsMobileList
                    rows={rows}
                    isLoading={query.isLoading}
                    isFetching={query.isFetching && !query.isLoading}
                    emptyTitle={
                      query.isError
                        ? t('Failed to load order history')
                        : t('No billing records found')
                    }
                    emptyDescription={
                      query.isError
                        ? query.error.message
                        : t('Try adjusting your search')
                    }
                    onInvoiceAction={handleInvoiceAction}
                    updatingId={
                      invoiceMutation.isPending
                        ? invoiceMutation.variables?.items[0]?.topup_id
                        : undefined
                    }
                    selectedIds={selectedIds}
                    onToggleSelected={(id, selected) =>
                      table.getRow(id).toggleSelected(selected)
                    }
                  />
                }
                bulkActions={
                  <DataTableBulkActions table={table} entityName={t('order')}>
                    <Button
                      type='button'
                      size='sm'
                      onClick={() =>
                        setInvoiceTarget({
                          items: bulkIssueItems,
                          action: 'issue',
                        })
                      }
                      disabled={
                        bulkIssueItems.length === 0 || invoiceMutation.isPending
                      }
                    >
                      <ReceiptText data-icon='inline-start' />
                      {t('Mark as invoiced')}
                    </Button>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() =>
                        setInvoiceTarget({
                          items: bulkReturnItems,
                          action: 'return',
                        })
                      }
                      disabled={
                        bulkReturnItems.length === 0 ||
                        invoiceMutation.isPending
                      }
                    >
                      <Undo2 data-icon='inline-start' />
                      {t('Return invoice')}
                    </Button>
                  </DataTableBulkActions>
                }
                toolbarProps={{
                  searchPlaceholder: t('Search by order number...'),
                  filters: [
                    {
                      columnId: 'type',
                      title: t('Type'),
                      options: [
                        {
                          label: t('Online Top-up'),
                          value: 'online_topup',
                        },
                        {
                          label: t('Redemption Code'),
                          value: 'redemption',
                        },
                        {
                          label: t('Affiliate Transfer'),
                          value: 'affiliate_transfer',
                        },
                        {
                          label: t('Admin Adjustment'),
                          value: 'admin_adjustment',
                        },
                      ],
                    },
                    {
                      columnId: 'status',
                      title: t('Order status'),
                      options: [
                        { label: t('Success'), value: 'success' },
                        { label: t('Pending'), value: 'pending' },
                        { label: t('Failed'), value: 'failed' },
                        { label: t('Expired'), value: 'expired' },
                      ],
                    },
                    {
                      columnId: 'payment_method',
                      title: t('Top-up method'),
                      options: [
                        { label: t('Alipay'), value: 'alipay' },
                        { label: t('WeChat Pay'), value: 'wxpay' },
                        { label: 'Stripe', value: 'stripe' },
                        { label: 'Waffo', value: 'waffo' },
                        { label: 'Creem', value: 'creem' },
                        { label: t('Balance'), value: 'balance' },
                      ],
                    },
                    {
                      columnId: 'invoice_status',
                      title: t('Invoice status'),
                      options: [
                        { label: t('Not invoiced'), value: '0' },
                        { label: t('Invoiced'), value: '1' },
                        { label: t('Returned'), value: '2' },
                      ],
                    },
                  ],
                  additionalSearch: (
                    <>
                      <Input
                        value={userKeyword}
                        onChange={(event) => setUserKeyword(event.target.value)}
                        placeholder={t('Search users by ID or name...')}
                        className='w-full sm:w-[220px]'
                      />
                      <CompactDateTimeRangePicker
                        start={range.start}
                        end={range.end}
                        onChange={handleRangeChange}
                        className='w-full sm:w-[330px]'
                      />
                    </>
                  ),
                  hasAdditionalFilters: !isToday,
                  onReset: resetFilters,
                  onSearch: handleSearch,
                  searchLoading: query.isFetching,
                  hideViewOptions: true,
                  mobileCollapsibleFilters: true,
                }}
              />
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ConfirmDialog
        open={invoiceTarget !== null}
        onOpenChange={(open) => {
          if (!open && !invoiceMutation.isPending) setInvoiceTarget(null)
        }}
        title={
          invoiceTarget?.action === 'return'
            ? t('Return invoice')
            : t('Mark as invoiced')
        }
        desc={invoiceDialogDescription}
        confirmText={
          invoiceTarget?.action === 'return'
            ? t('Confirm return')
            : t('Confirm invoice')
        }
        destructive={invoiceTarget?.action === 'return'}
        isLoading={invoiceMutation.isPending}
        handleConfirm={() => {
          if (invoiceTarget) invoiceMutation.mutate(invoiceTarget)
        }}
      />
    </>
  )
}
