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
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TimestampCell } from '@/components/activity-time-cell'
import { CopyButton } from '@/components/copy-button'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LongText } from '@/components/long-text'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getInvoiceOrders } from '../api'
import type {
  EligibleInvoiceOrder,
  InvoiceOrder,
  InvoiceSearch,
} from '../types'
import { InvoiceSearchFields } from './search-fields'

export function InvoiceOrderPicker(props: {
  selected: InvoiceOrder[]
  onChange: (orders: InvoiceOrder[]) => void
  disabled: boolean
  enabled?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [draft, setDraft] = useState<InvoiceSearch>({})
  const [search, setSearch] = useState<InvoiceSearch>({})
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const query = useQuery({
    enabled: props.enabled,
    queryKey: [
      'invoices',
      'eligible',
      pagination.pageIndex,
      pagination.pageSize,
      search,
    ],
    queryFn: () =>
      getInvoiceOrders(pagination.pageIndex + 1, pagination.pageSize, search),
  })
  const columns = useMemo<ColumnDef<EligibleInvoiceOrder>[]>(
    () => [
      {
        id: 'select',
        size: 40,
        header: ({ table }) => (
          <Checkbox
            aria-label={t('Select all')}
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            disabled={
              !table.getRowModel().rows.some((row) => row.getCanSelect())
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(Boolean(value))
            }
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={t('Select order {{number}}', {
              number: row.original.trade_no,
            })}
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
          />
        ),
        enableHiding: false,
      },
      {
        accessorKey: 'trade_no',
        size: 220,
        header: t('Order Number'),
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <div className='flex min-w-0 items-center gap-1.5 whitespace-nowrap'>
            <LongText className='max-w-56 font-mono text-xs whitespace-nowrap'>
              {row.original.trade_no}
            </LongText>
            <CopyButton
              value={row.original.trade_no}
              className='size-7'
              iconClassName='size-3.5'
              tooltip={t('Copy reference')}
            />
          </div>
        ),
      },
      {
        accessorKey: 'money',
        size: 100,
        header: t('Payment'),
        cell: ({ row }) => (
          <span className='font-medium tabular-nums'>
            {formatNumber(row.original.money, locale)}
          </span>
        ),
      },
      {
        accessorKey: 'create_time',
        size: 160,
        header: t('Created At'),
        cell: ({ row }) => (
          <TimestampCell
            timestamp={row.original.create_time}
            format='absolute'
            justNowLabel={t('Just now')}
            className='w-32 text-xs whitespace-nowrap'
          />
        ),
      },
    ],
    [t, locale]
  )
  const rowSelection = useMemo<RowSelectionState>(
    () =>
      Object.fromEntries(
        props.selected.map((order) => [String(order.id), true])
      ),
    [props.selected]
  )
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    getRowId: (order) => String(order.id),
    enableSorting: false,
    manualPagination: true,
    totalCount: query.data?.total ?? 0,
    pagination,
    onPaginationChange: setPagination,
    rowSelection,
    enableRowSelection: (row) =>
      !props.disabled && (rowSelection[row.id] || props.selected.length < 100),
    onRowSelectionChange: (updater) => {
      if (props.disabled) return
      const next =
        typeof updater === 'function' ? updater(rowSelection) : updater
      const retained = props.selected.filter((order) => next[String(order.id)])
      const added = (query.data?.items ?? []).filter(
        (order) =>
          next[String(order.id)] &&
          !retained.some((selected) => selected.id === order.id)
      )
      props.onChange([...retained, ...added].slice(0, 100))
    },
  })
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return (
    <DataTablePage
      table={table}
      applyHeaderSize
      columns={columns}
      isLoading={query.isPending}
      isFetching={query.isFetching}
      emptyTitle={t('No eligible orders')}
      mobileProps={{ enableRowSelection: true }}
      className='h-[min(48dvh,460px)]'
      paginationInFooter={false}
      toolbarProps={{
        customSearch: (
          <InvoiceSearchFields orders value={draft} onChange={setDraft} />
        ),
        onSearch: () => {
          setSearch(draft)
          setPagination((current) => ({ ...current, pageIndex: 0 }))
        },
        onReset: () => {
          setDraft({})
          setSearch({})
          setPagination((current) => ({ ...current, pageIndex: 0 }))
        },
        hasAdditionalFilters:
          Object.values(draft).some(Boolean) ||
          Object.values(search).some(Boolean),
        hideViewOptions: true,
        preActions: (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={props.disabled || props.selected.length === 0}
            onClick={() => props.onChange([])}
          >
            {t('Clear selection')}
          </Button>
        ),
      }}
    />
  )
}
