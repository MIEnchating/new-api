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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { processInvoiceRequest } from '../api'
import { invoiceProcessSchema } from '../lib/schema'
import type { InvoiceProcessInput, InvoiceRequest } from '../types'

export function InvoiceProcessDialog(props: {
  request: InvoiceRequest
  action: 'issued' | 'rejected'
  onClose: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const issue = props.action === 'issued'
  const form = useForm<InvoiceProcessInput>({
    resolver: zodResolver(invoiceProcessSchema),
    mode: 'onChange',
    defaultValues: {
      status: props.action,
      invoice_number: '',
      invoice_url: '',
      note: '',
    },
  })
  const mutation = useMutation({
    mutationFn: (input: InvoiceProcessInput) =>
      processInvoiceRequest(props.request.id, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['invoices'] })
      void client.invalidateQueries({ queryKey: ['admin-topup-stats'] })
      toast.success(t('Invoice application processed'))
      props.onClose()
    },
  })
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={issue ? t('Complete invoicing') : t('Reject application')}
      desc={props.request.title}
      confirmText={t('Confirm')}
      destructive={!issue}
      isLoading={mutation.isPending}
      disabled={!form.formState.isValid}
      handleConfirm={form.handleSubmit((input) => mutation.mutate(input))}
    >
      <div className='space-y-4'>
        {issue && (
          <>
            <div className='space-y-2'>
              <Label htmlFor='invoice-number'>{t('Invoice number')}</Label>
              <Input
                id='invoice-number'
                maxLength={100}
                {...form.register('invoice_number')}
                disabled={mutation.isPending}
              />
            </div>
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
          />
        </div>
      </div>
    </ConfirmDialog>
  )
}
