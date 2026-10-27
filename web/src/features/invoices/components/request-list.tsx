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
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePagination, StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { formatTimestamp } from '@/features/wallet/lib/billing'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getInvoiceRequests } from '../api'
import type { InvoiceRequest } from '../types'
import { InvoiceProcessDialog } from './process-dialog'

export function InvoiceRequestList(props: { admin: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [status, setStatus] = useState(props.admin ? 'pending' : '')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
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
      status,
    ],
    queryFn: () =>
      getInvoiceRequests(props.admin, pagination.pageIndex + 1, status),
  })
  const table = useReactTable({
    data: query.data?.items ?? [],
    columns: [],
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: query.data?.total ?? 0,
    state: { pagination },
    onPaginationChange: setPagination,
  })
  const labels = {
    pending: t('Awaiting invoicing'),
    issued: t('Invoiced'),
    rejected: t('Rejected'),
  }
  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <Label htmlFor='invoice-status'>{t('Status')}</Label>
        <NativeSelect
          id='invoice-status'
          value={status}
          onChange={(event) => {
            setStatus(event.target.value)
            setPagination({ pageIndex: 0, pageSize: 10 })
          }}
        >
          <NativeSelectOption value=''>{t('All')}</NativeSelectOption>
          {Object.entries(labels).map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.isSuccess && query.data.items.length === 0 && (
        <EmptyState title={t('No invoice applications')} />
      )}
      {query.isSuccess &&
        query.data.items.map((request) => (
          <article
            key={request.id}
            className='space-y-3 rounded-lg border p-4 [overflow-wrap:anywhere]'
          >
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <h3 className='min-w-0 font-medium'>
                #{request.id} · {request.title}
              </h3>
              <StatusBadge
                copyable={false}
                variant={request.status === 'issued' ? 'success' : 'neutral'}
              >
                {labels[request.status]}
              </StatusBadge>
            </div>
            <dl className='grid gap-2 text-sm sm:grid-cols-2'>
              {props.admin && (
                <div>
                  <dt className='text-muted-foreground'>{t('User ID')}</dt>
                  <dd>{request.user_id}</dd>
                </div>
              )}
              <div>
                <dt className='text-muted-foreground'>
                  {t('Invoice title type')}
                </dt>
                <dd>
                  {request.title_type === 'company'
                    ? t('Company')
                    : t('Personal')}
                </dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>
                  {t('Tax identification number')}
                </dt>
                <dd>{request.tax_id || '—'}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>{t('Invoice email')}</dt>
                <dd>{request.email}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>{t('Created At')}</dt>
                <dd>{formatTimestamp(request.created_at)}</dd>
              </div>
            </dl>
            {request.remark && (
              <p className='text-sm whitespace-pre-wrap'>
                {t('Remarks')}: {request.remark}
              </p>
            )}
            <StaticDataTable
              data={request.orders}
              getRowKey={(order) => order.id}
              columns={[
                {
                  id: 'number',
                  header: t('Order Number'),
                  cell: (order) => (
                    <span className='break-all'>{order.trade_no}</span>
                  ),
                },
                {
                  id: 'money',
                  header: t('Payment'),
                  cell: (order) => formatNumber(order.money, locale),
                },
              ]}
            />
            {request.invoice_number && (
              <p className='text-sm'>
                {t('Invoice number')}: {request.invoice_number}
              </p>
            )}
            {request.process_note && (
              <p className='text-sm whitespace-pre-wrap'>
                {t('Processing note')}: {request.process_note}
              </p>
            )}
            {request.processed_at > 0 && (
              <p className='text-muted-foreground text-xs'>
                {formatTimestamp(request.processed_at)}
              </p>
            )}
            {request.invoice_url.startsWith('https://') && (
              <a
                href={request.invoice_url}
                target='_blank'
                rel='noopener noreferrer'
                className='text-primary underline'
              >
                {t('View invoice')}
              </a>
            )}
            {props.admin && request.status === 'pending' && (
              <div className='flex flex-wrap gap-2'>
                <Button
                  size='sm'
                  onClick={() => setProcessing({ request, action: 'issued' })}
                >
                  {t('Complete invoicing')}
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setProcessing({ request, action: 'rejected' })}
                >
                  {t('Reject application')}
                </Button>
              </div>
            )}
          </article>
        ))}
      {query.isSuccess && <DataTablePagination table={table} compact />}
      {processing && (
        <InvoiceProcessDialog
          request={processing.request}
          action={processing.action}
          onClose={() => setProcessing(null)}
        />
      )}
    </div>
  )
}
