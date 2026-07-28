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
import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  HeartPulse,
  ListChecks,
  Plus,
  RefreshCcw,
  Route,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useFieldArray,
  useForm,
  type SubmitErrorHandler,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { getChannelFilterGroups } from '@/features/channels/api'
import { parseHttpStatusCodeRules } from '@/lib/http-status-code-rules'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOptionsBulk } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'
import { ChannelRouteExclusionEditor } from './channel-route-exclusion-editor'
import {
  parseRequestErrorRoutingRules,
  serializeRequestErrorRoutingRules,
} from './request-error-routing-rules'
import {
  resolveRouteCooldownToggle,
  resolveSameChannelRetryToggle,
} from './route-cooldown'
import {
  parseGroupExclusions,
  serializeGroupExclusions,
} from './route-exclusions'

const numericString = z.string().refine((value) => {
  const trimmed = value.trim()
  if (!trimmed) return true
  return !Number.isNaN(Number(trimmed)) && Number(trimmed) >= 0
}, 'Enter a non-negative number or leave empty')

const channelTestModes = ['scheduled_all', 'passive_recovery'] as const
type ChannelTestMode = (typeof channelTestModes)[number]

const routingReliabilityViews = ['strategy', 'errors', 'health'] as const
type RoutingReliabilityView = (typeof routingReliabilityViews)[number]
type RoutingReliabilitySectionView = 'routing' | 'custom-errors'

const errorResponseMatchModes = ['any', 'all'] as const
type ErrorResponseMatchMode = (typeof errorResponseMatchModes)[number]
const errorMessageMatchModes = ['contains', 'exact'] as const
type ErrorMessageMatchMode = (typeof errorMessageMatchModes)[number]

const customErrorResponseRuleSchema = z.object({
  name: z.string(),
  description: z.string(),
  priority: z.coerce.number(),
  enabled: z.boolean(),
  match_mode: z.enum(errorResponseMatchModes),
  status_codes: z.string(),
  message_contains: z.string(),
  message_match_mode: z.enum(errorMessageMatchModes),
  response_status_code: z.coerce.number(),
  response_message: z.string(),
  pass_through_status_code: z.boolean(),
  pass_through_message: z.boolean(),
})

const routingReliabilitySchema = z.object({
  RetryTimes: z.coerce.number(),
  ChannelRouteCooldownEnabled: z.boolean(),
  ChannelRouteCooldownSeconds: z.coerce.number(),
  ChannelRouteSameChannelRetries: z.coerce.number(),
  ChannelRouteGroupExclusionsEnabled: z.boolean(),
  ChannelRouteGroupExclusions: z.string(),
  ChannelDisableThreshold: z.string(),
  AutomaticDisableChannelEnabled: z.boolean(),
  AutomaticEnableChannelEnabled: z.boolean(),
  AutomaticDisableKeywords: z.string(),
  AutomaticDisableStatusCodes: z.string(),
  AutomaticRetryStatusCodes: z.string(),
  monitor_setting: z.object({
    auto_test_channel_enabled: z.boolean(),
    auto_test_channel_minutes: z.coerce.number(),
    channel_test_mode: z.enum(channelTestModes),
  }),
  error_response_setting: z.object({
    enabled: z.boolean(),
    rules: z.array(customErrorResponseRuleSchema),
  }),
  request_error_routing_setting: z.object({
    enabled: z.boolean(),
    rules: z.string(),
  }),
})

const routingFieldsValidationSchema = z.object({
  RetryTimes: z.number().int().min(0).max(10),
  ChannelRouteCooldownSeconds: z
    .number()
    .int()
    .min(0)
    .max(31536000, 'Cooldown cannot exceed 31536000 seconds'),
  ChannelRouteSameChannelRetries: z.number().int().min(0).max(10),
  ChannelDisableThreshold: numericString,
  monitor_setting: z.object({
    auto_test_channel_minutes: z
      .number()
      .int()
      .min(1, 'Interval must be at least 1 minute'),
  }),
})

// eslint-disable-next-line react-refresh/only-export-components
export function createRoutingReliabilitySchema(
  view: RoutingReliabilitySectionView,
  t: TFunction
) {
  return routingReliabilitySchema.superRefine((values, ctx) => {
    if (view === 'routing') {
      const routingFieldsValidation =
        routingFieldsValidationSchema.safeParse(values)
      if (!routingFieldsValidation.success) {
        for (const issue of routingFieldsValidation.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: issue.path,
            message: issue.message,
          })
        }
      }

      const disableParsed = parseHttpStatusCodeRules(
        values.AutomaticDisableStatusCodes
      )
      if (!disableParsed.ok) {
        ctx.addIssue({
          code: 'custom',
          path: ['AutomaticDisableStatusCodes'],
          message: `${t('Invalid status code rules')}: ${disableParsed.invalidTokens.join(', ')}`,
        })
      }

      const retryParsed = parseHttpStatusCodeRules(
        values.AutomaticRetryStatusCodes
      )
      if (!retryParsed.ok) {
        ctx.addIssue({
          code: 'custom',
          path: ['AutomaticRetryStatusCodes'],
          message: `${t('Invalid status code rules')}: ${retryParsed.invalidTokens.join(', ')}`,
        })
      }

      return
    }

    if (!values.error_response_setting.enabled) return

    values.error_response_setting.rules.forEach((rule, index) => {
      if (!rule.enabled) return

      if (!Number.isInteger(rule.priority)) {
        ctx.addIssue({
          code: 'custom',
          path: ['error_response_setting', 'rules', index, 'priority'],
          message: 'Priority must be an integer',
        })
      }

      if (!rule.name.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['error_response_setting', 'rules', index, 'name'],
          message: 'Rule name is required',
        })
      } else if (rule.name.trim().length > 100) {
        ctx.addIssue({
          code: 'custom',
          path: ['error_response_setting', 'rules', index, 'name'],
          message: 'Rule name cannot exceed 100 characters',
        })
      }
      if (rule.description.trim().length > 500) {
        ctx.addIssue({
          code: 'custom',
          path: ['error_response_setting', 'rules', index, 'description'],
          message: 'Rule description cannot exceed 500 characters',
        })
      }

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
        (!Number.isInteger(rule.response_status_code) ||
          rule.response_status_code < 100 ||
          rule.response_status_code > 599)
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
}

