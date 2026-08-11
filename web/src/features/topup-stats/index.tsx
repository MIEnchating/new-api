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
import { ReceiptText, Undo2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CompactDateTimeRangePicker } from '@/components/compact-date-time-range-picker'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTableBulkActions,
  DataTableFacetedFilter,
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useMediaQuery } from '@/hooks'
import dayjs from '@/lib/dayjs'

import { getTopUpStats, updateTopUpInvoice, updateTopUpInvoices } from './api'
import { useTopUpStatsColumns } from './components/topup-stats-columns'
import { TopUpStatsDetailsDialog } from './components/topup-stats-details-dialog'
import { TopUpStatsMobileList } from './components/topup-stats-mobile-list'
import { TopUpStatsSummaryRail } from './components/topup-stats-summary-rail'
import { getLotteryNetQuota, getOrderManagementTotalQuota } from './lib'
import type {
  BillingInvoiceTarget,
  InvoiceAction,
  TopUpStatsItem,
  TopUpStatsSummary,
} from './types'

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

function areStringArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function areAppliedFiltersEqual(left: AppliedFilters, right: AppliedFilters) {
  return (
    left.range.start.getTime() === right.range.start.getTime() &&
    left.range.end.getTime() === right.range.end.getTime() &&
    left.keyword === right.keyword &&
    left.userKeyword === right.userKeyword &&
    areStringArraysEqual(left.types, right.types) &&
    areStringArraysEqual(left.statuses, right.statuses) &&
    areStringArraysEqual(left.paymentMethods, right.paymentMethods) &&
    areStringArraysEqual(left.invoiceStatuses, right.invoiceStatuses)
  )
}

const DEFAULT_ORDER_TYPES = [
  'online_topup',
  'redemption',
  'lottery_reward',
  'lottery_reversal',
] as const
const ORDER_MANAGEMENT_TYPES = [
  ...DEFAULT_ORDER_TYPES,
  'admin_adjustment',
] as const

function getDefaultColumnFilters(): ColumnFiltersState {
  return [{ id: 'type', value: [...DEFAULT_ORDER_TYPES] }]
}

const emptySummary: TopUpStatsSummary = {
  order_count: 0,
  user_count: 0,
  total_money: 0,
  invoice_count: 0,
}

const emptyTypeQuotas: Record<TopUpStatsItem['type'], number> = {
  online_topup: 0,
  redemption: 0,
  affiliate_transfer: 0,
  admin_adjustment: 0,
  lottery_reward: 0,
  lottery_reversal: 0,
}

