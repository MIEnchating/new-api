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
import { useMutation } from '@tanstack/react-query'
import { useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StaticDataTable } from '@/components/data-table'
import {
  sideDrawerContentClassName,
  sideDrawerHeaderClassName,
  sideDrawerFormClassName,
  sideDrawerFooterClassName,
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
import { InvoiceFileUpload } from './file-upload'

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
  const [uploading, setUploading] = useState(false)
  const download = useMutation({
    mutationFn: () => downloadInvoiceFile(request.id),
  })
  const email = useMutation({
    mutationFn: () => sendInvoiceEmail(request.id),
    onSuccess: () =>
      toast.success(t('Invoice sent to {{email}}', { email: request.email })),
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
        if (!open && !uploading) props.onClose()
      }}
    >
      <SheetContent
        finalFocus={props.finalFocus}
        className={sideDrawerContentClassName('sm:max-w-xl')}
      >
        <SheetHeader className={sideDrawerHeaderClassName('pr-12')}>
          <SheetTitle>
            {t('Application details')} · #{request.id}
          </SheetTitle>
          <SheetDescription className='break-all'>
            {request.title}
          </SheetDescription>
        </SheetHeader>
        <div className={sideDrawerFormClassName('[overflow-wrap:anywhere]')}>
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
          <dl className='grid gap-2 text-sm sm:grid-cols-2'>
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
          {props.admin && request.status === 'issued' && (
            <InvoiceFileUpload
              requestId={request.id}
              uploaded={request.invoice_url.startsWith('invoice-file:')}
              onUploadingChange={setUploading}
              disabled={email.isPending || download.isPending}
            />
          )}
          {(props.admin || request.status === 'issued') &&
            request.invoice_url.startsWith('invoice-file:') && (
              <Button
                variant='outline'
                disabled={download.isPending || uploading}
                onClick={() => download.mutate()}
              >
                {t('Download invoice')}
              </Button>
            )}
          {request.status === 'issued' && request.invoice_url && (
            <div className='space-y-2'>
              <Button
                variant='outline'
                disabled={email.isPending || uploading}
                onClick={() => email.mutate()}
              >
                {email.isPending ? t('Sending...') : t('Send to email')}
              </Button>
              <p className='text-muted-foreground text-xs break-all'>
                {request.email}
              </p>
            </div>
          )}
        </div>
        <SheetFooter className={sideDrawerFooterClassName()}>
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
            <Button
              variant='outline'
              disabled={uploading}
              onClick={props.onClose}
            >
              {t('Close')}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
