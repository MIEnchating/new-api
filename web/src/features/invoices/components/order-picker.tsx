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
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Checkbox } from '@/components/ui/checkbox'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getInvoiceOrders } from '../api'

export function InvoiceOrderPicker(props: {
  selected: number[]
  onChange: (ids: number[]) => void
  disabled: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const query = useQuery({
    queryKey: ['invoices', 'eligible', pagination.pageIndex],
    queryFn: () => getInvoiceOrders(pagination.pageIndex + 1),
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
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return (
    <div className='space-y-3'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Select paid top-up orders to request an invoice. Up to 100 orders per application.'
        )}
      </p>
      <StaticDataTable
        data={query.data.items}
        getRowKey={(order) => order.id}
        emptyContent={t('No eligible orders')}
        columns={[
          {
            id: 'select',
            header: t('Select'),
            cell: (order) => (
              <Checkbox
                aria-label={t('Select order {{number}}', {
                  number: order.trade_no,
                })}
                checked={props.selected.includes(order.id)}
                disabled={
                  props.disabled ||
                  (!props.selected.includes(order.id) &&
                    props.selected.length >= 100)
                }
                onCheckedChange={(checked) =>
                  props.onChange(
                    checked
                      ? [...props.selected, order.id]
                      : props.selected.filter((id) => id !== order.id)
                  )
                }
              />
            ),
          },
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
      <DataTablePagination table={table} compact />
      <p aria-live='polite' className='text-sm'>
        {t('Selected orders: {{count}}', { count: props.selected.length })}
      </p>
    </div>
  )
}