function getBillingInvoiceTarget(
  item: TopUpStatsItem
): BillingInvoiceTarget | null {
  if (!item.invoice_eligible) return null
  if (item.type === 'online_topup' && item.topup_id) {
    return { id: item.topup_id, type: item.type }
  }
  if (item.type === 'redemption' && item.redemption_id) {
    return { id: item.redemption_id, type: item.type }
  }
  return null
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
  const isMobile = useMediaQuery('(max-width: 640px)')
  const queryClient = useQueryClient()
  const [range, setRange] = useState<StatsRange>(getTodayRange)
  const [globalFilter, setGlobalFilter] = useState('')
  const [userKeyword, setUserKeyword] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    getDefaultColumnFilters
  )
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>(() => ({
    range: getTodayRange(),
    keyword: '',
    userKeyword: '',
    types: [...DEFAULT_ORDER_TYPES],
    statuses: [],
    paymentMethods: [],
    invoiceStatuses: [],
  }))
  const [invoiceTarget, setInvoiceTarget] = useState<{
    items: TopUpStatsItem[]
    action: InvoiceAction
  } | null>(null)
  const [returnConfirmed, setReturnConfirmed] = useState(false)
  const [detailsTarget, setDetailsTarget] = useState<TopUpStatsItem | null>(
    null
  )
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
      const targets = items
        .map(getBillingInvoiceTarget)
        .filter((target): target is BillingInvoiceTarget => target !== null)
      if (targets.length !== items.length) {
        throw new Error(t('Failed to update invoice'))
      }
      const response =
        items.length === 1
          ? await updateTopUpInvoice(targets[0], action)
          : await updateTopUpInvoices(targets, action)
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
      setReturnConfirmed(false)
      setRowSelection({})
      await queryClient.invalidateQueries({ queryKey: ['admin-topup-stats'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const openInvoiceConfirmation = useCallback(
    (items: TopUpStatsItem[], action: InvoiceAction) => {
      setReturnConfirmed(false)
      setInvoiceTarget({ items, action })
    },
    []
  )
  const handleInvoiceAction = useCallback(
    (item: TopUpStatsItem, action: InvoiceAction) => {
      openInvoiceConfirmation([item], action)
    },
    [openInvoiceConfirmation]
  )
  const columns = useTopUpStatsColumns({
    onInvoiceAction: handleInvoiceAction,
    onViewDetails: setDetailsTarget,
    updatingKey: invoiceMutation.isPending
      ? invoiceMutation.variables?.items[0]?.id
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
  const { refetch } = query

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
    setColumnFilters(getDefaultColumnFilters())
    setAppliedFilters({
      range: today,
      keyword: '',
      userKeyword: '',
      types: [...DEFAULT_ORDER_TYPES],
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
  const typeQuotas = query.data?.type_quotas ?? emptyTypeQuotas
  const lotteryQuota = getLotteryNetQuota(typeQuotas)
  const totalQuota = getOrderManagementTotalQuota(typeQuotas)

  const { table } = useDataTable({
    data: rows,
    columns,
    pagination,
    columnFilters,
    onColumnFiltersChange: setColumnFilters,
    initialColumnVisibility: { payment_method: false },
    rowSelection,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: (row) => row.original.invoice_eligible,
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
    const selectedTypes = readStringFilter('type')
    const nextFilters: AppliedFilters = {
      range,
      keyword: globalFilter.trim(),
      userKeyword: userKeyword.trim(),
      types:
        selectedTypes.length > 0 ? selectedTypes : [...ORDER_MANAGEMENT_TYPES],
      statuses: readStringFilter('status'),
      paymentMethods: readStringFilter('payment_method'),
      invoiceStatuses: readStringFilter('invoice_status'),
    }
    const filtersChanged = !areAppliedFiltersEqual(appliedFilters, nextFilters)
    const pageChanged = pagination.pageIndex !== 0

    if (filtersChanged) {
      setAppliedFilters(nextFilters)
    }
    setRowSelection({})
    setPagination((current) => ({ ...current, pageIndex: 0 }))

    // React Query only runs again when its key changes. Re-submit an
    // unchanged first-page search explicitly so the Search button always
    // represents a real server query.
    if (!filtersChanged && !pageChanged) {
      void refetch()
    }
  }, [
    appliedFilters,
    globalFilter,
    pagination.pageIndex,
    range,
    readStringFilter,
    refetch,
    userKeyword,
  ])

  const selectedItems = table
    .getSelectedRowModel()
    .rows.map((row) => row.original)
  const bulkIssueItems = selectedItems.filter(
    (item) => item.invoice_eligible && item.invoice_status !== 1
  )
  const bulkReturnItems = selectedItems.filter(
    (item) => item.invoice_eligible && item.invoice_status === 1
  )
  const selectedIds = new Set(selectedItems.map((item) => item.id))

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
        <SectionPageLayout.Title>
          {t('Order Management')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='h-full min-h-0'>
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
              tableClassName={
                !query.isLoading && rows.length === 0
                  ? '[&_[data-slot=table]]:h-full'
                  : undefined
              }
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
                  onViewDetails={setDetailsTarget}
                  updatingKey={
                    invoiceMutation.isPending
                      ? invoiceMutation.variables?.items[0]?.id
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
                      openInvoiceConfirmation(bulkIssueItems, 'issue')
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
                      openInvoiceConfirmation(bulkReturnItems, 'return')
                    }
                    disabled={
                      bulkReturnItems.length === 0 || invoiceMutation.isPending
                    }
                  >
                    <Undo2 data-icon='inline-start' />
                    {t('Return invoice')}
                  </Button>
                </DataTableBulkActions>
              }
              toolbarProps={{
                customSearch: isMobile ? (
                  <Input
                    value={userKeyword}
                    onChange={(event) => setUserKeyword(event.target.value)}
                    placeholder={t('Search users by ID or name...')}
                    className='w-full'
                  />
                ) : (
                  <div className='contents'>
                    <CompactDateTimeRangePicker
                      start={range.start}
                      end={range.end}
                      onChange={handleRangeChange}
                      className='min-w-[300px] flex-[1.25]'
                    />
                    <Input
                      value={userKeyword}
                      onChange={(event) => setUserKeyword(event.target.value)}
                      placeholder={t('Search users by ID or name...')}
                      className='min-w-[200px] flex-[0.85]'
                    />
                  </div>
                ),
                additionalSearch: isMobile ? (
                  <CompactDateTimeRangePicker
                    start={range.start}
                    end={range.end}
                    onChange={handleRangeChange}
                    className='w-full'
                  />
                ) : undefined,
                filters: [
                  {
                    columnId: 'type',
                    title: t('Type'),
                    className:
                      'min-w-0 flex-1 justify-start max-sm:w-full sm:min-w-[190px]',
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
                        label: t('Admin Adjustment'),
                        value: 'admin_adjustment',
                      },
                      {
                        label: t('Lottery Reward'),
                        value: 'lottery_reward',
                      },
                      {
                        label: t('Lottery Reward Reversal'),
                        value: 'lottery_reversal',
                      },
                    ],
                  },
                  {
                    columnId: 'invoice_status',
                    title: t('Invoice status'),
                    className:
                      'min-w-0 flex-1 justify-start max-sm:w-full sm:min-w-[180px]',
                    options: [
                      { label: t('Not invoiced'), value: '0' },
                      { label: t('Invoiced'), value: '1' },
                      { label: t('Returned'), value: '2' },
                    ],
                  },
                ],
                expandable: (
                  <div className='grid min-w-0 grid-cols-1 gap-2 sm:contents'>
                    <Input
                      value={globalFilter}
                      onChange={(event) => setGlobalFilter(event.target.value)}
                      placeholder={t('Search by order number...')}
                      className='max-sm:w-full sm:min-w-[240px] sm:flex-1'
                    />
                    <DataTableFacetedFilter
                      column={table.getColumn('status')}
                      title={t('Order status')}
                      className='min-w-0 flex-1 justify-start max-sm:w-full sm:min-w-[180px]'
                      options={[
                        { label: t('Success'), value: 'success' },
                        { label: t('Pending'), value: 'pending' },
                        { label: t('Failed'), value: 'failed' },
                        { label: t('Expired'), value: 'expired' },
                      ]}
                    />
                    <DataTableFacetedFilter
                      column={table.getColumn('payment_method')}
                      title={t('Top-up method')}
                      className='min-w-0 flex-1 justify-start max-sm:w-full sm:min-w-[180px]'
                      options={[
                        { label: t('Alipay'), value: 'alipay' },
                        { label: t('WeChat Pay'), value: 'wxpay' },
                        { label: 'Stripe', value: 'stripe' },
                        { label: 'Waffo', value: 'waffo' },
                        { label: 'Creem', value: 'creem' },
                        { label: t('Balance'), value: 'balance' },
                      ]}
                    />
                  </div>
                ),
                hasExpandedActiveFilters:
                  globalFilter.trim() !== '' ||
                  readStringFilter('status').length > 0 ||
                  readStringFilter('payment_method').length > 0,
                expandedActiveFilterCount: [
                  globalFilter.trim(),
                  readStringFilter('status').length > 0,
                  readStringFilter('payment_method').length > 0,
                ].filter(Boolean).length,
                leftActions: (
                  <TopUpStatsSummaryRail
                    typeQuotas={typeQuotas}
                    lotteryQuota={lotteryQuota}
                    totalQuota={totalQuota}
                    summary={summary}
                    loading={query.isLoading}
                  />
                ),
                hasAdditionalFilters: !isToday || userKeyword.trim() !== '',
                onReset: resetFilters,
                onSearch: handleSearch,
                searchLoading: query.isFetching,
                hideViewOptions: isMobile,
                mobileCollapsibleFilters: true,
              }}
            />
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ConfirmDialog
        open={invoiceTarget !== null}
        onOpenChange={(open) => {
          if (!open && !invoiceMutation.isPending) {
            setInvoiceTarget(null)
            setReturnConfirmed(false)
          }
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
        disabled={invoiceTarget?.action === 'return' && !returnConfirmed}
        isLoading={invoiceMutation.isPending}
        handleConfirm={() => {
          if (invoiceTarget) invoiceMutation.mutate(invoiceTarget)
        }}
      >
        {invoiceTarget?.action === 'return' && (
          <label className='bg-destructive/5 border-destructive/20 flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm'>
            <Checkbox
              checked={returnConfirmed}
              onCheckedChange={(checked) =>
                setReturnConfirmed(checked === true)
              }
              disabled={invoiceMutation.isPending}
              className='mt-0.5'
            />
            <span>
              {t('Please confirm that you understand the consequences')}
            </span>
          </label>
        )}
      </ConfirmDialog>
      <TopUpStatsDetailsDialog
        item={detailsTarget}
        onOpenChange={(open) => {
          if (!open) setDetailsTarget(null)
        }}
      />
    </>
  )
}
