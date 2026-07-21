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
import { CreditCard, ReceiptText, Undo2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { LongText } from '@/components/long-text'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  getPaymentMethodName,
  getStatusConfig,
} from '@/features/wallet/lib/billing'
import { formatNumber, formatQuota, formatTimestamp } from '@/lib/format'

import { getBillingTypeConfig, getInvoiceStatusConfig } from '../lib'
import type { InvoiceAction, TopUpStatsItem } from '../types'

function formatProvider(provider: string): string {
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

type TopUpStatsColumnsOptions = {
  onInvoiceAction: (item: TopUpStatsItem, action: InvoiceAction) => void
  updatingId?: number
}

export function useTopUpStatsColumns({
  onInvoiceAction,
  updatingId,
}: TopUpStatsColumnsOptions): ColumnDef<TopUpStatsItem>[] {
  const { t } = useTranslation()

  return useMemo(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label={t('Select all')}
          />
        ),
        cell: ({ row }) =>
          row.getCanSelect() ? (
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label={t('Select row')}
            />
          ) : null,
        enableSorting: false,
        enableHiding: false,
        size: 44,
      },
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
            <StatusBadge
              label={config.label}
              icon={config.icon}
              variant={config.variant}
              copyable={false}
            />
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
        accessorKey: 'payment_method',
        header: t('Top-up method'),
        cell: ({ row }) => {
          const { payment_method: method, payment_provider: provider } =
            row.original
          if (row.original.type !== 'online_topup') {
            return <span className='text-muted-foreground'>-</span>
          }
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
        meta: { mobileOrder: 25 },
      },
      {
        accessorKey: 'money',
        header: t('Payment amount'),
        cell: ({ row }) =>
          row.original.type === 'online_topup' ? (
            <span className='text-foreground font-semibold tabular-nums'>
              {formatNumber(row.original.money)}
            </span>
          ) : (
            <span className='text-muted-foreground'>-</span>
          ),
        size: 150,
        meta: { mobileOrder: 30 },
      },
      {
        accessorKey: 'quota',
        header: t('Quota Change'),
        cell: ({ row }) => {
          const quota = row.original.quota
          return (
            <span
              className={`font-semibold tabular-nums ${quota < 0 ? 'text-destructive' : 'text-success'}`}
            >
              {quota > 0 ? '+' : ''}
              {formatQuota(quota)}
            </span>
          )
        },
        size: 150,
        meta: { mobileOrder: 32 },
      },
      {
        accessorKey: 'invoice_status',
        header: t('Invoice status'),
        cell: ({ row }) => {
          const item = row.original
          if (item.type !== 'online_topup' || item.status !== 'success') {
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
        meta: { mobileOrder: 35 },
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
        meta: { mobileOrder: 40 },
      },
      {
        accessorKey: 'detail',
        header: t('Details'),
        cell: ({ row }) => {
          const item = row.original
          const content =
            item.detail ||
            (item.operator_user_id
              ? `${t('Admin')} #${item.operator_user_id}`
              : '-')
          return (
            <LongText className='text-muted-foreground max-w-56 text-xs'>
              {content}
            </LongText>
          )
        },
        size: 220,
        meta: { mobileOrder: 45 },
      },
      {
        id: 'actions',
        header: () => <div className='text-center'>{t('Actions')}</div>,
        cell: ({ row }) => {
          const item = row.original
          if (
            item.type !== 'online_topup' ||
            item.status !== 'success' ||
            !item.topup_id
          ) {
            return (
              <div className='text-muted-foreground text-center' aria-hidden>
                -
              </div>
            )
          }
          const isIssued = item.invoice_status === 1
          const action: InvoiceAction = isIssued ? 'return' : 'issue'
          const label = isIssued ? t('Return invoice') : t('Mark as invoiced')
          const Icon = isIssued ? Undo2 : ReceiptText
          return (
            <div className='flex justify-center'>
              <Button
                type='button'
                variant={isIssued ? 'outline' : 'default'}
                size='sm'
                className={
                  isIssued
                    ? 'border-warning/40 text-warning hover:bg-warning/10 hover:text-warning'
                    : undefined
                }
                onClick={() => onInvoiceAction(item, action)}
                disabled={updatingId === item.topup_id}
              >
                <Icon data-icon='inline-start' />
                {label}
              </Button>
            </div>
          )
        },
        size: 148,
        enableHiding: false,
        meta: { pinned: 'right' as const },
      },
    ],
    [onInvoiceAction, t, updatingId]
  )
}
