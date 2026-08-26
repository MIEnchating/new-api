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
import { CreditCard } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getPaymentMethodName,
  getStatusConfig,
} from '@/features/wallet/lib/billing'
import { formatNumber, formatQuota, formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getBillingTypeConfig, getInvoiceStatusConfig } from '../lib'
import type { TopUpStatsItem } from '../types'

type TopUpStatsDetailsDialogProps = {
  item: TopUpStatsItem | null
  onOpenChange: (open: boolean) => void
}

function formatProvider(provider: string): string {
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function DetailItem({
  label,
  value,
  className,
}: {
  label: string
  value: ReactNode
  className?: string
}) {
  return (
    <div
      data-detail-label={label}
      className={cn('min-w-0 space-y-1', className)}
    >
      <div className='text-muted-foreground text-xs'>{label}</div>
      <div className='min-h-5 min-w-0 text-sm'>{value}</div>
    </div>
  )
}

export function TopUpStatsDetailsDialog({
  item,
  onOpenChange,
}: TopUpStatsDetailsDialogProps) {
  const { t } = useTranslation()
  if (!item) return null

  const typeConfig = getBillingTypeConfig(item.type, t)
  const statusConfig = getStatusConfig(item.status)
  const invoiceConfig = getInvoiceStatusConfig(item.invoice_status, t)
  const username = item.username || item.display_name || `#${item.user_id}`
  let paymentMethod = '-'
  if (item.payment_method) {
    const translated = getPaymentMethodName(item.payment_method, t)
    paymentMethod =
      translated === item.payment_method
        ? formatProvider(item.payment_method)
        : translated
  } else if (item.payment_provider) {
    paymentMethod = formatProvider(item.payment_provider)
  }
  const invoiceTime =
    item.invoice_status === 2 ? item.invoice_returned_at : item.invoiced_at
  const invoiceOperator =
    item.invoice_status === 2 ? item.invoice_returned_by : item.invoiced_by
  const detail = item.detail?.trim()

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('Details')}
      description={item.reference}
      showCloseButton
      contentClassName='sm:max-w-3xl'
      footer={
        <Button
          type='button'
          variant='outline'
          onClick={() => onOpenChange(false)}
        >
          {t('Close')}
        </Button>
      }
    >
      <div className='grid gap-4 sm:grid-cols-2'>
        <DetailItem
          label={t('Order number / reference')}
          className='sm:col-span-2'
          value={
            <div className='flex min-w-0 items-center gap-2'>
              <code className='bg-muted/60 min-w-0 truncate rounded px-2 py-1 font-mono text-xs'>
                {item.reference || '-'}
              </code>
              {item.reference && (
                <CopyButton
                  value={item.reference}
                  className='size-7 shrink-0'
                  iconClassName='size-3.5'
                  tooltip={t('Copy reference')}
                />
              )}
            </div>
          }
        />
        <DetailItem
          label={t('User')}
          value={
            <div>
              <div className='font-medium'>{username}</div>
              <div className='text-muted-foreground font-mono text-xs'>
                #{item.user_id}
                {item.display_name && item.display_name !== item.username
                  ? ` / ${item.display_name}`
                  : ''}
              </div>
            </div>
          }
        />
        <DetailItem
          label={t('Type')}
          value={
            <div className='flex flex-wrap items-center gap-1.5'>
              <StatusBadge
                label={typeConfig.label}
                icon={typeConfig.icon}
                variant={typeConfig.variant}
                copyable={false}
              />
              {item.excluded_from_stats && (
                <Badge
                  variant='outline'
                  className='border-warning/40 bg-warning/10 text-warning'
                >
                  {t('Campaign exclusive')}
                </Badge>
              )}
            </div>
          }
        />
        <DetailItem
          label={t('Top-up method')}
          value={
            item.type === 'online_topup' ? (
              <Badge variant='outline' className='bg-muted/40 font-normal'>
                <CreditCard data-icon='inline-start' />
                {paymentMethod}
              </Badge>
            ) : (
              <span className='text-muted-foreground'>-</span>
            )
          }
        />
        <DetailItem
          label={t('Provider')}
          value={
            item.payment_provider ? (
              formatProvider(item.payment_provider)
            ) : (
              <span className='text-muted-foreground'>-</span>
            )
          }
        />
        <DetailItem
          label={t('Payment amount')}
          value={
            item.type === 'online_topup' ? (
              <span className='font-semibold tabular-nums'>
                {formatNumber(item.money)}
              </span>
            ) : (
              <span className='text-muted-foreground'>-</span>
            )
          }
        />
        <DetailItem
          label={t('Quota Change')}
          value={
            <span
              className={cn(
                'font-semibold tabular-nums',
                item.quota < 0 ? 'text-destructive' : 'text-success'
              )}
            >
              {item.quota > 0 ? '+' : ''}
              {formatQuota(item.quota)}
            </span>
          }
        />
        <DetailItem
          label={t('Order status')}
          value={
            item.type === 'online_topup' ? (
              <StatusBadge
                label={t(statusConfig.label)}
                variant={statusConfig.variant}
                showDot
                copyable={false}
              />
            ) : (
              <span className='text-muted-foreground'>-</span>
            )
          }
        />
        <DetailItem
          label={t('Invoice status')}
          value={
            item.excluded_from_stats ? (
              <StatusBadge
                label={t('Not included in statistics')}
                variant='warning'
                copyable={false}
              />
            ) : item.invoice_eligible ? (
              <StatusBadge
                label={invoiceConfig.label}
                variant={invoiceConfig.variant}
                showDot
                copyable={false}
              />
            ) : (
              <span className='text-muted-foreground'>-</span>
            )
          }
        />
        <DetailItem
          label={t('Transaction time')}
          value={
            <span className='tabular-nums'>
              {formatTimestamp(item.created_at)}
            </span>
          }
        />
        {item.operator_user_id ? (
          <DetailItem
            label={t('Operator Admin')}
            value={<span className='font-mono'>#{item.operator_user_id}</span>}
          />
        ) : null}
        {(invoiceTime > 0 || invoiceOperator > 0) && (
          <DetailItem
            label={invoiceConfig.label}
            value={
              <div>
                {invoiceTime > 0 && (
                  <div className='tabular-nums'>
                    {formatTimestamp(invoiceTime)}
                  </div>
                )}
                {invoiceOperator > 0 && (
                  <div className='text-muted-foreground text-xs'>
                    {t('Operator Admin')} #{invoiceOperator}
                  </div>
                )}
              </div>
            }
          />
        )}
        {detail ? (
          <DetailItem
            label={t('Details')}
            className='sm:col-span-2'
            value={
              <div className='bg-muted/40 rounded-md border px-3 py-2 break-words whitespace-pre-wrap'>
                {detail}
              </div>
            }
          />
        ) : null}
      </div>
    </Dialog>
  )
}
