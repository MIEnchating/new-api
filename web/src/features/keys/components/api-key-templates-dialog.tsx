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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { getSystemOptions } from '@/features/system-settings/api'
import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import { getOptionValue } from '@/features/system-settings/hooks/use-system-options'
import { SmartRoutingSection } from '@/features/system-settings/models/smart-routing-section'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getSmartRoutingTemplates } from '../api'
import { TemplateKeysCopyButton } from './template-keys-copy-button'

const defaults = {
  'smart_routing_setting.enabled': false,
  'smart_routing_setting.templates': '[]',
}

export function ApiKeyTemplatesDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  const canManage = useAuthStore(
    (state) => state.auth.user?.role === ROLE.SUPER_ADMIN
  )
  const options = useQuery({
    queryKey: ['system-options'],
    queryFn: async () => requireServerSuccess(await getSystemOptions()),
    enabled: open && canManage,
    staleTime: 0,
  })
  const templates = useQuery({
    queryKey: ['token-smart-routing-templates'],
    queryFn: async () => requireServerSuccess(await getSmartRoutingTemplates()),
    enabled: open && !canManage,
    staleTime: 0,
  })
  const values = useMemo(
    () => getOptionValue(options.data?.data, defaults),
    [options.data]
  )
  const query = canManage ? options : templates
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('Routing templates')}
      description={t(
        'Template changes automatically apply to linked keys. Select custom routing to detach.'
      )}
      trigger={
        <Button variant='outline' size='sm'>
          {t('Routing templates')}
        </Button>
      }
      contentClassName='sm:max-w-4xl'
      footer={canManage ? <div ref={setActions} /> : undefined}
    >
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => query.refetch()} />}
      {open && query.isSuccess && canManage && (
        <SettingsPageProvider actionsContainer={actions}>
          <SmartRoutingSection defaultValues={values} />
        </SettingsPageProvider>
      )}
      {open && query.isSuccess && !canManage && (
        <div className='space-y-3'>
          {(templates.data?.data || []).map((template) => (
            <div
              key={template.id}
              className='flex flex-wrap items-center justify-between gap-3 rounded-md border p-3'
            >
              <div className='min-w-0 break-words'>
                <p className='font-medium'>{template.name}</p>
                <p className='text-muted-foreground text-sm'>
                  {template.description}
                </p>
                <p className='text-muted-foreground text-xs'>
                  {template.group_routes
                    .filter((route) => route.enabled !== false)
                    .map((route) => route.group)
                    .join(' → ')}
                </p>
              </div>
              <TemplateKeysCopyButton templateID={template.id} />
            </div>
          ))}
          {!templates.data?.data?.length && <p>{t('No routing templates')}</p>}
        </div>
      )}
    </Dialog>
  )
}
