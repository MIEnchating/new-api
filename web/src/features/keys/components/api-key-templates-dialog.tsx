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
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import { SmartRoutingSection } from '@/features/system-settings/models/smart-routing-section'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  getUserSmartRoutingTemplates,
  updateUserSmartRoutingTemplates,
} from '../api'

export function ApiKeyTemplatesDialog() {
  const { t } = useTranslation()
  const canManage = useAuthStore(
    (state) => state.auth.user?.role === ROLE.SUPER_ADMIN
  )
  if (canManage) {
    return (
      <Button
        variant='outline'
        size='sm'
        nativeButton={false}
        role='link'
        render={
          <Link
            to='/system-settings/models/$section'
            params={{ section: 'smart-routing' }}
          />
        }
      >
        {t('Routing templates')}
      </Button>
    )
  }
  return <UserApiKeyTemplatesDialog />
}

function UserApiKeyTemplatesDialog() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  const userID = useAuthStore((state) => state.auth.user?.id)
  const templates = useQuery({
    queryKey: ['token-smart-routing-templates', 'owned', userID],
    queryFn: async () =>
      requireServerSuccess(await getUserSmartRoutingTemplates()),
    enabled: open && userID !== undefined,
    staleTime: 0,
  })
  const updateTemplates = useMutation({
    mutationFn: async (value: string) => {
      const parsed = JSON.parse(value) as Parameters<
        typeof updateUserSmartRoutingTemplates
      >[0]
      return requireServerSuccess(await updateUserSmartRoutingTemplates(parsed))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['token-smart-routing-templates'],
      })
    },
  })
  const userTemplateData = templates.data?.data
  const userValues = useMemo(
    () => ({
      'smart_routing_setting.enabled': true,
      'smart_routing_setting.templates': JSON.stringify(
        userTemplateData?.templates ?? []
      ),
    }),
    [userTemplateData]
  )
  const query = templates
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
      footer={<div ref={setActions} />}
    >
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => query.refetch()} />}
      {open && query.isSuccess && (
        <SettingsPageProvider actionsContainer={actions}>
          <SmartRoutingSection
            defaultValues={userValues}
            saveTemplates={async (value) => {
              await updateTemplates.mutateAsync(value)
            }}
            isSaving={updateTemplates.isPending}
            showEnabled={false}
            showCopy
            userMode
            maxTemplates={userTemplateData?.max_user_templates ?? 10}
          />
        </SettingsPageProvider>
      )}
    </Dialog>
  )
}
