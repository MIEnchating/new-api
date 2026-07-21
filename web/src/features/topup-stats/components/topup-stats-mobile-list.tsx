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
import { CreditCard, Database, ReceiptText, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getPaymentMethodName,
  getStatusConfig,
} from '@/features/wallet/lib/billing'
import { formatNumber, formatQuota, formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getBillingTypeConfig, getInvoiceStatusConfig } from '../lib'
import type { InvoiceAction, TopUpStatsItem } from '../types'

type TopUpStatsMobileListProps = {
  rows: TopUpStatsItem[]
  isLoading: boolean
  isFetching: boolean
  emptyTitle: string
  emptyDescription: string
  onInvoiceAction: (item: TopUpStatsItem, action: InvoiceAction) => void
  updatingId?: number
  selectedIds: Set<string>
  onToggleSelected: (id: string, selected: boolean) => void
}

function formatProvider(provider: string): string {
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function MobileListSkeleton() {
  return (
    <div className='divide-y overflow-hidden rounded-lg border'>
      {[1, 2, 3].map((item) => (
        <div key={item} className='space-y-3 p-3'>
          <div className='flex items-center gap-2'>
            <Skeleton className='h-7 flex-1' />
            <Skeleton className='size-7' />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
          </div>
        </div>
      ))}
    </div>
  )
}

export function TopUpStatsMobileList({
  rows,
  isLoading,
  isFetching,
  emptyTitle,
  emptyDescription,
  onInvoiceAction,
  updatingId,
  selectedIds,
  onToggleSelected,
}: TopUpStatsMobileListProps) {
  const { t } = useTranslation()

  if (isLoading) return <MobileListSkeleton />

  if (rows.length === 0) {
    return (
      <div className='rounded-lg border p-6'>
        <Empty className='border-none p-0'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Database className='size-6' />
            </EmptyMedia>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'bg-card divide-y overflow-hidden rounded-lg border transition-opacity',
        isFetching && 'pointer-events-none opacity-60'
      )}
    >
      {rows.map((row) => {
        const typeConfig = getBillingTypeConfig(row.type, t)
        let methodName = '-'
        if (row.type === 'online_topup' && row.payment_method) {
          methodName = getPaymentMethodName(row.payment_method, t)
        } else if (row.type === 'online_topup' && row.payment_provider) {
          methodName = formatProvider(row.payment_provider)
        }
        const showProvider = Boolean(
          row.payment_method &&
          row.payment_provider &&
          row.payment_provider.toLowerCase() !==
            row.payment_method.toLowerCase()
        )
        const username = row.username || row.display_name || `#${row.user_id}`
        const statusConfig = getStatusConfig(row.status)
        const invoiceConfig = getInvoiceStatusConfig(row.invoice_status, t)

        return (
          <article key={row.id} className='px-3 py-2.5'>
            <div className='flex min-w-0 items-center gap-2'>
              {row.type === 'online_topup' && row.status === 'success' && (
                <Checkbox
                  checked={selectedIds.has(row.id)}
                  onCheckedChange={(value) =>
                    onToggleSelected(row.id, value === true)
                  }
                  aria-label={t('Select row')}
                />
              )}
              <code
                className='bg-muted/60 min-w-0 flex-1 truncate rounded px-2 py-1.5 font-mono text-xs'
                title={row.reference}
              >
                {row.reference || '-'}
              </code>
              {row.reference && (
                <CopyButton
                  value={row.reference}
                  className='size-7 shrink-0'
                  iconClassName='size-3.5'
                  tooltip={t('Copy reference')}
                />
              )}
              {row.type === 'online_topup' ? (
                <StatusBadge
                  label={t(statusConfig.label)}
                  variant={statusConfig.variant}
                  showDot
                  copyable={false}
                />
              ) : (
                <StatusBadge
                  label={typeConfig.label}
                  icon={typeConfig.icon}
                  variant={typeConfig.variant}
                  copyable={false}
                />
              )}
            </div>

            <div className='mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2'>
              <div className='min-w-0'>
                <div className='text-muted-foreground text-[11px] leading-4'>
                  {t('User')}
                </div>
                <div className='truncate text-sm font-medium' title={username}>
                  {username}
                </div>
                <div className='text-muted-foreground truncate font-mono text-[11px] leading-4'>
                  #{row.user_id}
                  {row.display_name && row.display_name !== row.username
                    ? ` / ${row.display_name}`
                    : ''}
                </div>
              </div>

              <div className='text-right'>
                <div className='text-muted-foreground text-[11px] leading-4'>
                  {row.type === 'online_topup'
                    ? t('Payment amount')
                    : t('Quota Change')}
                </div>
                <div
                  className={cn(
                    'text-base font-semibold tabular-nums',
                    row.type !== 'online_topup' &&
                      (row.quota < 0 ? 'text-destructive' : 'text-success')
                  )}
                >
                  {row.type === 'online_topup'
                    ? formatNumber(row.money)
                    : `${row.quota > 0 ? '+' : ''}${formatQuota(row.quota)}`}
                </div>
              </div>

              <div className='min-w-0'>
                <div className='text-muted-foreground mb-1 text-[11px] leading-4'>
                  {t('Type')}
                </div>
                {row.type === 'online_topup' ? (
                  <Badge
                    variant='outline'
                    className='bg-muted/40 max-w-full font-normal'
                  >
                    <CreditCard data-icon='inline-start' />
                    <span className='truncate'>
                      {methodName}
                      {showProvider
                        ? ` · ${formatProvider(row.payment_provider)}`
                        : ''}
                    </span>
                  </Badge>
                ) : (
                  <StatusBadge
                    label={typeConfig.label}
                    icon={typeConfig.icon}
                    variant={typeConfig.variant}
                    copyable={false}
                  />
                )}
              </div>

              <div className='min-w-0 text-right'>
                <div className='text-muted-foreground text-[11px] leading-4'>
                  {t('Transaction time')}
                </div>
                <time className='text-muted-foreground block text-xs leading-5 tabular-nums'>
                  {formatTimestamp(row.created_at)}
                </time>
              </div>
            </div>

            {(row.detail || row.operator_user_id) && (
              <div className='text-muted-foreground mt-2 truncate text-xs'>
                {row.detail || `${t('Admin')} #${row.operator_user_id}`}
              </div>
            )}

            {row.type === 'online_topup' && row.status === 'success' && (
              <div className='mt-2.5 flex items-center justify-between border-t pt-2.5'>
                <StatusBadge
                  label={invoiceConfig.label}
                  variant={invoiceConfig.variant}
                  showDot
                  copyable={false}
                />
                <Button
                  type='button'
                  variant={row.invoice_status === 1 ? 'outline' : 'ghost'}
                  size='sm'
                  onClick={() =>
                    onInvoiceAction(
                      row,
                      row.invoice_status === 1 ? 'return' : 'issue'
                    )
                  }
                  disabled={updatingId === row.topup_id}
                >
                  {row.invoice_status === 1 ? (
                    <Undo2 data-icon='inline-start' />
                  ) : (
                    <ReceiptText data-icon='inline-start' />
                  )}
                  {row.invoice_status === 1
                    ? t('Return invoice')
                    : t('Mark as invoiced')}
                </Button>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
