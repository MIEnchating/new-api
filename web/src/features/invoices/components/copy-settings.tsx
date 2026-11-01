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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { handleServerError } from '@/lib/handle-server-error'

import { getInvoiceSettings, saveInvoiceCopyFields } from '../api'
import { invoiceCopyFields } from '../constants'
import { invoiceCopyFieldLabels } from '../lib/copy-fields'
import type { InvoiceCopyField, InvoiceSettings } from '../types'

export function InvoiceCopySettingsDialog() {
  const { t } = useTranslation()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<InvoiceCopyField[] | null>(null)
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['invoices', 'settings'],
    queryFn: getInvoiceSettings,
    enabled: open,
    staleTime: 60_000,
  })
  const values = selected ?? query.data?.copy_fields ?? [...invoiceCopyFields]
  const labels = invoiceCopyFieldLabels(t)
  const mutation = useMutation({
    mutationFn: saveInvoiceCopyFields,
    onSuccess: (_, fields) => {
      client.setQueryData<InvoiceSettings>(
        ['invoices', 'settings'],
        (current) => (current ? { ...current, copy_fields: fields } : current)
      )
      void client.invalidateQueries({ queryKey: ['invoices', 'settings'] })
      toast.success(t('Settings saved'))
      setOpen(false)
    },
    onError: (error) => handleServerError(error),
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (mutation.isPending) return
        setSelected(null)
        setOpen(next)
      }}
      title={t('Invoice copy settings')}
      description={t(
        'Choose the fields included when copying invoice details. This applies to all users. Empty fields are skipped.'
      )}
      trigger={<Button variant='outline'>{t('Copy settings')}</Button>}
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
            disabled={
              !query.data ||
              query.isError ||
              mutation.isPending ||
              values.length === 0
            }
            onClick={() =>
              mutation.mutate(
                invoiceCopyFields.filter((field) => values.includes(field))
              )
            }
          >
            {t('Save')}
          </Button>
        </>
      }
    >
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && !query.isError && (
        <div className='space-y-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              size='sm'
              variant='outline'
              disabled={mutation.isPending}
              onClick={() => setSelected([...invoiceCopyFields])}
            >
              {t('Select all')}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              disabled={mutation.isPending}
              onClick={() => setSelected([])}
            >
              {t('Deselect all')}
            </Button>
          </div>
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
            {invoiceCopyFields.map((field) => (
              <div
                key={field}
                className='flex items-center gap-3 rounded-lg border p-3'
              >
                <Checkbox
                  id={`${id}-${field}`}
                  checked={values.includes(field)}
                  disabled={mutation.isPending}
                  onCheckedChange={(checked) =>
                    setSelected(
                      checked
                        ? [...values, field]
                        : values.filter((value) => value !== field)
                    )
                  }
                />
                <Label
                  htmlFor={`${id}-${field}`}
                  className='flex-1 cursor-pointer'
                >
                  {labels[field]}
                </Label>
              </div>
            ))}
          </div>
          {values.length === 0 && (
            <p role='alert' className='text-destructive text-sm'>
              {t('Select at least one valid invoice copy field')}
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}
