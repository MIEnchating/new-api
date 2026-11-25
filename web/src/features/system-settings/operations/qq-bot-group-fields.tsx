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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import type { QQBotFormValues, QQBotSettings } from './lib/qq-bot-settings'
import { QQBotTextField } from './qq-bot-chat-fields'

export function QQBotGroupFields(props: { settings: QQBotSettings }) {
  const { t } = useTranslation()
  const form = useFormContext<QQBotFormValues>()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const [appID, groups] = useWatch({
    control: form.control,
    name: ['app_id', 'groups'],
  })
  const [open, setOpen] = useState(false)
  const canDiscover =
    props.settings.enabled && appID.trim() === props.settings.app_id
  const query = useQuery({
    queryKey: ['qq-bot-discovered-groups', userID, props.settings.revision],
    enabled: open && canDiscover,
    refetchInterval: open && canDiscover ? 5000 : false,
    gcTime: 0,
    meta: { errorToast: false },
    queryFn: async ({ signal }) => {
      const response = await api.get<{ success: boolean; data: string[] }>(
        '/api/option/qqbot/discovered-groups',
        { signal }
      )
      return requireServerSuccess(response.data).data
    },
  })
  const allowed = new Set(
    groups
      .split(',')
      .map((group) => group.trim())
      .filter(Boolean)
  )
  const options = (query.data ?? [])
    .filter((openID) => !allowed.has(openID))
    .map((openID) => ({ value: openID, label: openID }))
  const submitting = form.formState.isSubmitting
  const discoveredLabel = t('Select a discovered QQ group')
  let status: string | undefined
  if (!canDiscover) {
    status = t('Enable and save the QQ bot to discover groups.')
  } else if (open) {
    if (query.isPending) status = t('Loading...')
    else if (query.isError) status = t('Failed to load discovered QQ groups.')
    else if (options.length === 0) {
      status = t('Mention the bot in a QQ group to discover it.')
    }
  }

  return (
    <div className='grid gap-2'>
      <QQBotTextField
        name='groups'
        label={t('Allowed QQ group OpenIDs')}
        maxLength={8192}
        description={t('Separate group OpenIDs with commas.')}
      />
      <div className='flex flex-wrap items-center gap-2 sm:flex-nowrap'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={!canDiscover || query.isFetching || submitting}
          onClick={() => {
            if (open) void query.refetch()
            else setOpen(true)
          }}
        >
          {open ? t('Refresh') : t('Discover QQ groups')}
        </Button>
        {open && canDiscover && options.length > 0 && (
          <Combobox
            className='min-w-0 flex-1'
            aria-label={discoveredLabel}
            placeholder={discoveredLabel}
            options={options}
            disabled={submitting}
            onValueChange={(openID: string | null) => {
              if (!openID) return
              allowed.add(openID)
              form.setValue('groups', [...allowed].join(', '), {
                shouldDirty: true,
                shouldValidate: true,
              })
            }}
          />
        )}
      </div>
      {status && (
        <p className='text-muted-foreground text-xs' role='status'>
          {status}
        </p>
      )}
    </div>
  )
}
