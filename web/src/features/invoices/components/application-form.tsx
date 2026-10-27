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
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

import { createInvoiceRequest } from '../api'
import {
  invoiceApplicationSchema,
  type InvoiceApplication,
} from '../lib/schema'
import { InvoiceOrderPicker } from './order-picker'

export function InvoiceApplicationForm(props: { onSubmitted: () => void }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<InvoiceApplication>({
    resolver: zodResolver(invoiceApplicationSchema),
    defaultValues: {
      order_ids: [],
      title_type: 'company',
      title: '',
      tax_id: '',
      email: '',
      remark: '',
    },
  })
  const selected = useWatch({ control: form.control, name: 'order_ids' })
  const titleType = useWatch({ control: form.control, name: 'title_type' })
  const mutation = useMutation({
    mutationFn: createInvoiceRequest,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['invoices'] })
      toast.success(t('Invoice application submitted'))
      props.onSubmitted()
    },
  })
  const fields = [
    { name: 'title', label: t('Invoice title'), maxLength: 200, type: 'text' },
    {
      name: 'tax_id',
      label: t('Tax identification number'),
      maxLength: 32,
      type: 'text',
    },
    { name: 'email', label: t('Invoice email'), maxLength: 254, type: 'email' },
  ] as const
  return (
    <form
      className='space-y-4'
      onSubmit={form.handleSubmit((input) => mutation.mutate(input))}
    >
      <InvoiceOrderPicker
        selected={selected}
        onChange={(ids) =>
          form.setValue('order_ids', ids, { shouldValidate: true })
        }
        disabled={mutation.isPending}
      />
      {form.formState.errors.order_ids && (
        <p role='alert' className='text-destructive text-sm'>
          {t('Select 1 to 100 eligible paid orders belonging to your account')}
        </p>
      )}
      <div className='space-y-2'>
        <Label htmlFor='invoice-title-type'>{t('Invoice title type')}</Label>
        <NativeSelect
          id='invoice-title-type'
          {...form.register('title_type')}
          disabled={mutation.isPending}
        >
          <NativeSelectOption value='company'>
            {t('Company')}
          </NativeSelectOption>
          <NativeSelectOption value='personal'>
            {t('Personal')}
          </NativeSelectOption>
        </NativeSelect>
      </div>
      {fields.map((field) => (
        <div key={field.name} className='space-y-2'>
          <Label htmlFor={`invoice-${field.name}`}>
            {field.label}
            {field.name === 'tax_id' && titleType === 'personal'
              ? ` (${t('Optional')})`
              : ''}
          </Label>
          <Input
            id={`invoice-${field.name}`}
            type={field.type}
            maxLength={field.maxLength}
            {...form.register(field.name)}
            disabled={mutation.isPending}
            aria-invalid={Boolean(form.formState.errors[field.name])}
            aria-describedby={
              form.formState.errors[field.name]
                ? `invoice-${field.name}-error`
                : undefined
            }
          />
          {form.formState.errors[field.name] && (
            <p
              id={`invoice-${field.name}-error`}
              role='alert'
              className='text-destructive text-sm'
            >
              {t('Invalid invoice application details')}
            </p>
          )}
        </div>
      ))}
      <div className='space-y-2'>
        <Label htmlFor='invoice-remark'>{t('Remarks')}</Label>
        <Textarea
          id='invoice-remark'
          maxLength={1000}
          {...form.register('remark')}
          disabled={mutation.isPending}
        />
      </div>
      <Button
        type='submit'
        disabled={mutation.isPending || selected.length === 0}
      >
        {t('Submit invoice application')}
      </Button>
    </form>
  )
}
