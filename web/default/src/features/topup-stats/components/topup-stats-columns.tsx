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
import { CreditCard } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { LongText } from '@/components/long-text'
import { Badge } from '@/components/ui/badge'
import { getPaymentMethodName } from '@/features/wallet/lib/billing'
import { formatNumber, formatTimestamp } from '@/lib/format'

import type { TopUpStatsItem } from '../types'

function formatProvider(provider: string): string {
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function useTopUpStatsColumns(): ColumnDef<TopUpStatsItem>[] {
  const { t } = useTranslation()

  return useMemo(
    () => [
      {
        accessorKey: 'trade_no',
        header: t('Order number'),
        cell: ({ row }) => {
          const tradeNo = row.original.trade_no
          return (
            <div className='flex min-w-0 items-center gap-1.5'>
              <code
                className='bg-muted/60 max-w-72 min-w-0 truncate rounded px-1.5 py-1 font-mono text-xs'
                title={tradeNo}
              >
                {tradeNo || '-'}
              </code>
              {tradeNo && (
                <CopyButton
                  value={tradeNo}
                  className='size-7'
                  iconClassName='size-3.5'
                  tooltip={t('Copy order number')}
                />
              )}
            </div>
          )
        },
        size: 280,
        meta: { mobileTitle: true },
      },
      {
        accessorKey: 'username',
        header: t('User'),
        cell: ({ row }) => (
          <div className='flex min-w-36 flex-col gap-0.5'>
            <LongText className='max-w-48 font-medium'>
              {row.original.username ||
                row.original.display_name ||
                `#${row.original.user_id}`}
            </LongText>
            <div className='text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs'>
              <span className='shrink-0 font-mono'>
                #{row.original.user_id}
              </span>
              {row.original.display_name &&
                row.original.display_name !== row.original.username && (
                  <>
                    <span aria-hidden='true'>/</span>
                    <LongText className='max-w-28'>
                      {row.original.display_name}
                    </LongText>
                  </>
                )}
            </div>
          </div>
        ),
        size: 210,
        meta: { mobileOrder: 10 },
      },
      {
        accessorKey: 'payment_method',
        header: t('Top-up method'),
        cell: ({ row }) => {
          const { payment_method: method, payment_provider: provider } =
            row.original
          let displayMethod = '-'
          if (method) {
            const methodName = getPaymentMethodName(method, t)
            displayMethod =
              methodName === method ? formatProvider(method) : methodName
          } else if (provider) {
            displayMethod = formatProvider(provider)
          }
          const showProvider = Boolean(
            method &&
            provider &&
            provider.toLowerCase() !== method.toLowerCase()
          )

          return (
            <div className='flex min-w-0 flex-col items-start gap-1'>
              <Badge variant='outline' className='bg-muted/40 max-w-full'>
                <CreditCard data-icon='inline-start' />
                <span className='truncate'>{displayMethod}</span>
              </Badge>
              {showProvider && (
                <span className='text-muted-foreground max-w-40 truncate text-xs'>
                  {t('Provider')}: {formatProvider(provider)}
                </span>
              )}
            </div>
          )
        },
        size: 190,
        meta: { mobileOrder: 20 },
      },
      {
        accessorKey: 'money',
        header: t('Payment amount'),
        cell: ({ row }) => (
          <span className='text-foreground font-semibold tabular-nums'>
            {formatNumber(row.original.money)}
          </span>
        ),
        size: 150,
        meta: { mobileOrder: 30 },
      },
      {
        accessorKey: 'complete_time',
        header: t('Completed at'),
        cell: ({ row }) => (
          <span className='text-muted-foreground whitespace-nowrap tabular-nums'>
            {formatTimestamp(row.original.complete_time)}
          </span>
        ),
        size: 190,
        meta: { mobileOrder: 40 },
      },
    ],
    [t]
  )
}
