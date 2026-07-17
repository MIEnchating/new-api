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
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
import {
  Form,
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { parseHttpStatusCodeRules } from '@/lib/http-status-code-rules'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

const numericString = z.string().refine((value) => {
  const trimmed = value.trim()
  if (!trimmed) return true
  return !Number.isNaN(Number(trimmed)) && Number(trimmed) >= 0
}, 'Enter a non-negative number or leave empty')

const channelTestModes = ['scheduled_all', 'passive_recovery'] as const
type ChannelTestMode = (typeof channelTestModes)[number]

const errorResponseMatchModes = ['any', 'all'] as const
type ErrorResponseMatchMode = (typeof errorResponseMatchModes)[number]

const customErrorResponseRuleSchema = z.object({
  enabled: z.boolean(),
  match_mode: z.enum(errorResponseMatchModes),
  status_codes: z.string(),
  message_contains: z.string(),
  response_status_code: z.coerce.number().int().min(0).max(599),
  response_message: z.string(),
  pass_through_status_code: z.boolean(),
  pass_through_message: z.boolean(),
})

const routingReliabilitySchema = z
  .object({
    RetryTimes: z.coerce.number().min(0).max(10),
    ChannelRouteCooldownEnabled: z.boolean(),
    ChannelRouteCooldownSeconds: z.coerce
      .number()
      .int()
      .min(0)
      .max(31536000, 'Cooldown cannot exceed 31536000 seconds'),
    ChannelRouteStickyEnabled: z.boolean(),
    ChannelRouteSameChannelRetries: z.coerce.number().int().min(0).max(10),
    ChannelDisableThreshold: numericString,
    AutomaticDisableChannelEnabled: z.boolean(),
    AutomaticEnableChannelEnabled: z.boolean(),
    AutomaticDisableKeywords: z.string(),
    AutomaticDisableStatusCodes: z.string(),
    AutomaticRetryStatusCodes: z.string(),
    monitor_setting: z.object({
      auto_test_channel_enabled: z.boolean(),
      auto_test_channel_minutes: z.coerce
        .number()
        .int()
        .min(1, 'Interval must be at least 1 minute'),
      channel_test_mode: z.enum(channelTestModes),
    }),
    error_response_setting: z.object({
      enabled: z.boolean(),
      rules: z.array(customErrorResponseRuleSchema),
    }),
  })
  .superRefine((values, ctx) => {
    const disableParsed = parseHttpStatusCodeRules(
      values.AutomaticDisableStatusCodes
    )
    if (!disableParsed.ok) {
      ctx.addIssue({
        code: 'custom',
        path: ['AutomaticDisableStatusCodes'],
        message: `Invalid status code rules: ${disableParsed.invalidTokens.join(
          ', '
        )}`,
      })
    }

    const retryParsed = parseHttpStatusCodeRules(
      values.AutomaticRetryStatusCodes
    )
    if (!retryParsed.ok) {
      ctx.addIssue({
        code: 'custom',
        path: ['AutomaticRetryStatusCodes'],
        message: `Invalid status code rules: ${retryParsed.invalidTokens.join(
          ', '
        )}`,
      })
    }

    if (
      values.ChannelRouteCooldownEnabled &&
      values.ChannelRouteCooldownSeconds <= 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['ChannelRouteCooldownSeconds'],
        message: 'Cooldown must be greater than 0 seconds',
      })
    }

    values.error_response_setting.rules.forEach((rule, index) => {
      if (!rule.enabled) return

      const hasStatusCondition = rule.status_codes.trim() !== ''
      const hasMessageCondition = rule.message_contains.trim() !== ''
      if (!hasStatusCondition && !hasMessageCondition) {
        ctx.addIssue({
          code: 'custom',
          path: ['error_response_setting', 'rules', index, 'status_codes'],
          message: 'Set at least one match condition',
        })
      }

      if (hasStatusCondition) {
        const parsed = parseHttpStatusCodeRules(rule.status_codes)
        if (!parsed.ok) {
          ctx.addIssue({
            code: 'custom',
            path: ['error_response_setting', 'rules', index, 'status_codes'],
            message: 'Invalid status code rules',
          })
        }
      }

      if (
        !rule.pass_through_status_code &&
        (rule.response_status_code < 100 || rule.response_status_code > 599)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: [
            'error_response_setting',
            'rules',
            index,
            'response_status_code',
          ],
          message:
            'Set a 100-599 status code or enable upstream status pass-through',
        })
      }

      if (!rule.pass_through_message && rule.response_message.trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['error_response_setting', 'rules', index, 'response_message'],
          message:
            'Set a response message or enable upstream message pass-through',
        })
      }
    })
  })

