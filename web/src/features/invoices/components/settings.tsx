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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { getInvoiceSettings, saveInvoiceSettings } from '../api'
import { invoiceSettingsSchema } from '../lib/schema'
import type { InvoiceSettings } from '../types'

export function InvoiceSettingsDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const formId = useId()
  const inputId = useId()
  const daysId = useId()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['invoices', 'settings'],
    queryFn: getInvoiceSettings,
    enabled: open,
  })
  const form = useForm<InvoiceSettings>({
    resolver: zodResolver(invoiceSettingsSchema),
    values: query.data,
    defaultValues: { minimum_amount: 1000, application_days: 90 },
  })
  const mutation = useMutation({
    mutationFn: saveInvoiceSettings,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['invoices', 'settings'] })
      void client.invalidateQueries({ queryKey: ['invoices', 'eligible'] })
      toast.success(t('Settings saved'))
      setOpen(false)
    },
  })
  const invalid = Boolean(form.formState.errors.minimum_amount)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (mutation.isPending) return
        form.reset(query.data)
        setOpen(next)
      }}
      title={t('Invoice settings')}
      trigger={<Button variant='outline'>{t('Invoice settings')}</Button>}
      contentClassName='sm:max-w-lg'
      footer={
        <>
          <Button
            variant='outline'
            disabled={mutation.isPending}
            onClick={() => setOpen(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form={formId}
            disabled={!query.data || query.isError || mutation.isPending}
          >
            {t('Save')}
          </Button>
        </>
      }
    >
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && !query.isError && (
        <form
          id={formId}
          className='space-y-2'
          onSubmit={form.handleSubmit((input) => mutation.mutate(input))}
        >
          <Label htmlFor={inputId}>{t('Minimum invoice amount')}</Label>
          <Input
            id={inputId}
            type='number'
            min={0}
            max={1_000_000_000_000}
            step='0.01'
            required
            disabled={mutation.isPending}
            aria-invalid={invalid}
            aria-describedby={`${inputId}-help`}
            {...form.register('minimum_amount', { valueAsNumber: true })}
          />
          <p id={`${inputId}-help`} className='text-muted-foreground text-sm'>
            {t(
              'The combined amount of selected orders must reach this minimum.'
            )}
          </p>
          {invalid && (
            <p role='alert' className='text-destructive text-sm'>
              {t('Invalid minimum invoice amount')}
            </p>
          )}

          <div className='mt-5 space-y-2 border-t pt-5'>
            <Label htmlFor={daysId}>
              {t('Invoice application window (days)')}
            </Label>
            <Input
              id={daysId}
              type='number'
              min={0}
              max={3650}
              step={1}
              required
              disabled={mutation.isPending}
              aria-invalid={Boolean(form.formState.errors.application_days)}
              aria-describedby={`${daysId}-help`}
              {...form.register('application_days', { valueAsNumber: true })}
            />
            <p id={`${daysId}-help`} className='text-muted-foreground text-sm'>
              {t(
                'Counted from payment completion. Set to 0 for no time limit. Existing applications are unaffected.'
              )}
            </p>
            {form.formState.errors.application_days && (
              <p role='alert' className='text-destructive text-sm'>
                {t('Invalid invoice application window')}
              </p>
            )}
          </div>
        </form>
      )}
    </Dialog>
  )
}