type RoutingReliabilityFormValues = z.output<typeof routingReliabilitySchema>
type RoutingReliabilityFormInput = z.input<typeof routingReliabilitySchema>
type CustomErrorResponseRuleFormValues = z.output<
  typeof customErrorResponseRuleSchema
>

type RoutingReliabilitySectionProps = {
  view?: RoutingReliabilitySectionView
  defaultValues: {
    RetryTimes: number
    ChannelRouteCooldownEnabled: boolean
    ChannelRouteCooldownSeconds: number
    ChannelRouteSameChannelRetries: number
    ChannelRouteGroupExclusionsEnabled: boolean
    ChannelRouteGroupExclusions: string
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
    'request_error_routing_setting.enabled': boolean
    'request_error_routing_setting.rules': string
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

function normalizeErrorMessageMatchMode(value: unknown): ErrorMessageMatchMode {
  return value === 'exact' ? 'exact' : 'contains'
}

function parseCustomErrorResponseRules(
  value: string
): CustomErrorResponseRuleFormValues[] {
  const raw = (value ?? '').toString().trim()
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.map((item, index) => {
      const record =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : {}
      const responseStatusCode = Number(record.response_status_code)

      return {
        name:
          typeof record.name === 'string' && record.name.trim()
            ? record.name.trim()
            : `Rule ${index + 1}`,
        description:
          typeof record.description === 'string' ? record.description : '',
        priority: Number.isInteger(Number(record.priority))
          ? Number(record.priority)
          : 0,
        enabled: record.enabled === true,
        match_mode: normalizeErrorResponseMatchMode(record.match_mode),
        status_codes:
          typeof record.status_codes === 'string' ? record.status_codes : '',
        message_contains:
          typeof record.message_contains === 'string'
            ? record.message_contains
            : '',
        message_match_mode: normalizeErrorMessageMatchMode(
          record.message_match_mode
        ),
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
      name: rule.name.trim(),
      description: rule.description.trim(),
      priority: rule.priority,
      enabled: rule.enabled,
      match_mode: normalizeErrorResponseMatchMode(rule.match_mode),
      status_codes: parseHttpStatusCodeRules(rule.status_codes).normalized,
      message_contains: rule.message_contains.trim(),
      message_match_mode: normalizeErrorMessageMatchMode(
        rule.message_match_mode
      ),
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
  ChannelRouteSameChannelRetries: number
  ChannelRouteGroupExclusionsEnabled: boolean
  ChannelRouteGroupExclusions: string
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
  'request_error_routing_setting.enabled': boolean
  'request_error_routing_setting.rules': string
}

const customErrorResponseOptionKeys = new Set<
  keyof NormalizedRoutingReliabilityValues
>(['error_response_setting.enabled', 'error_response_setting.rules'])

function optionBelongsToView(
  key: keyof NormalizedRoutingReliabilityValues,
  view: RoutingReliabilitySectionView
) {
  const isCustomErrorResponseOption = customErrorResponseOptionKeys.has(key)
  return view === 'custom-errors'
    ? isCustomErrorResponseOption
    : !isCustomErrorResponseOption
}

// eslint-disable-next-line react-refresh/only-export-components
export function optionShouldBeSaved(
  key: string,
  view: RoutingReliabilitySectionView,
  values: {
    'error_response_setting.enabled': boolean
    'request_error_routing_setting.enabled': boolean
  }
) {
  if (key.startsWith('request_error_routing_setting.')) {
    return false
  }
  if (
    !optionBelongsToView(key as keyof NormalizedRoutingReliabilityValues, view)
  ) {
    return false
  }
  if (
    key === 'error_response_setting.rules' &&
    !values['error_response_setting.enabled']
  ) {
    return false
  }
  return true
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
  ChannelRouteSameChannelRetries: defaults.ChannelRouteSameChannelRetries ?? 0,
  ChannelRouteGroupExclusionsEnabled:
    defaults.ChannelRouteGroupExclusionsEnabled,
  ChannelRouteGroupExclusions: serializeGroupExclusions(
    parseGroupExclusions(defaults.ChannelRouteGroupExclusions)
  ),
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
  request_error_routing_setting: {
    enabled: defaults['request_error_routing_setting.enabled'],
    rules: defaults['request_error_routing_setting.rules'],
  },
})

const normalizeDefaults = (
  defaults: RoutingReliabilitySectionProps['defaultValues']
): NormalizedRoutingReliabilityValues => ({
  RetryTimes: defaults.RetryTimes ?? 0,
  ChannelRouteCooldownEnabled: defaults.ChannelRouteCooldownEnabled,
  ChannelRouteCooldownSeconds: defaults.ChannelRouteCooldownSeconds ?? 60,
  ChannelRouteSameChannelRetries: defaults.ChannelRouteSameChannelRetries ?? 0,
  ChannelRouteGroupExclusionsEnabled:
    defaults.ChannelRouteGroupExclusionsEnabled,
  ChannelRouteGroupExclusions: serializeGroupExclusions(
    parseGroupExclusions(defaults.ChannelRouteGroupExclusions)
  ),
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
  'request_error_routing_setting.enabled':
    defaults['request_error_routing_setting.enabled'],
  'request_error_routing_setting.rules': serializeRequestErrorRoutingRules(
    parseRequestErrorRoutingRules(
      defaults['request_error_routing_setting.rules']
    ),
    true
  ),
})

const normalizeFormValues = (
  values: RoutingReliabilityFormValues
): NormalizedRoutingReliabilityValues => ({
  RetryTimes: values.ChannelRouteCooldownEnabled ? 0 : values.RetryTimes,
  ChannelRouteCooldownEnabled: values.ChannelRouteCooldownEnabled,
  ChannelRouteCooldownSeconds: values.ChannelRouteCooldownSeconds,
  ChannelRouteSameChannelRetries: values.ChannelRouteSameChannelRetries,
  ChannelRouteGroupExclusionsEnabled: values.ChannelRouteGroupExclusionsEnabled,
  ChannelRouteGroupExclusions: serializeGroupExclusions(
    parseGroupExclusions(values.ChannelRouteGroupExclusions)
  ),
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
  'request_error_routing_setting.enabled':
    values.request_error_routing_setting.enabled,
  'request_error_routing_setting.rules': serializeRequestErrorRoutingRules(
    parseRequestErrorRoutingRules(values.request_error_routing_setting.rules),
    true
  ),
})

export function RoutingReliabilitySection({
  defaultValues,
  view = 'routing',
}: RoutingReliabilitySectionProps) {
  const { t } = useTranslation()
  const updateOptions = useUpdateOptionsBulk()
  const baselineRef = useRef<NormalizedRoutingReliabilityValues>(
    normalizeDefaults(defaultValues)
  )

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )
  const formSchema = useMemo(
    () => createRoutingReliabilitySchema(view, t),
    [t, view]
  )
  const enabledCooldownSecondsRef = useRef(
    defaultValues.ChannelRouteCooldownSeconds > 0
      ? defaultValues.ChannelRouteCooldownSeconds
      : 60
  )
  const enabledSameChannelRetriesRef = useRef(
    defaultValues.ChannelRouteSameChannelRetries > 0
      ? defaultValues.ChannelRouteSameChannelRetries
      : 1
  )

  const form = useForm<
    RoutingReliabilityFormInput,
    unknown,
    RoutingReliabilityFormValues
  >({
    resolver: zodResolver(formSchema),
    defaultValues: formDefaults,
  })
  const errorRuleFields = useFieldArray({
    control: form.control,
    name: 'error_response_setting.rules',
  })

  useResetForm(form, formDefaults)

  useEffect(() => {
    if (defaultValues.ChannelRouteCooldownSeconds > 0) {
      enabledCooldownSecondsRef.current =
        defaultValues.ChannelRouteCooldownSeconds
    }
  }, [defaultValues.ChannelRouteCooldownSeconds])

  useEffect(() => {
    if (defaultValues.ChannelRouteSameChannelRetries > 0) {
      enabledSameChannelRetriesRef.current =
        defaultValues.ChannelRouteSameChannelRetries
    }
  }, [defaultValues.ChannelRouteSameChannelRetries])

  const groupOptionsQuery = useQuery({
    queryKey: ['channel-route-group-options'],
    queryFn: () => getChannelFilterGroups(true),
    enabled: view === 'routing',
  })
  const groupOptions = groupOptionsQuery.data?.data ?? []

  const autoDisableStatusCodes = form.watch('AutomaticDisableStatusCodes')
  const autoRetryStatusCodes = form.watch('AutomaticRetryStatusCodes')
  const channelRouteCooldownEnabled = form.watch('ChannelRouteCooldownEnabled')
  const sameChannelRetries = Number(
    form.watch('ChannelRouteSameChannelRetries') ?? 0
  )
  const groupExclusionsEnabled = form.watch(
    'ChannelRouteGroupExclusionsEnabled'
  )
  const channelTestMode = form.watch('monitor_setting.channel_test_mode')
  const customErrorResponsesEnabled = form.watch(
    'error_response_setting.enabled'
  )
  const [activeRoutingView, setActiveRoutingView] =
    useState<RoutingReliabilityView>('strategy')
  const [routeExclusionsOpen, setRouteExclusionsOpen] = useState(false)
  const [expandedErrorRuleIndex, setExpandedErrorRuleIndex] = useState<
    number | null
  >(0)
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
    ).filter(
      (key) =>
        optionShouldBeSaved(key, view, normalized) &&
        normalized[key] !== baselineRef.current[key]
    )

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    try {
      await updateOptions.mutateAsync({
        options: updates.map((key) => ({ key, value: normalized[key] })),
      })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('Failed to update setting')
      )
      return
    }

    const nextBaseline = { ...baselineRef.current }
    for (const key of updates) {
      Object.assign(nextBaseline, { [key]: normalized[key] })
    }
    baselineRef.current = nextBaseline
    toast.success(t('Setting updated successfully'))
  }

  const onInvalid: SubmitErrorHandler<RoutingReliabilityFormInput> = (
    errors
  ) => {
    toast.error(t('Please fix the highlighted validation errors'))
    if (view !== 'routing') return

    if (
      errors.request_error_routing_setting ||
      errors.AutomaticRetryStatusCodes
    ) {
      setActiveRoutingView('errors')
      return
    }

    if (
      errors.monitor_setting ||
      errors.AutomaticDisableChannelEnabled ||
      errors.AutomaticEnableChannelEnabled ||
      errors.AutomaticDisableStatusCodes ||
      errors.AutomaticDisableKeywords ||
      errors.ChannelDisableThreshold
    ) {
      setActiveRoutingView('health')
      return
    }

    setActiveRoutingView('strategy')
  }

  const submitForm = form.handleSubmit(onSubmit, onInvalid)

  const addCustomErrorRule = () => {
    const nextIndex = errorRuleFields.fields.length
    errorRuleFields.append({
      name: t('Rule {{number}}', { number: nextIndex + 1 }),
      description: '',
      priority: nextIndex,
      enabled: true,
      match_mode: 'any',
      status_codes: '429,500-599',
      message_contains: '',
      message_match_mode: 'contains',
      response_status_code: 429,
      response_message: t('Upstream request failed. Please try again later.'),
      pass_through_status_code: false,
      pass_through_message: false,
    })
    setExpandedErrorRuleIndex(nextIndex)
  }

  const removeCustomErrorRule = (index: number) => {
    errorRuleFields.remove(index)
    setExpandedErrorRuleIndex((current) => {
      if (current === null) return null
      if (current === index) return null
      return current > index ? current - 1 : current
    })
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
        <SettingsForm onSubmit={submitForm}>
          <SettingsPageFormActions
            onSave={submitForm}
            isSaving={updateOptions.isPending}
          />

          {view === 'routing' ? (
            <div className='min-w-0 space-y-6'>
              <Tabs
                value={activeRoutingView}
                onValueChange={(value) => {
                  if (
                    routingReliabilityViews.includes(
                      value as RoutingReliabilityView
                    )
                  ) {
                    setActiveRoutingView(value as RoutingReliabilityView)
                  }
                }}
              >
                <TabsList
                  variant='line'
                  className='grid h-10 w-full grid-cols-3 justify-stretch lg:w-[32rem]'
                >
                  <TabsTrigger
                    id='routing-reliability-tab-strategy'
                    value='strategy'
                    aria-controls='routing-reliability-panel'
                  >
                    <Route />
                    <span className='sm:hidden'>{t('Strategy')}</span>
                    <span className='hidden sm:inline'>
                      {t('Execution strategy')}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    id='routing-reliability-tab-errors'
                    value='errors'
                    aria-controls='routing-reliability-panel'
                  >
                    <ListChecks />
                    <span className='sm:hidden'>{t('Errors')}</span>
                    <span className='hidden sm:inline'>
                      {t('Error decisions')}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    id='routing-reliability-tab-health'
                    value='health'
                    aria-controls='routing-reliability-panel'
                  >
                    <HeartPulse />
                    <span className='sm:hidden'>{t('Health')}</span>
                    <span className='hidden sm:inline'>
                      {t('Channel health')}
                    </span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div
                id='routing-reliability-panel'
                role='tabpanel'
                aria-labelledby={`routing-reliability-tab-${activeRoutingView}`}
                className='min-w-0 space-y-6'
              >
                {activeRoutingView === 'strategy' ? (
                  <>
                    <div className='flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6'>
                      <div className='min-w-0 space-y-0.5'>
                        <h4 className='text-sm font-medium'>
                          {t('Routing strategy')}
                        </h4>
                        <p className='text-muted-foreground text-xs'>
                          {t(
                            'Choose one strategy for handling failed requests.'
                          )}
                        </p>
                      </div>
                      <FormField
                        control={form.control}
                        name='ChannelRouteCooldownEnabled'
                        render={({ field }) => (
                          <FormItem className='w-full shrink-0 lg:w-[36rem] lg:max-w-[65%]'>
                            <FormLabel className='sr-only'>
                              {t('Active request strategy')}
                            </FormLabel>
                            <Tabs
                              value={field.value ? 'routing' : 'standard'}
                              onValueChange={(value) =>
                                field.onChange(value === 'routing')
                              }
                            >
                              <TabsList className='border-border/70 bg-muted/40 grid w-full grid-cols-2 overflow-hidden rounded-md border p-1 group-data-horizontal/tabs:h-11'>
                                <TabsTrigger
                                  value='standard'
                                  className='data-active:bg-primary data-active:text-primary-foreground dark:data-active:bg-primary dark:data-active:text-primary-foreground rounded-md px-3 data-active:shadow-none'
                                >
                                  <RefreshCcw />
                                  <span className='sm:hidden'>
                                    {t('Retry')}
                                  </span>
                                  <span className='hidden sm:inline'>
                                    {t('Standard request retry')}
                                  </span>
                                </TabsTrigger>
                                <TabsTrigger
                                  value='routing'
                                  className='data-active:bg-primary data-active:text-primary-foreground dark:data-active:bg-primary dark:data-active:text-primary-foreground rounded-md px-3 data-active:shadow-none'
                                >
                                  <Route />
                                  <span className='sm:hidden'>
                                    {t('Route')}
                                  </span>
                                  <span className='hidden sm:inline'>
                                    {t('Channel routing')}
                                  </span>
                                </TabsTrigger>
                              </TabsList>
                            </Tabs>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className='border-border/70 bg-border/70 grid min-w-0 gap-px overflow-hidden rounded-md border sm:grid-cols-3'>
                      <div className='bg-background min-w-0 px-3 py-2.5'>
                        <div className='text-muted-foreground text-xs'>
                          {t('Active request strategy')}
                        </div>
                        <div className='mt-0.5 truncate text-sm font-medium'>
                          {channelRouteCooldownEnabled
                            ? t('Channel routing')
                            : t('Standard request retry')}
                        </div>
                      </div>
                      <div className='bg-background min-w-0 px-3 py-2.5'>
                        <div className='text-muted-foreground text-xs'>
                          {channelRouteCooldownEnabled
                            ? t('Same-channel retries')
                            : t('Retry Times')}
                        </div>
                        <div className='mt-0.5 text-sm font-medium tabular-nums'>
                          {channelRouteCooldownEnabled
                            ? sameChannelRetries
                            : Number(form.watch('RetryTimes') ?? 0)}
                        </div>
                      </div>
                      <div className='bg-background min-w-0 px-3 py-2.5'>
                        <div className='text-muted-foreground text-xs'>
                          {t('Route exclusion groups')}
                        </div>
                        <div className='mt-0.5 text-sm font-medium'>
                          {channelRouteCooldownEnabled && groupExclusionsEnabled
                            ? t('Enabled')
                            : t('Disabled')}
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}

                {activeRoutingView === 'errors' ? (
                  <div className='min-w-0'>
                    <section className='min-w-0 space-y-3'>
                      <div className='flex min-w-0 items-start gap-3'>
                        <span className='bg-primary text-primary-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold'>
                          1
                        </span>
                        <div className='min-w-0 space-y-0.5'>
                          <h4 className='text-sm font-medium'>
                            {t('Failure handling status codes')}
                          </h4>
                          <p className='text-muted-foreground text-xs'>
                            {t(
                              'Only ordinary HTTP errors use this status-code list. Streaming terminal errors follow built-in safety rules.'
                            )}{' '}
                            {t(
                              'Accepts comma-separated status codes and inclusive ranges.'
                            )}
                          </p>
                        </div>
                      </div>

                      <FormField
                        control={form.control}
                        name='AutomaticRetryStatusCodes'
                        render={({ field }) => (
                          <FormItem className='max-w-5xl pl-8'>
                            <FormLabel className='sr-only'>
                              {t('Failure handling status codes')}
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
                            {autoRetryParsed.ok &&
                            autoRetryParsed.normalized &&
                            autoRetryParsed.normalized !==
                              field.value.trim() ? (
                              <FormDescription>
                                {t('Normalized:')} {autoRetryParsed.normalized}
                              </FormDescription>
                            ) : null}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </section>
                  </div>
                ) : null}

                {activeRoutingView === 'strategy' &&
                !channelRouteCooldownEnabled ? (
                  <div className='min-w-0 space-y-4'>
                    <div className='space-y-0.5'>
                      <h4 className='text-sm font-medium'>
                        {t('Standard request retry')}
                      </h4>
                      <p className='text-muted-foreground text-xs'>
                        {t(
                          'Failed requests follow the regular retry policy and distribution strategy.'
                        )}
                      </p>
                    </div>
                    <div className='max-w-2xl'>
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
                    </div>
                  </div>
                ) : null}

                {activeRoutingView === 'strategy' &&
                channelRouteCooldownEnabled ? (
                  <div className='min-w-0 space-y-5'>
                    <div className='space-y-0.5'>
                      <h4 className='text-sm font-medium'>
                        {t('Channel routing')}
                      </h4>
                      <p className='text-muted-foreground text-xs'>
                        {t(
                          'Matching failures retry the current channel first, then switch to another candidate channel.'
                        )}
                      </p>
                    </div>
                    <div className='grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-4'>
                      <div className='border-primary/30 min-w-0 border-l-2 pl-4'>
                        <div className='mb-3 flex min-h-7 items-center gap-2'>
                          <span className='bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold'>
                            1
                          </span>
                          <span className='truncate text-sm font-medium'>
                            {t('Retry current channel')}
                          </span>
                        </div>
                        <FormField
                          control={form.control}
                          name='ChannelRouteSameChannelRetries'
                          render={({ field }) => {
                            const parsedValue = Number(field.value)
                            const sameChannelRetries = Number.isFinite(
                              parsedValue
                            )
                              ? parsedValue
                              : 0

                            return (
                              <FormItem>
                                <div className='flex min-h-5 items-center justify-between gap-2'>
                                  <FormLabel>
                                    {t('Same-channel retries')}
                                  </FormLabel>
                                  <label className='text-muted-foreground flex shrink-0 cursor-pointer items-center gap-1.5 text-xs'>
                                    <span>{t('Enable')}</span>
                                    <Switch
                                      size='sm'
                                      checked={sameChannelRetries > 0}
                                      onCheckedChange={(enabled) => {
                                        const next =
                                          resolveSameChannelRetryToggle(
                                            sameChannelRetries,
                                            !enabled,
                                            enabledSameChannelRetriesRef.current
                                          )
                                        enabledSameChannelRetriesRef.current =
                                          next.lastEnabledRetries
                                        field.onChange(next.value)
                                      }}
                                    />
                                  </label>
                                </div>
                                <FormControl>
                                  <Input
                                    type='number'
                                    min={0}
                                    max={10}
                                    step={1}
                                    disabled={sameChannelRetries === 0}
                                    {...safeNumberFieldProps(field)}
                                    onChange={(event) => {
                                      const value = event.target.valueAsNumber
                                      if (!Number.isFinite(value)) return
                                      field.onChange(value)
                                      if (value > 0) {
                                        enabledSameChannelRetriesRef.current =
                                          value
                                      }
                                    }}
                                  />
                                </FormControl>
                                <FormDescription>
                                  {t(
                                    'Additional retries on the current channel (0-10); 0 disables same-channel retries. With the initial request included, this setting allows up to {{total}} requests in total.',
                                    { total: sameChannelRetries + 1 }
                                  )}
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )
                          }}
                        />
                      </div>

                      <div className='text-muted-foreground flex items-center justify-center'>
                        <ArrowDown className='size-4 md:hidden' />
                        <ArrowRight className='hidden size-4 md:block' />
                      </div>

                      <div className='border-primary/30 min-w-0 border-l-2 pl-4'>
                        <div className='mb-3 flex min-h-7 items-center gap-2'>
                          <span className='bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold'>
                            2
                          </span>
                          <span className='truncate text-sm font-medium'>
                            {t('Switch candidate channel')}
                          </span>
                        </div>
                        <FormField
                          control={form.control}
                          name='ChannelRouteCooldownSeconds'
                          render={({ field }) => {
                            const parsedValue = Number(field.value)
                            const cooldownSeconds = Number.isFinite(parsedValue)
                              ? parsedValue
                              : 0

                            return (
                              <FormItem>
                                <div className='flex min-h-5 items-center justify-between gap-2'>
                                  <FormLabel>
                                    {t('Cooldown time (seconds)')}
                                  </FormLabel>
                                  <label className='text-muted-foreground flex shrink-0 cursor-pointer items-center gap-1.5 text-xs'>
                                    <span>{t('Enable')}</span>
                                    <Switch
                                      size='sm'
                                      checked={cooldownSeconds > 0}
                                      onCheckedChange={(enabled) => {
                                        const next = resolveRouteCooldownToggle(
                                          cooldownSeconds,
                                          !enabled,
                                          enabledCooldownSecondsRef.current
                                        )
                                        enabledCooldownSecondsRef.current =
                                          next.lastEnabledSeconds
                                        field.onChange(next.value)
                                      }}
                                    />
                                  </label>
                                </div>
                                <FormControl>
                                  <Input
                                    type='number'
                                    min={0}
                                    max={31536000}
                                    step={1}
                                    disabled={
                                      !channelRouteCooldownEnabled ||
                                      cooldownSeconds === 0
                                    }
                                    {...safeNumberFieldProps(field)}
                                    onChange={(event) => {
                                      const value = event.target.valueAsNumber
                                      if (!Number.isFinite(value)) return
                                      field.onChange(value)
                                      if (value > 0) {
                                        enabledCooldownSecondsRef.current =
                                          value
                                      }
                                    }}
                                  />
                                </FormControl>
                                <FormDescription>
                                  {t(
                                    'How long a failed channel is excluded from selection; 0 disables cooldown.'
                                  )}
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )
                          }}
                        />
                      </div>
                    </div>

                    <Collapsible
                      open={routeExclusionsOpen}
                      onOpenChange={setRouteExclusionsOpen}
                      className='border-border/70 min-w-0 overflow-hidden rounded-md border'
                    >
                      <div className='grid min-h-14 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2'>
                        <CollapsibleTrigger
                          render={
                            <button
                              type='button'
                              data-press-animation='none'
                              className='group grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2.5 rounded text-left outline-none focus-visible:ring-2'
                            />
                          }
                        >
                          <span className='bg-background group-hover:bg-muted flex size-7 items-center justify-center rounded-md border transition-colors'>
                            {routeExclusionsOpen ? (
                              <ChevronDown className='text-muted-foreground size-3.5' />
                            ) : (
                              <ChevronRight className='text-muted-foreground size-3.5' />
                            )}
                          </span>
                          <span className='min-w-0'>
                            <span className='block truncate text-sm font-medium'>
                              {t('Route exclusion groups')}
                            </span>
                            <span className='text-muted-foreground mt-0.5 block truncate text-xs'>
                              {t(
                                'Override the two routing steps for selected groups: skip current-channel retries, candidate failover, or both.'
                              )}
                            </span>
                          </span>
                        </CollapsibleTrigger>

                        <FormField
                          control={form.control}
                          name='ChannelRouteGroupExclusionsEnabled'
                          render={({ field }) => (
                            <FormItem className='flex items-center gap-1.5'>
                              <FormLabel className='sr-only'>
                                {t('Route exclusion groups')}
                              </FormLabel>
                              <span className='text-muted-foreground text-xs'>
                                {field.value ? t('Enabled') : t('Disabled')}
                              </span>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={(enabled) => {
                                    field.onChange(enabled)
                                    if (enabled) setRouteExclusionsOpen(true)
                                  }}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>

                      <CollapsibleContent>
                        <div className='border-t p-3'>
                          <FormField
                            control={form.control}
                            name='ChannelRouteGroupExclusions'
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <ChannelRouteExclusionEditor
                                    value={field.value}
                                    groupOptions={groupOptions}
                                    disabled={
                                      !groupExclusionsEnabled ||
                                      groupOptionsQuery.isLoading
                                    }
                                    onChange={field.onChange}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                ) : null}

                {activeRoutingView === 'health' ? (
                  <>
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
                                <FormLabel>
                                  {t('Scheduled channel tests')}
                                </FormLabel>
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
                              <FormLabel>
                                {t('Test interval (minutes)')}
                              </FormLabel>
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
                                  : t(
                                      'How frequently the system tests all channels'
                                    )}
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
                                <FormLabel>
                                  {t('Re-enable on success')}
                                </FormLabel>
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
                              <FormLabel>
                                {t('Auto-disable status codes')}
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
              </div>
            </div>
          ) : null}

          {view === 'custom-errors' ? (
            <div className='flex min-w-0 flex-col gap-4'>
              <div className='overflow-hidden rounded-md border'>
                <FormField
                  control={form.control}
                  name='error_response_setting.enabled'
                  render={({ field }) => (
                    <SettingsSwitchItem className='px-3 py-3'>
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
                <div className='bg-muted/20 flex items-center justify-between gap-3 border-t px-3 py-2.5'>
                  <span className='text-muted-foreground text-xs'>
                    {t('{{count}} custom error response rules', {
                      count: errorRuleFields.fields.length,
                    })}
                  </span>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={!customErrorResponsesEnabled}
                    onClick={addCustomErrorRule}
                  >
                    <Plus data-icon='inline-start' />
                    {t('Add rule')}
                  </Button>
                </div>
              </div>

              {customErrorResponsesEnabled ? (
                <div className='grid min-w-0 items-start gap-3 xl:grid-cols-2'>
                  {errorRuleFields.fields.length === 0 ? (
                    <div className='border-border/70 text-muted-foreground rounded-md border border-dashed p-4 text-sm xl:col-span-2'>
                      {t('No custom error response rules')}
                    </div>
                  ) : (
                    errorRuleFields.fields.map((ruleField, index) => {
                      const ruleName = String(
                        form.watch(
                          `error_response_setting.rules.${index}.name`
                        ) ?? ''
                      )
                      const rulePriority = Number(
                        form.watch(
                          `error_response_setting.rules.${index}.priority`
                        ) ?? 0
                      )
                      const ruleDescription = String(
                        form.watch(
                          `error_response_setting.rules.${index}.description`
                        ) ?? ''
                      )
                      const ruleStatusCodes = String(
                        form.watch(
                          `error_response_setting.rules.${index}.status_codes`
                        ) ?? ''
                      )
                      const passThroughStatus = form.watch(
                        `error_response_setting.rules.${index}.pass_through_status_code`
                      )
                      const passThroughMessage = form.watch(
                        `error_response_setting.rules.${index}.pass_through_message`
                      )

                      return (
                        <Collapsible
                          key={ruleField.id}
                          open={expandedErrorRuleIndex === index}
                          onOpenChange={(open) =>
                            setExpandedErrorRuleIndex(open ? index : null)
                          }
                          className='border-border/70 min-w-0 overflow-hidden rounded-md border'
                        >
                          <div
                            className={
                              expandedErrorRuleIndex === index
                                ? 'bg-muted/20 grid min-h-14 min-w-0 grid-cols-[minmax(0,1fr)_4.75rem] items-center gap-2 px-2 py-2'
                                : 'grid min-h-14 min-w-0 grid-cols-[minmax(0,1fr)_4.75rem] items-center gap-2 px-2 py-2'
                            }
                          >
                            <CollapsibleTrigger
                              render={
                                <button
                                  type='button'
                                  data-press-animation='none'
                                  className='group grid min-h-10 min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2.5 rounded px-1 text-left outline-none focus-visible:ring-2'
                                />
                              }
                            >
                              <span className='bg-background group-hover:bg-muted flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors'>
                                {expandedErrorRuleIndex === index ? (
                                  <ChevronDown className='text-muted-foreground size-3.5' />
                                ) : (
                                  <ChevronRight className='text-muted-foreground size-3.5' />
                                )}
                              </span>
                              <span className='min-w-0 flex-1'>
                                <span className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
                                  <span className='truncate text-sm font-medium'>
                                    {ruleName ||
                                      t('Rule {{number}}', {
                                        number: index + 1,
                                      })}
                                  </span>
                                  <span className='bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]'>
                                    {t('Priority')} {rulePriority}
                                  </span>
                                  <span className='bg-muted text-muted-foreground max-w-40 truncate rounded px-1.5 py-0.5 font-mono text-[11px]'>
                                    {ruleStatusCodes || '*'}
                                  </span>
                                </span>
                                {ruleDescription ? (
                                  <span className='text-muted-foreground mt-0.5 block truncate text-xs'>
                                    {ruleDescription}
                                  </span>
                                ) : null}
                              </span>
                            </CollapsibleTrigger>

                            <div className='flex h-9 w-[4.75rem] shrink-0 items-center justify-end gap-1 border-l pl-2'>
                              <FormField
                                control={form.control}
                                name={
                                  `error_response_setting.rules.${index}.enabled` as const
                                }
                                render={({ field }) => (
                                  <FormItem className='shrink-0 px-1'>
                                    <FormLabel className='sr-only'>
                                      {t('Enabled')}
                                    </FormLabel>
                                    <FormControl>
                                      <Switch
                                        size='sm'
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                      />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />

                              <Button
                                type='button'
                                variant='ghost'
                                size='icon-sm'
                                className='text-destructive'
                                aria-label={t(
                                  'Remove custom error response rule'
                                )}
                                onClick={() => removeCustomErrorRule(index)}
                              >
                                <Trash2 className='size-4' />
                              </Button>
                            </div>
                          </div>

                          <CollapsibleContent className='CollapsibleContent'>
                            <div className='grid min-w-0 gap-4 border-t p-3'>
                              <div className='grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_10rem]'>
                                <FormField
                                  control={form.control}
                                  name={
                                    `error_response_setting.rules.${index}.name` as const
                                  }
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>{t('Rule name')}</FormLabel>
                                      <FormControl>
                                        <Input
                                          placeholder={t(
                                            'e.g. Context window exceeded'
                                          )}
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />

                                <FormField
                                  control={form.control}
                                  name={
                                    `error_response_setting.rules.${index}.priority` as const
                                  }
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>{t('Priority')}</FormLabel>
                                      <FormControl>
                                        <Input
                                          type='number'
                                          step={1}
                                          {...safeNumberFieldProps(field)}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>

                              <FormField
                                control={form.control}
                                name={
                                  `error_response_setting.rules.${index}.description` as const
                                }
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>
                                      {t('Rule description')}
                                    </FormLabel>
                                    <FormControl>
                                      <Input
                                        placeholder={t(
                                          'Describe when and why this rule is used'
                                        )}
                                        {...field}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <div className='text-sm font-medium'>
                                {t('Match conditions')}
                              </div>
                              <div className='grid min-w-0 gap-3 md:grid-cols-2'>
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
                                            normalizeErrorResponseMatchMode(
                                              value
                                            )
                                          )
                                        }
                                      >
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue />
                                          </SelectTrigger>
                                        </FormControl>
                                        <SelectContent
                                          alignItemWithTrigger={false}
                                        >
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
                                    `error_response_setting.rules.${index}.message_match_mode` as const
                                  }
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>
                                        {t('Error message match mode')}
                                      </FormLabel>
                                      <Select
                                        items={[
                                          {
                                            value: 'contains',
                                            label: t('Fuzzy contains'),
                                          },
                                          {
                                            value: 'exact',
                                            label: t('Exact message'),
                                          },
                                        ]}
                                        value={field.value}
                                        onValueChange={(value) =>
                                          field.onChange(
                                            normalizeErrorMessageMatchMode(
                                              value
                                            )
                                          )
                                        }
                                      >
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue />
                                          </SelectTrigger>
                                        </FormControl>
                                        <SelectContent
                                          alignItemWithTrigger={false}
                                        >
                                          <SelectGroup>
                                            <SelectItem value='contains'>
                                              {t('Fuzzy contains')}
                                            </SelectItem>
                                            <SelectItem value='exact'>
                                              {t('Exact message')}
                                            </SelectItem>
                                          </SelectGroup>
                                        </SelectContent>
                                      </Select>
                                      <FormDescription>
                                        {t(
                                          'Message matching is case-insensitive'
                                        )}
                                      </FormDescription>
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
                              </div>

                              <div className='text-sm font-medium'>
                                {t('Response behavior')}
                              </div>
                              <div className='grid min-w-0 gap-3 md:grid-cols-2'>
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
                                    <FormLabel>
                                      {t('Response message')}
                                    </FormLabel>
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
                          </CollapsibleContent>
                        </Collapsible>
                      )
                    })
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