type RoutingReliabilityFormValues = z.output<typeof routingReliabilitySchema>
type RoutingReliabilityFormInput = z.input<typeof routingReliabilitySchema>
type CustomErrorResponseRuleFormValues = z.output<
  typeof customErrorResponseRuleSchema
>

type RoutingReliabilitySectionProps = {
  view?: 'routing' | 'custom-errors'
  defaultValues: {
    RetryTimes: number
    ChannelRouteCooldownEnabled: boolean
    ChannelRouteCooldownSeconds: number
    ChannelRouteStickyEnabled: boolean
    ChannelRouteSameChannelRetries: number
    ChannelDisableThreshold: string
    AutomaticDisableChannelEnabled: boolean
    AutomaticEnableChannelEnabled: boolean
    AutomaticDisableKeywords: string
    AutomaticDisableStatusCodes: string
    AutomaticRetryStatusCodes: string
    'monitor_setting.auto_test_channel_enabled': boolean
    'monitor_setting.auto_test_channel_minutes': number
    'monitor_setting.channel_test_mode': ChannelTestMode
    'error_response_setting.enabled': boolean
    'error_response_setting.rules': string
  }
}

function normalizeLineEndings(value: string) {
  return value.replaceAll('\r\n', '\n')
}

function normalizeErrorResponseMatchMode(
  value: unknown
): ErrorResponseMatchMode {
  return value === 'all' ? 'all' : 'any'
}

function parseCustomErrorResponseRules(
  value: string
): CustomErrorResponseRuleFormValues[] {
  const raw = (value ?? '').toString().trim()
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.map((item) => {
      const record =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : {}
      const responseStatusCode = Number(record.response_status_code)

      return {
        enabled: record.enabled === true,
        match_mode: normalizeErrorResponseMatchMode(record.match_mode),
        status_codes:
          typeof record.status_codes === 'string' ? record.status_codes : '',
        message_contains:
          typeof record.message_contains === 'string'
            ? record.message_contains
            : '',
        response_status_code:
          Number.isInteger(responseStatusCode) &&
          responseStatusCode >= 100 &&
          responseStatusCode <= 599
            ? responseStatusCode
            : 500,
        response_message:
          typeof record.response_message === 'string'
            ? record.response_message
            : '',
        pass_through_status_code: record.pass_through_status_code === true,
        pass_through_message: record.pass_through_message === true,
      }
    })
  } catch {
    return []
  }
}

function normalizeCustomErrorResponseRules(
  rules: CustomErrorResponseRuleFormValues[]
) {
  return JSON.stringify(
    rules.map((rule) => ({
      enabled: rule.enabled,
      match_mode: normalizeErrorResponseMatchMode(rule.match_mode),
      status_codes: parseHttpStatusCodeRules(rule.status_codes).normalized,
      message_contains: rule.message_contains.trim(),
      response_status_code: rule.response_status_code,
      response_message: rule.response_message.trim(),
      pass_through_status_code: rule.pass_through_status_code,
      pass_through_message: rule.pass_through_message,
    })),
    null,
    2
  )
}

type NormalizedRoutingReliabilityValues = {
  RetryTimes: number
  ChannelRouteCooldownEnabled: boolean
  ChannelRouteCooldownSeconds: number
  ChannelRouteStickyEnabled: boolean
  ChannelRouteSameChannelRetries: number
  ChannelDisableThreshold: string
  AutomaticDisableChannelEnabled: boolean
  AutomaticEnableChannelEnabled: boolean
  AutomaticDisableKeywords: string
  AutomaticDisableStatusCodes: string
  AutomaticRetryStatusCodes: string
  'monitor_setting.auto_test_channel_enabled': boolean
  'monitor_setting.auto_test_channel_minutes': number
  'monitor_setting.channel_test_mode': ChannelTestMode
  'error_response_setting.enabled': boolean
  'error_response_setting.rules': string
}

function normalizeChannelTestMode(value?: string): ChannelTestMode {
  return value === 'passive_recovery' ? 'passive_recovery' : 'scheduled_all'
}

