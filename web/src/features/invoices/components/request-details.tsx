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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StaticDataTable } from '@/components/data-table'
import {
  sideDrawerContentClassName,
  sideDrawerHeaderClassName,
  sideDrawerFormClassName,
  sideDrawerFooterClassName,
  SideDrawerSection,
  SideDrawerSectionHeader,
} from '@/components/drawer-layout'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { formatTimestamp } from '@/features/wallet/lib/billing'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { downloadInvoiceFile, sendInvoiceEmail } from '../api'
import { invoiceStatusIcons, invoiceStatusVariants } from '../constants'
import type { InvoiceRequest } from '../types'
import { InvoiceCopyButton } from './copy-invoice-button'
import { InvoiceFilePreview } from './file-preview'

export function InvoiceRequestDetails(props: {
  finalFocus: RefObject<HTMLElement | null>
  request: InvoiceRequest
  admin: boolean
  onClose: () => void
  onProcess: (action: 'issued' | 'rejected') => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const request = props.request
  const client = useQueryClient()
  const [sent, setSent] = useState(false)
  const download = useMutation({
    mutationFn: () => downloadInvoiceFile(request.id),
  })
  const email = useMutation({
    mutationFn: () => sendInvoiceEmail(request.id),
    onSuccess: () => {
      setSent(true)
      void client.invalidateQueries({ queryKey: ['invoices', 'requests'] })
      toast.success(t('Invoice sent to {{email}}', { email: request.email }))
    },
  })
  const labels = {
    pending: t('Awaiting invoicing'),
    issued: t('Invoiced'),
    rejected: t('Rejected'),
    withdrawn: t('Withdrawn'),
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <SheetContent
        finalFocus={props.finalFocus}
        className={sideDrawerContentClassName('sm:max-w-xl')}
      >
        <SheetHeader className={sideDrawerHeaderClassName('shrink-0 pr-12')}>
          <SheetTitle>
            {t('Application details')} · #{request.id}
          </SheetTitle>
          <SheetDescription className='break-all'>
            {request.title}
          </SheetDescription>
        </SheetHeader>
        <div
          role='region'
          aria-label={t('Invoice details')}
          className={sideDrawerFormClassName(
            'block space-y-6 [overflow-wrap:anywhere]'
          )}
        >
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <StatusBadge
              copyable={false}
              variant={invoiceStatusVariants[request.status]}
              icon={invoiceStatusIcons[request.status]}
            >
              {labels[request.status]}
            </StatusBadge>
            <InvoiceCopyButton request={request} />
          </div>
          <SideDrawerSection>
            <dl className='grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 [&_dd]:mt-1 [&>div]:min-w-0'>
              {props.admin && (
                <div>
                  <dt className='text-muted-foreground'>{t('User')}</dt>
                  <dd>{request.display_name || request.username || '—'}</dd>
                  <dd className='text-muted-foreground text-xs'>
                    {request.username} · #{request.user_id}
                  </dd>
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
              {request.invoice_address && (
                <div>
                  <dt className='text-muted-foreground'>
                    {t('Invoice address')}
                  </dt>
                  <dd>{request.invoice_address}</dd>
                </div>
              )}
              {request.invoice_phone && (
                <div>
                  <dt className='text-muted-foreground'>
                    {t('Invoice phone number')}
                  </dt>
                  <dd>{request.invoice_phone}</dd>
                </div>
              )}
              {request.bank_name && (
                <div>
                  <dt className='text-muted-foreground'>{t('Bank name')}</dt>
                  <dd>{request.bank_name}</dd>
                </div>
              )}
              {request.bank_account && (
                <div>
                  <dt className='text-muted-foreground'>
                    {t('Bank account number')}
                  </dt>
                  <dd>{request.bank_account}</dd>
                </div>
              )}
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
          </SideDrawerSection>
          <SideDrawerSection>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <SideDrawerSectionHeader title={t('Orders')} />
              <p className='text-muted-foreground text-sm'>
                {t('Invoice amount')}:{' '}
                <span className='text-foreground font-medium tabular-nums'>
                  {formatNumber(
                    request.orders.reduce(
                      (total, order) => total + order.money,
                      0
                    ),
                    locale
                  )}
                </span>
              </p>
            </div>
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
                  className: 'w-28 text-right',
                  cellClassName: 'text-right tabular-nums',
                  cell: (order) => formatNumber(order.money, locale),
                },
              ]}
            />
          </SideDrawerSection>
          {(request.invoice_number ||
            request.process_note ||
            request.processed_at > 0 ||
            request.invoice_url ||
            (props.admin && request.status === 'issued')) && (
            <SideDrawerSection>
              <SideDrawerSectionHeader title={t('Invoice details')} />
              <div className='space-y-2'>
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
                    {request.status === 'withdrawn'
                      ? t('Withdrawal time')
                      : t('Review time')}
                    : {formatTimestamp(request.processed_at)}
                  </p>
                )}
              </div>
              {(props.admin || request.status === 'issued') &&
                request.invoice_url.startsWith('invoice-file:') && (
                  <InvoiceFilePreview
                    requestId={request.id}
                    title={request.title}
                  />
                )}
              <div
                role='group'
                aria-label={t('Actions')}
                className='flex flex-wrap items-center gap-2'
              >
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
                {(props.admin || request.status === 'issued') &&
                  request.invoice_url.startsWith('invoice-file:') && (
                    <Button
                      variant='outline'
                      disabled={download.isPending}
                      onClick={() => download.mutate()}
                    >
                      {t('Download invoice')}
                    </Button>
                  )}
                {request.status === 'issued' && request.invoice_url && (
                  <Button
                    variant='outline'
                    disabled={email.isPending}
                    onClick={() => email.mutate()}
                  >
                    {email.isPending && t('Sending...')}
                    {!email.isPending &&
                      (sent || (request.email_sent_at ?? 0) > 0
                        ? t('Resend to email')
                        : t('Send to email'))}
                  </Button>
                )}
              </div>
            </SideDrawerSection>
          )}
        </div>
        <SheetFooter className={sideDrawerFooterClassName('shrink-0')}>
          {props.admin && request.status === 'pending' ? (
            <>
              <Button
                variant='outline'
                onClick={() => props.onProcess('rejected')}
              >
                {t('Reject application')}
              </Button>
              <Button onClick={() => props.onProcess('issued')}>
                {t('Complete invoicing')}
              </Button>
            </>
          ) : (
            <Button variant='outline' onClick={props.onClose}>
              {t('Close')}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
