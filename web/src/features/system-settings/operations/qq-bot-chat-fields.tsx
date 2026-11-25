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
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { ComboboxInput } from '@/components/ui/combobox-input'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { getApiKey, getApiKeys } from '@/features/keys/api'
import { API_KEY_STATUS } from '@/features/keys/constants'
import { api } from '@/lib/api'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { SettingsControlGroup } from '../components/settings-form-layout'
import type { QQBotFormValues, QQBotSettings } from './lib/qq-bot-settings'

type TextFieldName =
  | 'app_id'
  | 'app_secret'
  | 'groups'
  | 'notify_groups'
  | 'site_url'
  | 'chat_base_url'
  | 'chat_key'
  | 'chat_model'

export function QQBotTextField(props: {
  name: TextFieldName
  label: string
  maxLength: number
  description?: string
  placeholder?: string
  secret?: boolean
  configured?: boolean
  url?: boolean
}) {
  const { t } = useTranslation()
  const form = useFormContext<QQBotFormValues>()
  return (
    <FormField
      control={form.control}
      name={props.name}
      render={({ field }) => (
        <FormItem className='content-start'>
          <FormLabel>{props.label}</FormLabel>
          <FormControl>
            {props.secret ? (
              <PasswordInput
                {...field}
                autoComplete='new-password'
                maxLength={props.maxLength}
                placeholder={props.configured ? t('Configured') : undefined}
                disabled={form.formState.isSubmitting}
              />
            ) : (
              <Input
                {...field}
                type={props.url ? 'url' : 'text'}
                maxLength={props.maxLength}
                placeholder={props.placeholder}
                disabled={form.formState.isSubmitting}
              />
            )}
          </FormControl>
          {props.description && (
            <FormDescription>{props.description}</FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function QQBotChatFields(props: { settings: QQBotSettings }) {
  const { t } = useTranslation()
  const form = useFormContext<QQBotFormValues>()
  const source = useWatch({ control: form.control, name: 'chat_source' })
  const submitting = form.formState.isSubmitting
  const change = { shouldDirty: true }
  const sources = {
    disabled: t('Disabled'),
    builtin: t('Built-in'),
    external: t('External'),
  }
  const protocols = {
    chat_completions: t('OpenAI Chat Completions'),
    responses: t('OpenAI Responses'),
    messages: t('Anthropic Messages'),
  }
  return (
    <SettingsControlGroup className='h-fit space-y-4 p-4 sm:p-5'>
      <h3 className='text-sm font-semibold'>{t('AI Chat')}</h3>
      <FormField
        control={form.control}
        name='chat_source'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Chat connection')}</FormLabel>
            <FormControl>
              <ToggleGroup
                value={[field.value]}
                disabled={submitting}
                size='sm'
                variant='outline'
                onValueChange={(values) => {
                  const next = values[0] as
                    | QQBotFormValues['chat_source']
                    | undefined
                  if (!next || next === field.value) return
                  field.onChange(next)
                  form.setValue('chat_token_id', 0, change)
                  form.setValue('chat_group', '', change)
                  form.setValue('chat_model', '', change)
                  form.setValue('chat_base_url', '', change)
                  form.setValue('chat_key', '', change)
                }}
              >
                {Object.entries(sources).map(([value, label]) => (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    className='aria-pressed:bg-primary/10 aria-pressed:text-primary aria-pressed:font-semibold'
                  >
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FormControl>
          </FormItem>
        )}
      />
      {source !== 'disabled' && (
        <FormField
          control={form.control}
          name='chat_protocol'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('API protocol')}</FormLabel>
              <Select
                value={field.value}
                disabled={submitting}
                onValueChange={(value) => {
                  if (!value || value === field.value) return
                  field.onChange(value)
                  if (
                    source === 'builtin' &&
                    form.getValues('chat_token_id') > 0
                  ) {
                    form.setValue('chat_model', '', change)
                  }
                }}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue>{protocols[field.value]}</SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(protocols).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
      )}
      {source === 'builtin' && <QQBotBuiltinFields settings={props.settings} />}
      {source === 'external' && (
        <QQBotExternalFields settings={props.settings} />
      )}
    </SettingsControlGroup>
  )
}

type ExternalModelRequest = Pick<
  QQBotFormValues,
  'chat_base_url' | 'chat_key' | 'chat_protocol'
>

function QQBotExternalFields(props: { settings: QQBotSettings }) {
  const { t } = useTranslation()
  const form = useFormContext<QQBotFormValues>()
  const [baseURL, key, protocol] = useWatch({
    control: form.control,
    name: ['chat_base_url', 'chat_key', 'chat_protocol'],
  })
  const input: ExternalModelRequest = {
    chat_base_url: baseURL.trim().replace(/\/+$/, ''),
    chat_key: key.trim(),
    chat_protocol: protocol,
  }
  const savedKey =
    props.settings.chat_key_configured &&
    input.chat_base_url === props.settings.chat_base_url
  const fetchModels = useMutation({
    gcTime: 0,
    retry: false,
    meta: { errorToast: false },
    mutationFn: async (request: ExternalModelRequest) => {
      const response = await api.post<{ success: boolean; data: string[] }>(
        '/api/option/qqbot/external-models',
        request
      )
      return requireServerSuccess(response.data).data
    },
  })
  const last = fetchModels.variables
  const isCurrent =
    last?.chat_base_url === input.chat_base_url &&
    last.chat_key === input.chat_key &&
    last.chat_protocol === input.chat_protocol
  const models = isCurrent ? (fetchModels.data ?? []) : []
  const submitting = form.formState.isSubmitting
  let status: string | undefined
  if (fetchModels.isPending) {
    status = t('Fetching models...')
  } else if (last && !isCurrent) {
    status = t(
      'Connection settings changed. Fetch models again to refresh the list.'
    )
  } else if (fetchModels.isError) {
    status = getServerErrorMessage(
      fetchModels.error,
      t('Failed to fetch models')
    )
  } else if (fetchModels.isSuccess && models.length === 0) {
    status = t('No models returned by the upstream')
  }

  return (
    <>
      <QQBotTextField
        name='chat_base_url'
        label={t('API Base URL')}
        maxLength={2048}
        placeholder='https://api.example.com/v1'
        url
      />
      <QQBotTextField
        name='chat_key'
        label={t('API Key')}
        maxLength={1024}
        secret
        configured={savedKey}
        description={t(
          'All allowed QQ groups use this key. Set a spending limit with the external provider before enabling chat.'
        )}
      />
      <FormField
        control={form.control}
        name='chat_model'
        render={({ field }) => (
          <FormItem>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <FormLabel>{t('Model')}</FormLabel>
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={
                  submitting ||
                  fetchModels.isPending ||
                  !input.chat_base_url.startsWith('https://') ||
                  (!input.chat_key && !savedKey)
                }
                onClick={() => fetchModels.mutate(input)}
              >
                {t('Fetch Models')}
              </Button>
            </div>
            <FormControl>
              {models.length > 0 ? (
                <ComboboxInput
                  value={field.value}
                  onValueChange={field.onChange}
                  options={models.map((name) => ({ value: name, label: name }))}
                  placeholder={t('Select Model')}
                  maxLength={256}
                  allowCustomValue
                  disabled={submitting}
                />
              ) : (
                <Input {...field} maxLength={256} disabled={submitting} />
              )}
            </FormControl>
            <FormMessage />
            {status && (
              <FormDescription role='status'>{status}</FormDescription>
            )}
          </FormItem>
        )}
      />
    </>
  )
}

const keyPageSize = 100

function QQBotBuiltinFields(props: { settings: QQBotSettings }) {
  const { t } = useTranslation()
  const form = useFormContext<QQBotFormValues>()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const [tokenID, group, protocol] = useWatch({
    control: form.control,
    name: ['chat_token_id', 'chat_group', 'chat_protocol'],
  })
  const keys = useInfiniteQuery({
    queryKey: ['qq-bot-api-keys', userID],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      requireServerSuccess(
        await getApiKeys({ p: pageParam, size: keyPageSize })
      ).data,
    getNextPageParam: (last, _pages, page) =>
      last && page * (last.page_size || keyPageSize) < last.total
        ? page + 1
        : undefined,
  })
  const items = keys.data?.pages.flatMap((page) => page?.items ?? []) ?? []
  const selected = useQuery({
    queryKey: ['qq-bot-api-key', userID, tokenID],
    queryFn: async () => requireServerSuccess(await getApiKey(tokenID)).data,
    enabled: tokenID > 0 && !items.some((key) => key.id === tokenID),
  })
  const options = useQuery({
    queryKey: ['qq-bot-chat-options', userID, tokenID, group, protocol],
    enabled: tokenID > 0,
    queryFn: async ({ signal }) => {
      const response = await api.get<{
        success: boolean
        data: { groups: string[]; models: string[] }
      }>('/api/option/qqbot/chat-options', {
        signal,
        params: { token_id: tokenID, group, protocol },
      })
      return requireServerSuccess(response.data).data
    },
  })
  if (selected.data && !items.some((key) => key.id === selected.data?.id)) {
    items.unshift(selected.data)
  }
  const keyOptions = items
    .filter(
      (key) => key.status === API_KEY_STATUS.ENABLED || key.id === tokenID
    )
    .map((key) => ({ value: String(key.id), label: key.name }))
  const groupOptions = (options.data?.groups ?? []).map((name) => ({
    value: name,
    label: name,
  }))
  const modelOptions = (options.data?.models ?? []).map((name) => ({
    value: name,
    label: name,
  }))
  const submitting = form.formState.isSubmitting
  return (
    <>
      <FormField
        control={form.control}
        name='chat_token_id'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('API Key')}</FormLabel>
            <FormControl>
              <Combobox
                value={field.value ? String(field.value) : ''}
                options={keyOptions}
                disabled={submitting || keys.isPending}
                placeholder={t('Select API Key')}
                onValueChange={(value) => {
                  const id = Number(value)
                  if (!id || id === field.value) return
                  field.onChange(id)
                  form.setValue('chat_group', '', { shouldDirty: true })
                  form.setValue('chat_model', '', { shouldDirty: true })
                }}
              />
            </FormControl>
            <FormDescription>
              {t(
                'All allowed QQ groups use this key. Choose a dedicated API key with a quota to limit their combined usage.'
              )}
            </FormDescription>
            {keys.hasNextPage && (
              <Button
                type='button'
                variant='link'
                size='sm'
                className='w-fit px-0'
                disabled={keys.isFetchingNextPage}
                onClick={() => void keys.fetchNextPage()}
              >
                {t('Load more')}
              </Button>
            )}
            {props.settings.legacy_chat_key &&
              !tokenID &&
              form.getValues('chat_model') && (
                <FormDescription>
                  {t(
                    'The previously configured key is active until you select a replacement.'
                  )}
                </FormDescription>
              )}
            <FormMessage />
          </FormItem>
        )}
      />
      <div className='grid items-start gap-3 sm:grid-cols-2'>
        <FormField
          control={form.control}
          name='chat_group'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Group')}</FormLabel>
              <FormControl>
                <Combobox
                  value={field.value}
                  options={groupOptions}
                  disabled={submitting || !tokenID || options.isFetching}
                  placeholder={t('Select group')}
                  onValueChange={(value) => {
                    if (!value || value === field.value) return
                    field.onChange(value)
                    form.setValue('chat_model', '', { shouldDirty: true })
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='chat_model'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Model')}</FormLabel>
              <FormControl>
                <Combobox
                  value={field.value}
                  options={modelOptions}
                  disabled={submitting || !group || options.isFetching}
                  placeholder={t('Select model')}
                  onValueChange={(value) => field.onChange(value ?? '')}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </>
  )
}