const buildFormDefaults = (
  defaults: RoutingReliabilitySectionProps['defaultValues']
): RoutingReliabilityFormInput => ({
  RetryTimes: defaults.ChannelRouteCooldownEnabled
    ? 0
    : (defaults.RetryTimes ?? 0),
  ChannelRouteCooldownEnabled: defaults.ChannelRouteCooldownEnabled,
  ChannelRouteCooldownSeconds: defaults.ChannelRouteCooldownSeconds ?? 60,
  ChannelRouteStickyEnabled: defaults.ChannelRouteStickyEnabled,
  ChannelRouteSameChannelRetries: defaults.ChannelRouteSameChannelRetries ?? 0,
  ChannelDisableThreshold: defaults.ChannelDisableThreshold ?? '',
  AutomaticDisableChannelEnabled: defaults.AutomaticDisableChannelEnabled,
  AutomaticEnableChannelEnabled: defaults.AutomaticEnableChannelEnabled,
  AutomaticDisableKeywords: normalizeLineEndings(
    defaults.AutomaticDisableKeywords ?? ''
  ),
  AutomaticDisableStatusCodes: defaults.AutomaticDisableStatusCodes ?? '',
  AutomaticRetryStatusCodes: defaults.AutomaticRetryStatusCodes ?? '',
  monitor_setting: {
    auto_test_channel_enabled:
      defaults['monitor_setting.auto_test_channel_enabled'],
    auto_test_channel_minutes:
      defaults['monitor_setting.auto_test_channel_minutes'],
    channel_test_mode: normalizeChannelTestMode(
      defaults['monitor_setting.channel_test_mode']
    ),
  },
  error_response_setting: {
    enabled: defaults['error_response_setting.enabled'],
    rules: parseCustomErrorResponseRules(
      defaults['error_response_setting.rules']
    ),
  },
})

const normalizeDefaults = (
  defaults: RoutingReliabilitySectionProps['defaultValues']
): NormalizedRoutingReliabilityValues => ({
  RetryTimes: defaults.RetryTimes ?? 0,
  ChannelRouteCooldownEnabled: defaults.ChannelRouteCooldownEnabled,
  ChannelRouteCooldownSeconds: defaults.ChannelRouteCooldownSeconds ?? 60,
  ChannelRouteStickyEnabled: defaults.ChannelRouteStickyEnabled,
  ChannelRouteSameChannelRetries: defaults.ChannelRouteSameChannelRetries ?? 0,
  ChannelDisableThreshold: (defaults.ChannelDisableThreshold ?? '').trim(),
  AutomaticDisableChannelEnabled: defaults.AutomaticDisableChannelEnabled,
  AutomaticEnableChannelEnabled: defaults.AutomaticEnableChannelEnabled,
  AutomaticDisableKeywords: normalizeLineEndings(
    defaults.AutomaticDisableKeywords ?? ''
  ),
  AutomaticDisableStatusCodes: parseHttpStatusCodeRules(
    defaults.AutomaticDisableStatusCodes ?? ''
  ).normalized,
  AutomaticRetryStatusCodes: parseHttpStatusCodeRules(
    defaults.AutomaticRetryStatusCodes ?? ''
  ).normalized,
  'monitor_setting.auto_test_channel_enabled':
    defaults['monitor_setting.auto_test_channel_enabled'],
  'monitor_setting.auto_test_channel_minutes':
    defaults['monitor_setting.auto_test_channel_minutes'],
  'monitor_setting.channel_test_mode': normalizeChannelTestMode(
    defaults['monitor_setting.channel_test_mode']
  ),
  'error_response_setting.enabled': defaults['error_response_setting.enabled'],
  'error_response_setting.rules': normalizeCustomErrorResponseRules(
    parseCustomErrorResponseRules(defaults['error_response_setting.rules'])
  ),
})

