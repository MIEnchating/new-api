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
import { ChevronDown, Send } from 'lucide-react'
import { useEffect, useId, useState, type ReactElement } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { createInvoiceRequest } from '../api'
import {
  invoiceApplicationSchema,
  type InvoiceApplication,
} from '../lib/schema'
import type { InvoiceOrder } from '../types'
import { InvoiceOrderPicker } from './order-picker'

export function InvoiceApplicationForm(props: {
  onSubmitted: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactElement
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const userEmail = useAuthStore((state) => state.auth.user?.email)
  const formId = useId()
  const [selectedOrders, setSelectedOrders] = useState<InvoiceOrder[]>([])
  const invoiceAmount = selectedOrders.reduce(
    (sum, order) => sum + order.money,
    0
  )
  const client = useQueryClient()
  const initialValues: InvoiceApplication = {
    order_ids: [],
    title_type: 'company',
    title: '',
    tax_id: '',
    email: userEmail ?? '',
    invoice_address: '',
    invoice_phone: '',
    bank_name: '',
    bank_account: '',
    remark: '',
  }
  const form = useForm<InvoiceApplication>({
    resolver: zodResolver(invoiceApplicationSchema),
    defaultValues: initialValues,
  })
  const { getFieldState, resetField } = form
  useEffect(() => {
    if (!getFieldState('email').isDirty) {
      resetField('email', { defaultValue: userEmail ?? '' })
    }
  }, [userEmail, props.open, getFieldState, resetField])
  const titleType = useWatch({ control: form.control, name: 'title_type' })
  const mutation = useMutation({
    mutationFn: createInvoiceRequest,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['invoices'] })
      toast.success(t('Invoice application submitted'))
      form.reset(initialValues)
      setSelectedOrders([])
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
  const optionalFields = [
    {
      name: 'invoice_address',
      label: t('Invoice address'),
      maxLength: 300,
      type: 'text',
    },
    {
      name: 'invoice_phone',
      label: t('Invoice phone number'),
      maxLength: 50,
      type: 'tel',
    },
    { name: 'bank_name', label: t('Bank name'), maxLength: 100, type: 'text' },
    {
      name: 'bank_account',
      label: t('Bank account number'),
      maxLength: 64,
      type: 'text',
    },
  ] as const
  return (
    <Dialog
      title={t('Request invoice')}
      open={props.open ?? true}
      trigger={props.trigger}
      onOpenChange={(open) => {
        if (mutation.isPending) return
        form.reset(initialValues)
        setSelectedOrders([])
        props.onOpenChange?.(open)
      }}
      contentClassName='sm:max-w-[min(1200px,calc(100vw-3rem))] overflow-hidden'
      headerClassName='border-b pb-4 pr-8'
      showCloseButton={!mutation.isPending}
      footerClassName='flex-col sm:items-center sm:justify-between'
      footer={
        <>
          <div className='flex items-baseline gap-3' aria-live='polite'>
            <span className='text-muted-foreground text-sm'>
              {t('Invoice amount')}
            </span>
            <output
              aria-label={t('Invoice amount')}
              className='text-2xl font-semibold tabular-nums'
            >
              {formatNumber(invoiceAmount, locale)}
            </output>
          </div>
          <div className='flex items-center justify-end gap-2'>
            <Button
              variant='outline'
              disabled={mutation.isPending}
              onClick={() => {
                form.reset(initialValues)
                setSelectedOrders([])
                props.onOpenChange?.(false)
              }}
            >
              {t('Cancel')}
            </Button>
            <Button
              type='submit'
              form={formId}
              disabled={mutation.isPending || selectedOrders.length === 0}
            >
              <Send className='size-4' aria-hidden='true' />
              {t('Submit invoice application')}
            </Button>
          </div>
        </>
      }
    >
      <form
        id={formId}
        className='grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]'
        onSubmit={form.handleSubmit((input) => mutation.mutate(input))}
      >
        <section aria-label={t('Select orders')} className='min-w-0 space-y-3'>
          <h3 className='text-sm font-semibold'>{t('Select orders')}</h3>
          <InvoiceOrderPicker
            selected={selectedOrders}
            enabled={props.open ?? true}
            onChange={(orders) => {
              setSelectedOrders(orders)
              form.setValue(
                'order_ids',
                orders.map((order) => order.id),
                { shouldValidate: true }
              )
            }}
            disabled={mutation.isPending}
          />
        </section>
        <section
          aria-label={t('Invoice details')}
          className='min-w-0 space-y-4 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6'
        >
          <h3 className='text-sm font-semibold'>{t('Invoice details')}</h3>
          <div className='space-y-2'>
            <Label htmlFor='invoice-title-type'>
              {t('Invoice title type')}
            </Label>
            <Select
              value={titleType}
              onValueChange={(value) => {
                if (value === 'company' || value === 'personal') {
                  form.setValue('title_type', value, { shouldValidate: true })
                }
              }}
              items={[
                { value: 'company', label: t('Company') },
                { value: 'personal', label: t('Personal') },
              ]}
              disabled={mutation.isPending}
            >
              <SelectTrigger id='invoice-title-type'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                alignItemWithTrigger={false}
                side='bottom'
                align='start'
              >
                <SelectItem value='company'>{t('Company')}</SelectItem>
                <SelectItem value='personal'>{t('Personal')}</SelectItem>
              </SelectContent>
            </Select>
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
          <Collapsible className='rounded-xl border'>
            <CollapsibleTrigger
              aria-label={t('Optional invoice details')}
              render={
                <Button
                  variant='ghost'
                  type='button'
                  className='group h-auto min-h-11 w-full justify-between gap-3 rounded-xl px-3 py-3 text-start whitespace-normal aria-expanded:rounded-b-none'
                />
              }
            >
              <span className='flex-1'>{t('Optional invoice details')}</span>
              <span className='text-muted-foreground text-xs font-normal'>
                {t('Optional')}
              </span>
              <ChevronDown
                className='text-muted-foreground size-4 transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none'
                aria-hidden='true'
              />
            </CollapsibleTrigger>
            <CollapsibleContent keepMounted>
              <div className='bg-muted/20 grid gap-4 rounded-b-xl border-t p-3'>
                {optionalFields.map((field) => (
                  <div key={field.name} className='grid min-w-0 gap-2'>
                    <Label htmlFor={`invoice-${field.name}`}>
                      {field.label}
                    </Label>
                    <Input
                      id={`invoice-${field.name}`}
                      className='bg-background'
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
              </div>
            </CollapsibleContent>
          </Collapsible>
          <div className='grid gap-2 border-t pt-4'>
            <Label htmlFor='invoice-remark'>{t('Remarks')}</Label>
            <Textarea
              id='invoice-remark'
              className='min-h-20 resize-y'
              maxLength={1000}
              {...form.register('remark')}
              disabled={mutation.isPending}
            />
          </div>
        </section>
      </form>
    </Dialog>
  )
}
