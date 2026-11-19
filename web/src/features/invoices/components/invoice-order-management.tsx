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
  ColumnDef,
  PaginationState,
  RowSelectionState,
} from '@tanstack/react-table'
import { ReceiptText, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import {
  DataTableBulkActions,
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  getTopUpStats,
  updateTopUpInvoice,
  updateTopUpInvoices,
} from '@/features/topup-stats/api'
import { getInvoiceStatusConfig } from '@/features/topup-stats/lib'
import type {
  BillingInvoiceTarget,
  InvoiceAction,
  TopUpStatsItem,
} from '@/features/topup-stats/types'
import { getStatusConfig } from '@/features/wallet/lib/billing'
import { formatNumber, formatTimestamp } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

function getInvoiceTarget(item: TopUpStatsItem): BillingInvoiceTarget | null {
  if (!item.invoice_eligible) return null
  if (item.type === 'online_topup' && item.topup_id) {
    return { id: item.topup_id, type: item.type }
  }
  if (item.type === 'redemption' && item.redemption_id) {
    return { id: item.redemption_id, type: item.type }
  }
  return null
}

export function InvoiceOrderManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [keywordDraft, setKeywordDraft] = useState('')
  const [userDraft, setUserDraft] = useState('')
  const [keyword, setKeyword] = useState('')
  const [userKeyword, setUserKeyword] = useState('')
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [target, setTarget] = useState<{
    items: TopUpStatsItem[]
    action: InvoiceAction
  } | null>(null)
  const [returnConfirmed, setReturnConfirmed] = useState(false)
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const query = useQuery({
    queryKey: [
      'admin-invoice-order-markers',
      keyword,
      userKeyword,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: async () => {
      const response = await getTopUpStats({
        start_time: 0,
        end_time: 0,
        types: 'online_topup,redemption',
        status: 'success',
        keyword: keyword || undefined,
        user_keyword: userKeyword || undefined,
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      })
      if (!response.success || !response.data) {
        throw createServerError(response, t('Failed to load order history'))
      }
      return response.data
    },
    placeholderData: (previousData) => previousData,
  })
  const mutation = useMutation({
    mutationFn: async (input: {
      items: TopUpStatsItem[]
      action: InvoiceAction
    }) => {
      const targets = input.items
        .map(getInvoiceTarget)
        .filter((item): item is BillingInvoiceTarget => item !== null)
      if (targets.length !== input.items.length) {
        throw new Error(t('Failed to update invoice'))
      }
      const response =
        targets.length === 1
          ? await updateTopUpInvoice(targets[0], input.action)
          : await updateTopUpInvoices(targets, input.action)
      if (!response.success) {
        throw createServerError(response, t('Failed to update invoice'))
      }
      return { action: input.action, count: targets.length }
    },
    onSuccess: async ({ action, count }) => {
      toast.success(
        action === 'issue'
          ? t('{{count}} orders marked as invoiced', { count })
          : t('{{count}} invoice markers returned', { count })
      )
      setTarget(null)
      setReturnConfirmed(false)
      setRowSelection({})
      await queryClient.invalidateQueries({ queryKey: ['invoices'] })
      await queryClient.invalidateQueries({ queryKey: ['admin-topup-stats'] })
      await queryClient.invalidateQueries({
        queryKey: ['admin-invoice-order-markers'],
      })
    },
    onError: (error) => handleServerError(error, t('Failed to update invoice')),
  })
  const rows = query.data?.items ?? []
  const columns = useMemo<ColumnDef<TopUpStatsItem>[]>(() => {
    const result: ColumnDef<TopUpStatsItem>[] = [
      {
        id: 'select',
        size: 44,
        header: ({ table }) => (
          <Checkbox
            aria-label={t('Select all')}
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            onCheckedChange={(checked) =>
              table.toggleAllPageRowsSelected(checked === true)
            }
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={t('Select row')}
            checked={row.getIsSelected()}
            onCheckedChange={(checked) => row.toggleSelected(checked === true)}
          />
        ),
        enableHiding: false,
      },
      {
        accessorKey: 'reference',
        header: t('Order number / reference'),
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <div className='flex min-w-0 items-center gap-1.5'>
            <code className='max-w-64 truncate font-mono text-xs'>
              {row.original.reference}
            </code>
            <CopyButton
              value={row.original.reference}
              className='size-7 shrink-0'
              iconClassName='size-3.5'
              tooltip={t('Copy reference')}
            />
          </div>
        ),
      },
      {
        accessorKey: 'username',
        header: t('User'),
        cell: ({ row }) => (
          <div className='min-w-32'>
            <div className='font-medium'>
              {row.original.username ||
                row.original.display_name ||
                `#${row.original.user_id}`}
            </div>
            <div className='text-muted-foreground text-xs'>
              #{row.original.user_id}
            </div>
          </div>
        ),
      },
      {
        id: 'payment',
        header: t('Payment'),
        cell: ({ row }) => (
          <div className='min-w-24 space-y-1'>
            <div className='font-medium tabular-nums'>
              {formatNumber(row.original.money)}
            </div>
            <StatusBadge
              label={t(getStatusConfig(row.original.status).label)}
              variant={getStatusConfig(row.original.status).variant}
              copyable={false}
              showDot
            />
          </div>
        ),
      },
      {
        accessorKey: 'invoice_status',
        header: t('Invoice status'),
        cell: ({ row }) => {
          const config = getInvoiceStatusConfig(row.original.invoice_status, t)
          return (
            <StatusBadge
              label={config.label}
              variant={config.variant}
              copyable={false}
              showDot
            />
          )
        },
      },
      {
        accessorKey: 'created_at',
        header: t('Transaction time'),
        cell: ({ row }) => (
          <span className='text-muted-foreground whitespace-nowrap tabular-nums'>
            {formatTimestamp(row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'action',
        header: t('Actions'),
        cell: ({ row }) => {
          const issued = row.original.invoice_status === 1
          return (
            <Button
              type='button'
              variant={issued ? 'outline' : 'default'}
              size='sm'
              disabled={mutation.isPending}
              onClick={() =>
                setTarget({
                  items: [row.original],
                  action: issued ? 'return' : 'issue',
                })
              }
            >
              {issued ? (
                <Undo2 data-icon='inline-start' />
              ) : (
                <ReceiptText data-icon='inline-start' />
              )}
              {issued ? t('Return invoice') : t('Mark as invoiced')}
            </Button>
          )
        },
        enableHiding: false,
      },
    ]
    return result
  }, [mutation.isPending, t])
  const { table } = useDataTable({
    data: rows,
    columns,
    getRowId: (item) => item.id,
    enableRowSelection: (row) => row.original.invoice_eligible,
    rowSelection,
    onRowSelectionChange: setRowSelection,
    manualPagination: true,
    pagination,
    onPaginationChange: setPagination,
    totalCount: query.data?.total ?? 0,
  })
  const selectedItems = table
    .getSelectedRowModel()
    .rows.map((row) => row.original)
  const issueItems = selectedItems.filter((item) => item.invoice_status !== 1)
  const returnItems = selectedItems.filter((item) => item.invoice_status === 1)
  const openTarget = (items: TopUpStatsItem[], action: InvoiceAction) => {
    setReturnConfirmed(false)
    setTarget({ items, action })
  }
  const count = target?.items.length ?? 0
  const description = target
    ? count > 1
      ? target.action === 'return'
        ? t(
            'Return invoice markers for {{count}} selected orders? This does not change payments or user balances.',
            { count }
          )
        : t(
            'Mark {{count}} selected orders as invoiced? These are internal markers only.',
            { count }
          )
      : target.action === 'return'
        ? t(
            'Return the invoice marker for order {{tradeNo}}? This does not change the payment or user balance.',
            { tradeNo: target.items[0].reference }
          )
        : t(
            'Mark order {{tradeNo}} as invoiced? This is an internal marker only.',
            {
              tradeNo: target.items[0].reference,
            }
          )
    : ''

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        emptyTitle={
          query.isError
            ? t('Failed to load order history')
            : t('No eligible orders')
        }
        emptyDescription={
          query.isError ? query.error.message : t('Try adjusting your search')
        }
        skeletonKeyPrefix='invoice-order-markers'
        applyHeaderSize
        bulkActions={
          <DataTableBulkActions table={table} entityName={t('order')}>
            <Button
              type='button'
              size='sm'
              disabled={issueItems.length === 0 || mutation.isPending}
              onClick={() => openTarget(issueItems, 'issue')}
            >
              <ReceiptText data-icon='inline-start' />
              {t('Mark as invoiced')}
            </Button>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={returnItems.length === 0 || mutation.isPending}
              onClick={() => openTarget(returnItems, 'return')}
            >
              <Undo2 data-icon='inline-start' />
              {t('Return invoice')}
            </Button>
          </DataTableBulkActions>
        }
        toolbarProps={{
          customSearch: (
            <div className='contents'>
              <Input
                value={userDraft}
                onChange={(event) => setUserDraft(event.target.value)}
                placeholder={t('Search users by ID or name...')}
                className='min-w-48 flex-1'
              />
              <Input
                value={keywordDraft}
                onChange={(event) => setKeywordDraft(event.target.value)}
                placeholder={t('Search by order number...')}
                className='min-w-48 flex-1'
              />
            </div>
          ),
          onSearch: () => {
            setKeyword(keywordDraft.trim())
            setUserKeyword(userDraft.trim())
            setPagination((current) => ({ ...current, pageIndex: 0 }))
            setRowSelection({})
          },
          onReset: () => {
            setKeywordDraft('')
            setUserDraft('')
            setKeyword('')
            setUserKeyword('')
            setPagination((current) => ({ ...current, pageIndex: 0 }))
            setRowSelection({})
          },
          searchLoading: query.isFetching,
          hideViewOptions: true,
          hasAdditionalFilters: Boolean(keyword || userKeyword),
        }}
      />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) {
            setTarget(null)
            setReturnConfirmed(false)
          }
        }}
        title={
          target?.action === 'return'
            ? t('Return invoice')
            : t('Mark as invoiced')
        }
        desc={description}
        confirmText={
          target?.action === 'return'
            ? t('Confirm return')
            : t('Confirm invoice')
        }
        destructive={target?.action === 'return'}
        disabled={target?.action === 'return' && !returnConfirmed}
        isLoading={mutation.isPending}
        handleConfirm={() => {
          if (target) mutation.mutate(target)
        }}
      >
        {target?.action === 'return' && (
          <label className='bg-destructive/5 border-destructive/20 flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm'>
            <Checkbox
              checked={returnConfirmed}
              onCheckedChange={(checked) =>
                setReturnConfirmed(checked === true)
              }
              disabled={mutation.isPending}
              className='mt-0.5'
            />
            <span>
              {t('Please confirm that you understand the consequences')}
            </span>
          </label>
        )}
      </ConfirmDialog>
    </>
  )
}
