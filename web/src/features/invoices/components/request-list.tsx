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
import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'
import { RefreshCw } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LongText } from '@/components/long-text'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/features/wallet/lib/billing'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getInvoiceRequests, withdrawInvoiceRequest } from '../api'
import { invoiceStatusIcons, invoiceStatusVariants } from '../constants'
import type { InvoiceRequest, InvoiceSearch } from '../types'
import { InvoiceProcessDialog } from './process-dialog'
import { InvoiceRequestDetails } from './request-details'
import { InvoiceSearchFields } from './search-fields'

export function InvoiceRequestList(props: { admin: boolean }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [draft, setDraft] = useState<InvoiceSearch>({})
  const [search, setSearch] = useState<InvoiceSearch>({})
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    props.admin ? [{ id: 'status', value: ['pending'] }] : []
  )
  const status =
    (
      columnFilters.find((filter) => filter.id === 'status')?.value as
        | string[]
        | undefined
    )?.[0] ?? ''
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const detailsTrigger = useRef<HTMLElement | null>(null)
  const [details, setDetails] = useState<InvoiceRequest | null>(null)
  const [withdrawing, setWithdrawing] = useState<InvoiceRequest | null>(null)
  const [processing, setProcessing] = useState<{
    request: InvoiceRequest
    action: 'issued' | 'rejected'
  } | null>(null)
  const query = useQuery({
    queryKey: [
      'invoices',
      'requests',
      props.admin,
      pagination.pageIndex,
      pagination.pageSize,
      status,
      search,
    ],
    queryFn: () =>
      getInvoiceRequests(
        props.admin,
        pagination.pageIndex + 1,
        status,
        pagination.pageSize,
        search
      ),
  })
  const withdraw = useMutation({
    mutationFn: withdrawInvoiceRequest,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      toast.success(t('Invoice application withdrawn'))
      setWithdrawing(null)
    },
  })
  const labels = {
    pending: t('Awaiting invoicing'),
    issued: t('Invoiced'),
    rejected: t('Rejected'),
    withdrawn: t('Withdrawn'),
  }
  const columns = useMemo<ColumnDef<InvoiceRequest>[]>(() => {
    const labels = {
      pending: t('Awaiting invoicing'),
      issued: t('Invoiced'),
      rejected: t('Rejected'),
      withdrawn: t('Withdrawn'),
    }
    const result: ColumnDef<InvoiceRequest>[] = [
      {
        accessorKey: 'title',
        header: t('Invoice title'),
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <div className='min-w-0 space-y-1 py-1'>
            <LongText className='max-w-80 font-medium whitespace-nowrap'>
              {row.original.title}
            </LongText>
            <span className='text-muted-foreground text-xs'>
              #{row.original.id} ·{' '}
              {row.original.title_type === 'company'
                ? t('Company')
                : t('Personal')}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'email',
        header: t('Invoice email'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <LongText className='max-w-60 whitespace-nowrap'>
            {row.original.email}
          </LongText>
        ),
      },
      {
        id: 'orders',
        header: t('Invoice amount'),
        cell: ({ row }) => (
          <span className='whitespace-nowrap tabular-nums'>
            {formatNumber(
              row.original.orders.reduce(
                (total, order) => total + order.money,
                0
              ),
              locale
            )}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        meta: { mobileBadge: true },
        cell: ({ row }) => (
          <StatusBadge
            copyable={false}
            icon={invoiceStatusIcons[row.original.status]}
            variant={invoiceStatusVariants[row.original.status]}
          >
            {labels[row.original.status]}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'created_at',
        header: t('Created At'),
        cell: ({ row }) => (
          <span className='text-muted-foreground whitespace-nowrap'>
            {formatTimestamp(row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }) => (
          <div className='flex items-center gap-1 whitespace-nowrap'>
            <Button
              size='sm'
              variant='outline'
              onClick={(event) => {
                detailsTrigger.current = event.currentTarget
                setDetails(row.original)
              }}
            >
              {t('View details')}
            </Button>
            {!props.admin && row.original.status === 'pending' && (
              <Button
                size='sm'
                variant='ghost'
                className='text-destructive hover:text-destructive'
                disabled={withdraw.isPending}
                onClick={() => setWithdrawing(row.original)}
              >
                {t('Withdraw')}
              </Button>
            )}
          </div>
        ),
      },
    ]
    if (props.admin) {
      result.splice(1, 0, {
        accessorKey: 'user_id',
        header: t('User'),
        cell: ({ row }) => (
          <div className='min-w-0 space-y-1'>
            <LongText className='max-w-48 whitespace-nowrap'>
              {row.original.display_name ||
                row.original.username ||
                `#${row.original.user_id}`}
            </LongText>
            <p className='text-muted-foreground text-xs'>
              {row.original.username} · #{row.original.user_id}
            </p>
          </div>
        ),
      })
    }
    return result
  }, [t, locale, props.admin, withdraw.isPending])

  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    enableSorting: false,
    manualPagination: true,
    totalCount: query.data?.total ?? 0,
    pagination,
    manualFiltering: true,
    columnFilters,
    onColumnFiltersChange: (updater) => {
      setColumnFilters(updater)
      setPagination((current) => ({ ...current, pageIndex: 0 }))
    },
    onPaginationChange: setPagination,
  })
  return (
    <div className='flex h-full min-h-0 flex-col'>
      {query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          emptyTitle={t('No invoice applications')}
          emptyDescription={t(
            'Submitted invoice applications will appear here.'
          )}
          toolbarProps={{
            customSearch: (
              <InvoiceSearchFields
                admin={props.admin}
                value={draft}
                onChange={setDraft}
              />
            ),
            onSearch: () => {
              setSearch(draft)
              setPagination((current) => ({ ...current, pageIndex: 0 }))
            },
            onReset: () => {
              setDraft({})
              setSearch({})
              setColumnFilters([])
              setPagination((current) => ({ ...current, pageIndex: 0 }))
            },
            hasAdditionalFilters: Boolean(
              draft.keyword ||
              draft.user ||
              search.keyword ||
              search.user ||
              draft.start_timestamp ||
              draft.end_timestamp ||
              search.start_timestamp ||
              search.end_timestamp
            ),
            filters: [
              {
                columnId: 'status',
                title: t('Status'),
                singleSelect: true,
                options: Object.entries(labels).map(([value, label]) => ({
                  value,
                  label,
                })),
              },
            ],
            preActions: (
              <Button
                variant='outline'
                size='icon'
                aria-label={t('Refresh')}
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                <RefreshCw className='size-4' aria-hidden='true' />
              </Button>
            ),
          }}
          mobileProps={{ enableRowSelection: false }}
        />
      )}
      {details && (
        <InvoiceRequestDetails
          finalFocus={detailsTrigger}
          request={
            query.data?.items.find((item) => item.id === details.id) ?? details
          }
          admin={props.admin}
          onClose={() => setDetails(null)}
          onProcess={(action) =>
            setProcessing({
              request:
                query.data?.items.find((item) => item.id === details.id) ??
                details,
              action,
            })
          }
        />
      )}
      {processing && (
        <InvoiceProcessDialog
          request={processing.request}
          action={processing.action}
          onClose={() => setProcessing(null)}
          onProcessed={() => setDetails(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(withdrawing)}
        onOpenChange={(open) => {
          if (!open && !withdraw.isPending) setWithdrawing(null)
        }}
        title={t('Withdraw invoice application')}
        desc={t(
          'Withdraw this pending invoice application? The orders will become available again.'
        )}
        confirmText={t('Withdraw application')}
        destructive
        isLoading={withdraw.isPending}
        handleConfirm={() => {
          if (withdrawing) withdraw.mutate(withdrawing.id)
        }}
      />
    </div>
  )
}
