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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { processInvoiceRequest } from '../api'
import { invoiceProcessSchema } from '../lib/schema'
import type { InvoiceProcessInput, InvoiceRequest } from '../types'
import { InvoiceFileUpload } from './file-upload'

export function InvoiceProcessDialog(props: {
  request: InvoiceRequest
  action: 'issued' | 'rejected'
  onClose: () => void
  onProcessed?: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const issue = props.action === 'issued'
  const [uploaded, setUploaded] = useState(
    props.request.invoice_url.startsWith('invoice-file:')
  )
  const [recognition, setRecognition] = useState<
    'idle' | 'recognized' | 'not-found'
  >('idle')
  const [uploading, setUploading] = useState(false)
  const form = useForm<InvoiceProcessInput>({
    resolver: zodResolver(invoiceProcessSchema),
    mode: 'onChange',
    defaultValues: {
      status: props.action,
      invoice_number: props.request.invoice_number,
      invoice_url: props.request.invoice_url.startsWith('https://')
        ? props.request.invoice_url
        : '',
      note: '',
      send_email: issue,
    },
  })
  const mutation = useMutation({
    mutationFn: (input: InvoiceProcessInput) =>
      processInvoiceRequest(props.request.id, input),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['invoices'] })
      void client.invalidateQueries({ queryKey: ['admin-topup-stats'] })
      toast.success(t('Invoice application processed'))
      if (result.email_sent) toast.success(t('Invoice email sent'))
      if (result.email_failed) {
        toast.error(
          t(
            'Invoice issued, but email delivery failed. You can send it again from the application details.'
          )
        )
      }
      if (result.notification_sent) {
        toast.success(t('Invoice download notification sent'))
      }
      if (result.notification_failed) {
        toast.error(
          t(
            'Invoice issued, but the download notification failed. Please notify the user to download it.'
          )
        )
      }
      props.onProcessed?.()
      props.onClose()
    },
  })
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending && !uploading) props.onClose()
      }}
      title={issue ? t('Complete invoicing') : t('Reject application')}
      desc={`#${props.request.id} · ${props.request.title}`}
      className='data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-xl'
      confirmText={t('Confirm')}
      destructive={!issue}
      isLoading={mutation.isPending || uploading}
      disabled={
        !form.formState.isValid ||
        uploading ||
        (issue &&
          form.watch('send_email') &&
          !uploaded &&
          !form.watch('invoice_url').trim())
      }
      handleConfirm={form.handleSubmit((input) => mutation.mutate(input))}
    >
      <div className='space-y-5'>
        <div className='bg-muted/40 flex items-center justify-between gap-4 rounded-lg border px-4 py-3'>
          <span className='text-muted-foreground text-sm'>
            {t('Invoice amount')}
          </span>
          <span className='text-xl font-semibold tabular-nums'>
            {formatNumber(
              props.request.orders.reduce(
                (total, order) => total + order.money,
                0
              ),
              locale
            )}
          </span>
        </div>
        {issue && (
          <>
            <InvoiceFileUpload
              requestId={props.request.id}
              uploaded={uploaded}
              disabled={mutation.isPending}
              onUploadingChange={setUploading}
              onUploaded={(result) => {
                setUploaded(true)
                setRecognition(
                  result.invoice_number ? 'recognized' : 'not-found'
                )
                if (
                  result.invoice_number &&
                  !form.getFieldState('invoice_number').isDirty
                ) {
                  form.setValue('invoice_number', result.invoice_number, {
                    shouldValidate: true,
                  })
                }
                form.setValue('invoice_url', '', { shouldValidate: true })
              }}
            />
            <div className='space-y-2'>
              <Label htmlFor='invoice-number'>{t('Invoice number')}</Label>
              <Input
                id='invoice-number'
                maxLength={100}
                aria-required
                aria-describedby='invoice-number-help'
                {...form.register('invoice_number')}
                disabled={mutation.isPending}
              />
              <p
                id='invoice-number-help'
                className='text-muted-foreground text-xs leading-relaxed'
                aria-live='polite'
              >
                {recognition === 'recognized' &&
                  t(
                    'Invoice number recognized. Please verify before confirming.'
                  )}
                {recognition === 'not-found' &&
                  t(
                    'Invoice number could not be recognized. Please enter it manually.'
                  )}
                {recognition === 'idle' &&
                  t(
                    'Upload an invoice to recognize its number, or enter it manually.'
                  )}
              </p>
            </div>
            {!uploaded && (
              <div className='space-y-2'>
                <Label htmlFor='invoice-url'>
                  {t('Invoice link (HTTPS, optional)')}
                </Label>
                <Input
                  id='invoice-url'
                  maxLength={2000}
                  {...form.register('invoice_url')}
                  disabled={mutation.isPending}
                  aria-invalid={Boolean(form.formState.errors.invoice_url)}
                />
              </div>
            )}
          </>
        )}
        <div className='space-y-2'>
          <Label htmlFor='invoice-note'>
            {issue ? t('Processing note') : t('Rejection reason')}
          </Label>
          <Textarea
            id='invoice-note'
            maxLength={1000}
            {...form.register('note')}
            disabled={mutation.isPending}
            className='min-h-20 resize-y'
          />
        </div>
        {issue && (
          <div className='bg-muted/30 flex items-start justify-between gap-4 rounded-lg border p-4'>
            <div className='min-w-0 space-y-1.5'>
              <Label htmlFor='invoice-send-email'>{t('Send to email')}</Label>
              <p className='text-muted-foreground text-xs break-all'>
                {props.request.email}
              </p>
              <p className='text-muted-foreground text-xs leading-relaxed'>
                {form.watch('send_email')
                  ? t(
                      'The invoice will be emailed after confirmation. Upload a file or provide an invoice link.'
                    )
                  : t(
                      'The invoice attachment will not be emailed. The user will receive a notification to download it from their applications.'
                    )}
              </p>
            </div>
            <Switch
              id='invoice-send-email'
              checked={form.watch('send_email')}
              disabled={mutation.isPending || uploading}
              onCheckedChange={(checked) =>
                form.setValue('send_email', checked, { shouldValidate: true })
              }
            />
          </div>
        )}
      </div>
    </ConfirmDialog>
  )
}