const normalizeFormValues = (
  values: RoutingReliabilityFormValues
): NormalizedRoutingReliabilityValues => ({
  RetryTimes: values.ChannelRouteCooldownEnabled ? 0 : values.RetryTimes,
  ChannelRouteCooldownEnabled: values.ChannelRouteCooldownEnabled,
  ChannelRouteCooldownSeconds: values.ChannelRouteCooldownSeconds,
  ChannelRouteStickyEnabled: values.ChannelRouteStickyEnabled,
  ChannelRouteSameChannelRetries: values.ChannelRouteSameChannelRetries,
  ChannelDisableThreshold: values.ChannelDisableThreshold.trim(),
  AutomaticDisableChannelEnabled: values.AutomaticDisableChannelEnabled,
  AutomaticEnableChannelEnabled: values.AutomaticEnableChannelEnabled,
  AutomaticDisableKeywords: normalizeLineEndings(
    values.AutomaticDisableKeywords
  ),
  AutomaticDisableStatusCodes: parseHttpStatusCodeRules(
    values.AutomaticDisableStatusCodes
  ).normalized,
  AutomaticRetryStatusCodes: parseHttpStatusCodeRules(
    values.AutomaticRetryStatusCodes
  ).normalized,
  'monitor_setting.auto_test_channel_enabled':
    values.monitor_setting.auto_test_channel_enabled,
  'monitor_setting.auto_test_channel_minutes':
    values.monitor_setting.auto_test_channel_minutes,
  'monitor_setting.channel_test_mode': values.monitor_setting.channel_test_mode,
  'error_response_setting.enabled': values.error_response_setting.enabled,
  'error_response_setting.rules': normalizeCustomErrorResponseRules(
    values.error_response_setting.rules
  ),
})

