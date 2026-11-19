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
import { Eye, Wallet } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { LongText } from '@/components/long-text'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { getStatusConfig } from '@/features/wallet/lib/billing'
import { formatNumber, formatQuota, formatTimestamp } from '@/lib/format'

import { getBillingTypeConfig, getInvoiceStatusConfig } from '../lib'
import type { TopUpStatsItem } from '../types'

type TopUpStatsColumnsOptions = {
  onViewDetails: (item: TopUpStatsItem) => void
  onRefund: (item: TopUpStatsItem) => void
  updatingKey?: string
}

export function useTopUpStatsColumns({
  onViewDetails,
  onRefund,
  updatingKey,
}: TopUpStatsColumnsOptions): ColumnDef<TopUpStatsItem>[] {
  const { t } = useTranslation()

  return useMemo(
    () => [
      {
        accessorKey: 'reference',
        header: t('Order number / reference'),
        cell: ({ row }) => {
          const reference = row.original.reference
          return (
            <div className='flex min-w-0 items-center gap-1.5'>
              <code
                className='bg-muted/60 max-w-72 min-w-0 truncate rounded px-1.5 py-1 font-mono text-xs'
                title={reference}
              >
                {reference || '-'}
              </code>
              {reference && (
                <CopyButton
                  value={reference}
                  className='size-7'
                  iconClassName='size-3.5'
                  tooltip={t('Copy reference')}
                />
              )}
            </div>
          )
        },
        size: 280,
        meta: { mobileTitle: true },
      },
      {
        accessorKey: 'type',
        header: t('Type'),
        cell: ({ row }) => {
          const config = getBillingTypeConfig(row.original.type, t)
          return (
            <div className='flex min-w-0 flex-col items-start gap-1'>
              <StatusBadge
                label={config.label}
                icon={config.icon}
                variant={config.variant}
                copyable={false}
              />
              {row.original.excluded_from_stats && (
                <span className='text-warning text-xs'>
                  {t('Campaign exclusive')}
                </span>
              )}
            </div>
          )
        },
        size: 160,
        meta: { mobileOrder: 5 },
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
        accessorKey: 'status',
        header: t('Order status'),
        cell: ({ row }) => {
          if (row.original.type !== 'online_topup') {
            return <span className='text-muted-foreground'>-</span>
          }
          const config = getStatusConfig(row.original.status)
          return (
            <StatusBadge
              label={t(config.label)}
              variant={config.variant}
              showDot
              copyable={false}
            />
          )
        },
        size: 120,
        meta: { mobileOrder: 20 },
      },
      {
        accessorKey: 'payment_method',
        header: t('Top-up method'),
        cell: () => null,
        enableHiding: false,
      },
      {
        id: 'amount',
        header: t('Amount'),
        cell: ({ row }) => {
          const item = row.original
          const quotaText = `${item.quota > 0 ? '+' : ''}${formatQuota(item.quota)}`
          if (item.type === 'online_topup') {
            return (
              <div className='flex flex-col gap-0.5 tabular-nums'>
                <span className='font-semibold'>
                  {formatNumber(item.money)}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {t('Quota Change')}: {quotaText}
                </span>
              </div>
            )
          }
          return (
            <span
              className={`font-semibold tabular-nums ${item.quota < 0 ? 'text-destructive' : 'text-success'}`}
            >
              {quotaText}
            </span>
          )
        },
        size: 170,
        meta: { mobileOrder: 25 },
      },
      {
        accessorKey: 'invoice_status',
        header: t('Invoice status'),
        cell: ({ row }) => {
          const item = row.original
          if (item.excluded_from_stats) {
            return (
              <StatusBadge
                label={t('Not included in statistics')}
                variant='warning'
                copyable={false}
              />
            )
          }
          if (!item.invoice_eligible) {
            return <span className='text-muted-foreground'>-</span>
          }
          const config = getInvoiceStatusConfig(item.invoice_status, t)
          const timestamp =
            item.invoice_status === 2
              ? item.invoice_returned_at
              : item.invoiced_at
          return (
            <StatusBadge
              label={config.label}
              variant={config.variant}
              showDot
              copyable={false}
              title={timestamp > 0 ? formatTimestamp(timestamp) : undefined}
            />
          )
        },
        size: 130,
        meta: { mobileOrder: 30 },
      },
      {
        accessorKey: 'created_at',
        header: t('Transaction time'),
        cell: ({ row }) => (
          <span className='text-muted-foreground whitespace-nowrap tabular-nums'>
            {formatTimestamp(row.original.created_at)}
          </span>
        ),
        size: 190,
        meta: { mobileOrder: 35 },
      },
      {
        id: 'actions',
        header: () => <div className='text-center'>{t('Actions')}</div>,
        cell: ({ row }) => {
          const item = row.original
          return (
            <div className='flex items-center justify-center gap-1.5'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => onViewDetails(item)}
              >
                <Eye data-icon='inline-start' />
                {t('Details')}
              </Button>
              {item.refund_supported && (
                <Button
                  type='button'
                  variant='destructive'
                  size='sm'
                  onClick={() => onRefund(item)}
                  disabled={updatingKey === item.id}
                >
                  <Wallet data-icon='inline-start' />
                  {t('Refund')}
                </Button>
              )}
            </div>
          )
        },
        size: 150,
        enableHiding: false,
        meta: { pinned: 'right' as const },
      },
    ],
    [onRefund, onViewDetails, t, updatingKey]
  )
}
