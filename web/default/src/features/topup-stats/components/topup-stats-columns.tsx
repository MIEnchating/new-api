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
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { LongText } from '@/components/long-text'
import { TableId } from '@/components/table-id'
import { formatNumber, formatTimestamp } from '@/lib/format'

import type { UserTopUpStat } from '../types'

export function useTopUpStatsColumns(): ColumnDef<UserTopUpStat>[] {
  const { t } = useTranslation()

  return useMemo(
    () => [
      {
        accessorKey: 'user_id',
        header: t('User ID'),
        cell: ({ row }) => <TableId value={row.original.user_id} />,
        size: 100,
        meta: { mobileOrder: 10 },
      },
      {
        accessorKey: 'username',
        header: t('User'),
        cell: ({ row }) => (
          <div className='flex min-w-40 flex-col gap-0.5'>
            <LongText className='max-w-52 font-medium'>
              {row.original.username || `#${row.original.user_id}`}
            </LongText>
            {row.original.display_name &&
              row.original.display_name !== row.original.username && (
                <LongText className='text-muted-foreground max-w-52 text-xs'>
                  {row.original.display_name}
                </LongText>
              )}
          </div>
        ),
        size: 220,
        meta: { mobileTitle: true },
      },
      {
        accessorKey: 'order_count',
        header: t('Successful orders'),
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatNumber(row.original.order_count)}
          </span>
        ),
        size: 150,
        meta: { mobileOrder: 20 },
      },
      {
        accessorKey: 'total_money',
        header: t('Total payment'),
        cell: ({ row }) => (
          <span className='font-medium tabular-nums'>
            {formatNumber(row.original.total_money)}
          </span>
        ),
        size: 160,
        meta: { mobileOrder: 30 },
      },
      {
        accessorKey: 'average_order_money',
        header: t('Average order'),
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatNumber(row.original.average_order_money)}
          </span>
        ),
        size: 160,
        meta: { mobileOrder: 40 },
      },
      {
        accessorKey: 'last_complete_time',
        header: t('Last top-up'),
        cell: ({ row }) => (
          <span className='text-muted-foreground whitespace-nowrap'>
            {formatTimestamp(row.original.last_complete_time)}
          </span>
        ),
        size: 190,
        meta: { mobileOrder: 50 },
      },
    ],
    [t]
  )
}