export function RoutingReliabilitySection({
  defaultValues,
  view = 'routing',
}: RoutingReliabilitySectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const baselineRef = useRef<NormalizedRoutingReliabilityValues>(
    normalizeDefaults(defaultValues)
  )

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )

  const form = useForm<
    RoutingReliabilityFormInput,
    unknown,
    RoutingReliabilityFormValues
  >({
    resolver: zodResolver(routingReliabilitySchema),
    defaultValues: formDefaults,
  })
  const errorRuleFields = useFieldArray({
    control: form.control,
    name: 'error_response_setting.rules',
  })

  useResetForm(form, formDefaults)

  const autoDisableStatusCodes = form.watch('AutomaticDisableStatusCodes')
  const autoRetryStatusCodes = form.watch('AutomaticRetryStatusCodes')
  const channelRouteCooldownEnabled = form.watch('ChannelRouteCooldownEnabled')
  const channelTestMode = form.watch('monitor_setting.channel_test_mode')
  const customErrorResponsesEnabled = form.watch(
    'error_response_setting.enabled'
  )
  const autoDisableParsed = useMemo(
    () => parseHttpStatusCodeRules(autoDisableStatusCodes),
    [autoDisableStatusCodes]
  )
  const autoRetryParsed = useMemo(
    () => parseHttpStatusCodeRules(autoRetryStatusCodes),
    [autoRetryStatusCodes]
  )

  const onSubmit = async (values: RoutingReliabilityFormValues) => {
    const normalized = normalizeFormValues(values)
    const updates = (
      Object.keys(normalized) as Array<keyof NormalizedRoutingReliabilityValues>
    ).filter((key) => normalized[key] !== baselineRef.current[key])

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of updates) {
      const value = normalized[key]
      await updateOption.mutateAsync({
        key,
        value,
      })
    }

    baselineRef.current = normalized
  }

  return (
    <SettingsSection
      title={t(
        view === 'custom-errors'
          ? 'Custom error responses'
          : 'Routing Reliability'
      )}
    >
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />

          {view === 'routing' ? (
            <>
              <div className='flex min-w-0 flex-col gap-4'>
                <div className='flex flex-col gap-1'>
                  <h4 className='text-sm font-medium'>{t('Request retry')}</h4>
                </div>
                <div className='grid min-w-0 gap-6 xl:grid-cols-[minmax(12rem,24rem)_minmax(0,1fr)]'>
                  <FormField
                    control={form.control}
                    name='RetryTimes'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Retry Times')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min='0'
                            max='10'
                            disabled={channelRouteCooldownEnabled}
                            {...safeNumberFieldProps(field)}
                          />
                        </FormControl>
                        <FormDescription>
                          {channelRouteCooldownEnabled
                            ? t(
                                'Request retry is disabled while channel routing is enabled'
                              )
                            : t(
                                'Number of times to retry failed requests (0-10)'
                              )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='AutomaticRetryStatusCodes'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {channelRouteCooldownEnabled
                            ? t('Route failover status codes')
                            : t('Auto-retry status codes')}
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('e.g. 401, 403, 429, 500-599')}
                            value={field.value}
                            onChange={(event) =>
                              field.onChange(event.target.value)
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Accepts comma-separated status codes and inclusive ranges.'
                          )}{' '}
                          {autoRetryParsed.ok &&
                            autoRetryParsed.normalized &&
                            autoRetryParsed.normalized !==
                              field.value.trim() && (
                              <span className='text-muted-foreground'>
                                {t('Normalized:')} {autoRetryParsed.normalized}
                              </span>
                            )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className='flex flex-col gap-1 pt-2'>
                  <h4 className='text-sm font-medium'>
                    {t('Channel routing')}
                  </h4>
                </div>
                <div className='grid min-w-0 gap-6 lg:grid-cols-2 2xl:grid-cols-4'>
                  <FormField
                    control={form.control}
                    name='ChannelRouteCooldownEnabled'
                    render={({ field }) => (
                      <SettingsSwitchItem>
                        <SettingsSwitchContent>
                          <FormLabel>{t('Channel routing')}</FormLabel>
                          <FormDescription>
                            {t(
                              'Tries available channels in the same group from highest priority to lowest; standard request retries are disabled, while same-channel retries are configured separately'
                            )}
                          </FormDescription>
                        </SettingsSwitchContent>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={(checked) => {
                              field.onChange(checked)
                              if (checked) {
                                form.setValue('RetryTimes', 0, {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                })
                              }
                            }}
                          />
                        </FormControl>
                      </SettingsSwitchItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='ChannelRouteSameChannelRetries'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Same-channel retries')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            max={10}
                            step={1}
                            disabled={!channelRouteCooldownEnabled}
                            {...safeNumberFieldProps(field)}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Number of retries on the current channel before switching channels (0 disables)'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='ChannelRouteStickyEnabled'
                    render={({ field }) => (
                      <SettingsSwitchItem>
                        <SettingsSwitchContent>
                          <FormLabel>{t('Channel route stickiness')}</FormLabel>
                          <FormDescription>
                            {t(
                              'Keep using the last successful routed channel until it fails'
                            )}
                          </FormDescription>
                        </SettingsSwitchContent>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            disabled={!channelRouteCooldownEnabled}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </SettingsSwitchItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='ChannelRouteCooldownSeconds'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Cooldown time (seconds)')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            max={31536000}
                            step={1}
                            disabled={!channelRouteCooldownEnabled}
                            {...safeNumberFieldProps(field)}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'How long a failed routed channel stays out of selection before it is tried again'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <Separator />

              <div className='flex min-w-0 flex-col gap-4'>
                <div className='flex flex-col gap-1'>
                  <h4 className='text-sm font-medium'>
                    {t('Channel health checks')}
                  </h4>
                </div>
                <div className='grid min-w-0 gap-6 lg:grid-cols-3'>
                  <FormField
                    control={form.control}
                    name='monitor_setting.auto_test_channel_enabled'
                    render={({ field }) => (
                      <SettingsSwitchItem>
                        <SettingsSwitchContent>
                          <FormLabel>{t('Scheduled channel tests')}</FormLabel>
                          <FormDescription>
                            {t(
                              'Automatically probe all channels in the background'
                            )}
                          </FormDescription>
                        </SettingsSwitchContent>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </SettingsSwitchItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='monitor_setting.channel_test_mode'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Channel test mode')}</FormLabel>
                        <Select
                          items={[
                            {
                              value: 'scheduled_all',
                              label: t('Scheduled full test'),
                            },
                            {
                              value: 'passive_recovery',
                              label: t('Passive recovery only'),
                            },
                          ]}
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectGroup>
                              <SelectItem value='scheduled_all'>
                                {t('Scheduled full test')}
                              </SelectItem>
                              <SelectItem value='passive_recovery'>
                                {t('Passive recovery only')}
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          {t(
                            'Scheduled full test probes non-manually-disabled channels; passive recovery only checks auto-disabled channels after real request failures.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='monitor_setting.auto_test_channel_minutes'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Test interval (minutes)')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={1}
                            step={1}
                            {...safeNumberFieldProps(field)}
                          />
                        </FormControl>
                        <FormDescription>
                          {channelTestMode === 'passive_recovery'
                            ? t(
                                'How frequently the system checks auto-disabled channels for recovery'
                              )
                            : t('How frequently the system tests all channels')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='AutomaticEnableChannelEnabled'
                    render={({ field }) => (
                      <SettingsSwitchItem>
                        <SettingsSwitchContent>
                          <FormLabel>{t('Re-enable on success')}</FormLabel>
                          <FormDescription>
                            {t(
                              'Bring channels back online after successful checks'
                            )}
                          </FormDescription>
                        </SettingsSwitchContent>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </SettingsSwitchItem>
                    )}
                  />
                </div>
              </div>

              <Separator />

              <div className='flex min-w-0 flex-col gap-4'>
                <div className='flex flex-col gap-1'>
                  <h4 className='text-sm font-medium'>
                    {t('Auto-disable rules')}
                  </h4>
                </div>
                <div className='grid min-w-0 gap-6 lg:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='AutomaticDisableChannelEnabled'
                    render={({ field }) => (
                      <SettingsSwitchItem>
                        <SettingsSwitchContent>
                          <FormLabel>{t('Disable on failure')}</FormLabel>
                          <FormDescription>
                            {t(
                              'Automatically disable channels when tests fail'
                            )}
                          </FormDescription>
                        </SettingsSwitchContent>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </SettingsSwitchItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='ChannelDisableThreshold'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t('Disable threshold (seconds)')}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            step={1}
                            value={field.value}
                            onChange={(event) =>
                              field.onChange(event.target.value)
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Automatically disable channels exceeding this response time'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='AutomaticDisableStatusCodes'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Auto-disable status codes')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('e.g. 401, 403, 429, 500-599')}
                            value={field.value}
                            onChange={(event) =>
                              field.onChange(event.target.value)
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Accepts comma-separated status codes and inclusive ranges.'
                          )}{' '}
                          {autoDisableParsed.ok &&
                            autoDisableParsed.normalized &&
                            autoDisableParsed.normalized !==
                              field.value.trim() && (
                              <span className='text-muted-foreground'>
                                {t('Normalized:')}{' '}
                                {autoDisableParsed.normalized}
                              </span>
                            )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='AutomaticDisableKeywords'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Failure keywords')}</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={6}
                            placeholder={t('one keyword per line')}
                            {...field}
                            onChange={(event) =>
                              field.onChange(event.target.value)
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'If an upstream error contains any of these keywords (case insensitive), the channel will be disabled automatically.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </>
          ) : null}

          {view === 'custom-errors' ? (
            <div className='flex min-w-0 flex-col gap-4'>
              <div className='flex flex-col gap-1'>
                <h4 className='text-sm font-medium'>
                  {t('Custom error responses')}
                </h4>
              </div>

              <FormField
                control={form.control}
                name='error_response_setting.enabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>
                        {t('Enable custom error responses')}
                      </FormLabel>
                      <FormDescription>
                        {t(
                          'Rewrite matched relay errors before returning them to users'
                        )}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </SettingsSwitchItem>
                )}
              />

              {customErrorResponsesEnabled ? (
                <div className='flex min-w-0 flex-col gap-3'>
                  {errorRuleFields.fields.length === 0 ? (
                    <div className='border-border/70 text-muted-foreground rounded-md border border-dashed p-4 text-sm'>
                      {t('No custom error response rules')}
                    </div>
                  ) : (
                    errorRuleFields.fields.map((ruleField, index) => {
                      const passThroughStatus = form.watch(
                        `error_response_setting.rules.${index}.pass_through_status_code`
                      )
                      const passThroughMessage = form.watch(
                        `error_response_setting.rules.${index}.pass_through_message`
                      )

                      return (
                        <div
                          key={ruleField.id}
                          className='border-border/70 grid min-w-0 gap-4 rounded-md border p-3'
                        >
                          <div className='flex min-w-0 items-center justify-between gap-3'>
                            <FormField
                              control={form.control}
                              name={
                                `error_response_setting.rules.${index}.enabled` as const
                              }
                              render={({ field }) => (
                                <SettingsSwitchItem className='flex-1 py-0'>
                                  <SettingsSwitchContent>
                                    <FormLabel>
                                      {t('Rule {{number}}', {
                                        number: index + 1,
                                      })}
                                    </FormLabel>
                                    <FormDescription>
                                      {t(
                                        'First matched enabled rule takes effect'
                                      )}
                                    </FormDescription>
                                  </SettingsSwitchContent>
                                  <FormControl>
                                    <Switch
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                    />
                                  </FormControl>
                                </SettingsSwitchItem>
                              )}
                            />

                            <Button
                              type='button'
                              variant='outline'
                              size='icon'
                              aria-label={t(
                                'Remove custom error response rule'
                              )}
                              onClick={() => errorRuleFields.remove(index)}
                            >
                              <Trash2 className='size-4' />
                            </Button>
                          </div>

                          <div className='grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-4'>
                            <FormField
                              control={form.control}
                              name={
                                `error_response_setting.rules.${index}.match_mode` as const
                              }
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('Match mode')}</FormLabel>
                                  <Select
                                    items={[
                                      {
                                        value: 'any',
                                        label: t('Any condition'),
                                      },
                                      {
                                        value: 'all',
                                        label: t('All conditions'),
                                      },
                                    ]}
                                    value={field.value}
                                    onValueChange={(value) =>
                                      field.onChange(
                                        normalizeErrorResponseMatchMode(value)
                                      )
                                    }
                                  >
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent alignItemWithTrigger={false}>
                                      <SelectGroup>
                                        <SelectItem value='any'>
                                          {t('Any condition')}
                                        </SelectItem>
                                        <SelectItem value='all'>
                                          {t('All conditions')}
                                        </SelectItem>
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name={
                                `error_response_setting.rules.${index}.status_codes` as const
                              }
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>
                                    {t('Match status codes')}
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder={t('e.g. 429, 500-599')}
                                      value={field.value}
                                      onChange={(event) =>
                                        field.onChange(event.target.value)
                                      }
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name={
                                `error_response_setting.rules.${index}.message_contains` as const
                              }
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>
                                    {t('Match error message')}
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder={t('e.g. rate limit')}
                                      value={field.value}
                                      onChange={(event) =>
                                        field.onChange(event.target.value)
                                      }
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name={
                                `error_response_setting.rules.${index}.response_status_code` as const
                              }
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>
                                    {t('Response status code')}
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      type='number'
                                      min={100}
                                      max={599}
                                      step={1}
                                      disabled={passThroughStatus}
                                      {...safeNumberFieldProps(field)}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>

                          <div className='grid min-w-0 gap-3 lg:grid-cols-2'>
                            <FormField
                              control={form.control}
                              name={
                                `error_response_setting.rules.${index}.pass_through_status_code` as const
                              }
                              render={({ field }) => (
                                <SettingsSwitchItem>
                                  <SettingsSwitchContent>
                                    <FormLabel>
                                      {t('Pass through upstream status')}
                                    </FormLabel>
                                    <FormDescription>
                                      {t(
                                        'Return the original upstream HTTP status code'
                                      )}
                                    </FormDescription>
                                  </SettingsSwitchContent>
                                  <FormControl>
                                    <Switch
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                    />
                                  </FormControl>
                                </SettingsSwitchItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name={
                                `error_response_setting.rules.${index}.pass_through_message` as const
                              }
                              render={({ field }) => (
                                <SettingsSwitchItem>
                                  <SettingsSwitchContent>
                                    <FormLabel>
                                      {t('Pass through upstream message')}
                                    </FormLabel>
                                    <FormDescription>
                                      {t(
                                        'Return the original upstream error message'
                                      )}
                                    </FormDescription>
                                  </SettingsSwitchContent>
                                  <FormControl>
                                    <Switch
                                      checked={field.value}
                                      onCheckedChange={field.onChange}
                                    />
                                  </FormControl>
                                </SettingsSwitchItem>
                              )}
                            />
                          </div>

                          <FormField
                            control={form.control}
                            name={
                              `error_response_setting.rules.${index}.response_message` as const
                            }
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t('Response message')}</FormLabel>
                                <FormControl>
                                  <Textarea
                                    rows={3}
                                    disabled={passThroughMessage}
                                    placeholder={t(
                                      'Upstream request failed. Please try again later.'
                                    )}
                                    {...field}
                                    onChange={(event) =>
                                      field.onChange(event.target.value)
                                    }
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      )
                    })
                  )}

                  <Button
                    type='button'
                    variant='outline'
                    className='w-full justify-center gap-2'
                    onClick={() =>
                      errorRuleFields.append({
                        enabled: true,
                        match_mode: 'any',
                        status_codes: '429,500-599',
                        message_contains: '',
                        response_status_code: 429,
                        response_message: t(
                          'Upstream request failed. Please try again later.'
                        ),
                        pass_through_status_code: false,
                        pass_through_message: false,
                      })
                    }
                  >
                    <Plus className='size-4' />
                    {t('Add custom error response rule')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
