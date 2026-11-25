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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Form, FormField } from '@/components/ui/form'
import {
  SecureVerificationDialog,
  useSecureVerification,
} from '@/features/auth/secure-verification'
import { useStatus } from '@/hooks/use-status'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  SettingsForm,
  SettingsControlGroup,
  SettingsSwitchField,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import {
  qqBotSettingsSchema,
  type QQBotFormValues,
  type QQBotSettings,
} from './lib/qq-bot-settings'
import { QQBotChatFields, QQBotTextField } from './qq-bot-chat-fields'
import { QQBotGroupFields } from './qq-bot-group-fields'

const settingsPath = '/api/option/qqbot'
const queryKey = ['qq-bot-settings']
type SettingsResponse = { success: boolean; data: QQBotSettings }

export function QQBotSettingsSection() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await api.get<SettingsResponse>(settingsPath, { signal })
      return requireServerSuccess(response.data).data
    },
    refetchOnWindowFocus: false,
  })

  return (
    <SettingsSection title={t('QQ Bot')}>
      {query.isPending && <LoadingState />}
      {!query.data && query.isError && (
        <ErrorState
          title={t('Failed to load settings')}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && (
        <QQBotSettingsForm key={query.data.revision} settings={query.data} />
      )}
    </SettingsSection>
  )
}

function QQBotSettingsForm(props: { settings: QQBotSettings }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const verification = useSecureVerification()
  const { status } = useStatus()
  const serverAddress = status?.server_address
  const origin =
    typeof serverAddress === 'string' && serverAddress.startsWith('https://')
      ? serverAddress.replace(/\/+$/, '')
      : window.location.origin
  const callbackUrl = origin + props.settings.callback_path
  const form = useForm<QQBotFormValues>({
    resolver: zodResolver(qqBotSettingsSchema),
    defaultValues: {
      enabled: props.settings.enabled,
      app_id: props.settings.app_id,
      app_secret: '',
      groups: props.settings.groups,
      notify_groups: props.settings.notify_groups ?? '',
      site_url: props.settings.site_url,
      chat_model: props.settings.chat_model,
      chat_key: '',
      chat_source: props.settings.chat_source ?? 'disabled',
      chat_protocol: props.settings.chat_protocol ?? 'chat_completions',
      chat_base_url: props.settings.chat_base_url ?? '',
      chat_token_id: props.settings.chat_token_id ?? 0,
      chat_group: props.settings.chat_group ?? '',
    },
  })
  const save = useMutation({
    gcTime: 0,
    retry: false,
    meta: { errorToast: false },
    mutationFn: async (input: { values: QQBotFormValues; proof: string }) => {
      const response = await api.put<SettingsResponse>(
        settingsPath,
        { ...input.values, revision: props.settings.revision },
        { headers: { 'X-Security-Proof': input.proof } }
      )
      return requireServerSuccess(response.data).data
    },
  })
  const submit = form.handleSubmit(async (values) => {
    try {
      const proof = await verification.requestVerification({
        scope: 'qq_bot.settings.update',
        title: t('Verify to save QQ bot settings'),
      })
      if (!proof) return
      const updated = await save.mutateAsync({
        values,
        proof: proof.proof_token,
      })
      queryClient.setQueryData(queryKey, updated)
      toast.success(t('Settings updated successfully'))
    } catch (error) {
      handleServerError(error)
    } finally {
      save.reset()
    }
  })

  return (
    <Form {...form}>
      <SettingsForm onSubmit={submit} className='max-w-5xl'>
        <div className='grid items-start gap-4 xl:grid-cols-2'>
          <SettingsControlGroup className='min-w-0 space-y-4 p-4 sm:p-5'>
            <h3 className='text-sm font-semibold'>{t('QQ connection')}</h3>
            <FormField
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <SettingsSwitchField
                  controlId='enable-qq-bot'
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  label={t('Enable QQ Bot')}
                  disabled={form.formState.isSubmitting}
                  className='border-b pb-3'
                />
              )}
            />
            <div className='flex min-w-0 flex-col gap-1.5'>
              <span className='text-sm font-medium'>{t('Webhook URL')}</span>
              <div className='bg-background flex min-w-0 items-center gap-2 rounded-lg border py-1 pr-1 pl-2.5'>
                <code className='min-w-0 flex-1 text-xs break-all'>
                  {callbackUrl}
                </code>
                <CopyButton value={callbackUrl} />
              </div>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Register the HTTPS webhook in QQ Open Platform. Subscribe to GROUP_AT_MESSAGE_CREATE for group chat and C2C_MESSAGE_CREATE for private account commands.'
                )}
              </p>
            </div>
            <div className='grid items-start gap-3 sm:grid-cols-2'>
              <QQBotTextField
                name='app_id'
                label={t('QQ Bot App ID')}
                maxLength={128}
              />
              <QQBotTextField
                name='app_secret'
                label={t('QQ Bot App Secret')}
                maxLength={1024}
                secret
                configured={props.settings.app_secret_configured}
              />
            </div>
            <QQBotGroupFields settings={props.settings} />
            <QQBotTextField
              name='notify_groups'
              label={t('Channel notification QQ groups')}
              maxLength={2048}
              description={t(
                'Enter allowed group OpenIDs to receive channel fault and recovery notices. Leave blank to disable.'
              )}
            />
            <QQBotTextField
              name='site_url'
              label={t('Official website URL')}
              maxLength={2048}
              description={t('Link returned by the /site command.')}
              url
            />
          </SettingsControlGroup>
          <QQBotChatFields settings={props.settings} />
        </div>
        <SettingsPageFormActions
          onSave={() => void submit()}
          onReset={() => form.reset()}
          isSaving={form.formState.isSubmitting}
          isSaveDisabled={!form.formState.isDirty}
          isResetDisabled={!form.formState.isDirty}
        />
      </SettingsForm>
      <SecureVerificationDialog {...verification.dialogProps} />
    </Form>
  )
}
