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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { MultiSelect } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

import {
  getInvoiceNotificationSettings,
  saveInvoiceNotificationSettings,
} from '../api'

export function InvoiceNotificationDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[] | null>(null)
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['invoices', 'notifications'],
    queryFn: getInvoiceNotificationSettings,
    enabled: open,
  })
  const mutation = useMutation({
    mutationFn: saveInvoiceNotificationSettings,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['invoices', 'notifications'] })
      toast.success(t('Settings saved'))
      setOpen(false)
    },
  })
  const values = selected ?? query.data?.user_ids.map(String) ?? []
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (mutation.isPending) return
        setOpen(next)
        setSelected(null)
      }}
      title={t('Invoice notifications')}
      description={t(
        'Selected administrators receive new applications through their configured notification channel.'
      )}
      trigger={<Button variant='outline'>{t('Notification settings')}</Button>}
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
            disabled={!query.data || query.isError || mutation.isPending}
            onClick={() => mutation.mutate(values.map(Number))}
          >
            {t('Save')}
          </Button>
        </>
      }
    >
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && !query.isError && (
        <div className='space-y-2'>
          <Label htmlFor='invoice-notification-recipients'>
            {t('Notification recipients')}
          </Label>
          <MultiSelect
            id='invoice-notification-recipients'
            options={query.data.administrators.map((admin) => ({
              value: String(admin.id),
              label: `${admin.display_name || admin.username} (${admin.username} · #${admin.id})`,
            }))}
            selected={values}
            onChange={setSelected}
            disabled={mutation.isPending}
            placeholder={t('Select administrators')}
          />
          <p className='text-muted-foreground text-xs'>
            {t('Leave empty to disable invoice notifications.')}
          </p>
        </div>
      )}
    </Dialog>
  )
}
