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
import {
  Bot,
  Braces,
  Code2,
  Monitor,
  Hammer,
  Send,
  Sparkles,
  SquareTerminal,
} from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { MultiSelect } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useStatus } from '@/hooks/use-status'
import { getBgColorClass } from '@/lib/colors'
import { DEFAULT_SYSTEM_NAME } from '@/lib/constants'
import { requireServerSuccess } from '@/lib/server-error-message'
import { normalizeSystemLogo } from '@/lib/system-branding'
import { cn } from '@/lib/utils'

import { getApiKeyModels } from '../../api'
import {
  buildCCSwitchURL,
  CC_SWITCH_APP_CONFIGS,
  getCCSwitchUsageBaseUrl,
  getDefaultCCSwitchEndpoint,
  resolveCCSwitchEndpointInfo,
  resolveCCSwitchServerAddress,
  type CCSwitchAppType,
  type CCSwitchApiFormat,
} from '../../lib/cc-switch'

const APP_ICONS = {
  claude: SquareTerminal,
  'claude-desktop': Monitor,
  codex: Code2,
  copilot: Code2,
  gemini: Sparkles,
  agy: Sparkles,
  grokbuild: Hammer,
  opencode: Braces,
  openclaw: Bot,
  hermes: Send,
  pi: SquareTerminal,
  mcode: Code2,
  kimi: SquareTerminal,
  dsh: Code2,
  omp: SquareTerminal,
} satisfies Record<CCSwitchAppType, typeof SquareTerminal>

const API_FORMAT_LABELS = {
  anthropic: 'Anthropic Messages',
  openai_chat: 'OpenAI Chat Completions',
  openai_responses: 'OpenAI Responses',
  gemini_native: 'Gemini Native',
} satisfies Record<CCSwitchApiFormat, string>

const CLAUDE_MODEL_FIELDS = [
  { key: 'model', labelKey: 'Primary Model' },
  { key: 'haikuModel', labelKey: 'Haiku Model' },
  { key: 'sonnetModel', labelKey: 'Sonnet Model' },
  { key: 'opusModel', labelKey: 'Opus Model' },
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tokenId: number
  tokenKey: string
}

interface SelectOption {
  value: string
  label: string
  description?: string
  hint?: string
  icon?: React.ReactNode
}

interface CCSwitchComboboxFieldProps {
  id?: string
  label?: string
  value: string
  options: SelectOption[]
  onValueChange: (value: string) => void
  placeholder?: string
  emptyText: string
  allowCustomValue?: boolean
}

function CCSwitchComboboxField({
  id,
  label,
  value,
  options,
  onValueChange,
  placeholder,
  emptyText,
  allowCustomValue = false,
}: CCSwitchComboboxFieldProps) {
  const optionValues = useMemo(
    () => options.map((option) => option.value),
    [options]
  )
  const optionMap = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options]
  )
  const selectedOption = optionMap.get(value)
  const hasDetailedOptions = options.some(
    (option) => option.description || option.hint || option.icon
  )

  return (
    <Combobox
      items={optionValues}
      value={value || null}
      itemToStringLabel={(optionValue) =>
        optionMap.get(optionValue)?.label ?? optionValue
      }
      itemToStringValue={(optionValue) => optionValue}
      onValueChange={(nextValue) => {
        if (typeof nextValue === 'string') onValueChange(nextValue)
      }}
      inputValue={allowCustomValue ? value : undefined}
      onInputValueChange={(nextValue, details) => {
        if (allowCustomValue && details.reason === 'input-change') {
          onValueChange(nextValue)
        }
      }}
    >
      <ComboboxInput
        id={id}
        triggerAriaLabel={label ?? placeholder}
        className={cn(
          'bg-background h-9 w-full',
          hasDetailedOptions &&
            'hover:border-ring/60 hover:bg-muted/20 [&>input]:cursor-pointer [&>input]:pl-8'
        )}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        readOnly={!allowCustomValue}
      >
        {hasDetailedOptions && selectedOption?.icon ? (
          <span className='pointer-events-none absolute left-3 flex size-3 items-center justify-center'>
            {selectedOption.icon}
          </span>
        ) : null}
      </ComboboxInput>
      <ComboboxContent>
        <ComboboxList className='max-h-64'>
          {(optionValue: string) => {
            const option = optionMap.get(optionValue)
            if (!option) return null

            return (
              <ComboboxItem
                key={optionValue}
                value={optionValue}
                className={cn(
                  'px-2.5 pr-9',
                  hasDetailedOptions ? 'min-h-12 py-1.5' : 'min-h-9 py-1.5'
                )}
              >
                {option.icon ? (
                  <span className='flex size-3.5 shrink-0 items-center justify-center self-start pt-1'>
                    {option.icon}
                  </span>
                ) : null}
                <span className='min-w-0 flex-1'>
                  <span className='block truncate font-medium'>
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className='mt-0.5 flex min-w-0 items-center gap-2'>
                      <span className='text-muted-foreground min-w-0 truncate font-mono text-[11px]'>
                        {option.description}
                      </span>
                      {option.hint ? (
                        <span className='bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none'>
                          {option.hint}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              </ComboboxItem>
            )
          }}
        </ComboboxList>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  )
}

export function CCSwitchDialog(props: Props) {
  const { t, i18n } = useTranslation()
  const { status } = useStatus()
  const serverAddress = resolveCCSwitchServerAddress(
    status,
    window.location.origin
  )
  const endpointInfo = useMemo(
    () => resolveCCSwitchEndpointInfo(status, window.location.origin),
    [status]
  )
  const [app, setApp] = useState<CCSwitchAppType>('claude')
  const [selectedApiFormat, setSelectedApiFormat] =
    useState<CCSwitchApiFormat | null>(null)
  const apiFormat =
    selectedApiFormat ?? CC_SWITCH_APP_CONFIGS[app].defaultApiFormat
  const [additionalModels, setAdditionalModels] = useState<string[]>([])
  const [customName, setCustomName] = useState<string | null>(null)
  const siteTitle = status?.system_name?.trim() || DEFAULT_SYSTEM_NAME
  const defaultName = `${siteTitle} ${CC_SWITCH_APP_CONFIGS[app].label}`
  const name = customName ?? defaultName
  const [models, setModels] = useState<Record<string, string>>({})
  const [endpointAddress, setEndpointAddress] = useState<string>(
    endpointInfo[0].url
  )
  const [usageAddress, setUsageAddress] = useState<string | null>(null)

  const { data: modelsData, isFetching: modelsFetching } = useQuery({
    queryKey: ['api-key-models-ccswitch', props.tokenId],
    queryFn: async () =>
      requireServerSuccess(await getApiKeyModels(props.tokenId)),
    enabled: props.open && props.tokenId > 0,
  })

  const modelOptions = useMemo(() => {
    if (modelsFetching) return []
    const items = modelsData?.data ?? []
    return items.map((m) => ({ value: m, label: m }))
  }, [modelsData?.data, modelsFetching])

  useEffect(() => {
    if (props.open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModels({})

      setApp('claude')
      setSelectedApiFormat(null)
      setAdditionalModels([])

      setCustomName(null)

      setEndpointAddress(endpointInfo[0].url)
      setUsageAddress(null)
    }
  }, [endpointInfo, props.open])

  const currentConfig = CC_SWITCH_APP_CONFIGS[app]
  const isClaude = app === 'claude' || app === 'claude-desktop'
  const modelRequired = !isClaude || apiFormat !== 'anthropic'
  const modelFields = isClaude
    ? CLAUDE_MODEL_FIELDS
    : [{ key: 'model', labelKey: 'Primary Model' }]
  const requiresRouting =
    (isClaude && apiFormat !== 'anthropic') ||
    ((app === 'codex' || app === 'grokbuild') &&
      apiFormat !== 'openai_responses')
  const endpointOptions = endpointInfo.map((item) => ({
    value: item.url,
    label: item.route || item.url,
    description: item.url,
    hint: item.description,
    icon: item.color ? (
      <span
        className={cn('block size-2 rounded-full', getBgColorClass(item.color))}
      />
    ) : undefined,
  }))
  const usageOptions = [
    ...new Set(
      [...endpointInfo.map((item) => item.url), serverAddress].map(
        getCCSwitchUsageBaseUrl
      )
    ),
  ].map((url) => ({ value: url, label: url }))

  const handleAppChange = (val: string) => {
    const appVal = val as CCSwitchAppType
    setApp(appVal)
    setSelectedApiFormat(null)
    setAdditionalModels([])
    setCustomName(null)
    setModels({})
  }

  const handleSubmit = () => {
    if (modelRequired && !models.model?.trim()) {
      toast.warning(t('Please select a primary model'))
      return
    }
    const key = props.tokenKey.startsWith('sk-')
      ? props.tokenKey
      : `sk-${props.tokenKey}`
    const url = buildCCSwitchURL({
      app,
      apiFormat,
      name,
      models,
      additionalModels,
      apiKey: key,
      serverAddress,
      iconUrl: normalizeSystemLogo(status?.logo),
      endpoint: getDefaultCCSwitchEndpoint(app, endpointAddress, apiFormat),
      usageBaseUrl: usageAddress ?? getCCSwitchUsageBaseUrl(endpointAddress),
      language: i18n.resolvedLanguage || i18n.language,
    })
    window.open(url, '_blank')
    props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Import to CC Switch')}
      description={t('Requires CC Switch v4.0.29 or later.')}
      contentClassName='sm:max-w-4xl'
      contentHeight='auto'
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleSubmit}>{t('Open CC Switch')}</Button>
        </>
      }
    >
      <div className='grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)] md:items-start'>
        <div className='min-w-0 space-y-2'>
          <p
            id='cc-switch-app-label'
            className='text-muted-foreground text-xs font-medium'
          >
            {t('Application')}
          </p>
          <RadioGroup
            aria-labelledby='cc-switch-app-label'
            value={app}
            onValueChange={handleAppChange}
            className='bg-muted/50 grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-xl p-1.5 md:max-h-[30rem] md:grid-cols-1'
          >
            {(
              Object.entries(CC_SWITCH_APP_CONFIGS) as [
                CCSwitchAppType,
                (typeof CC_SWITCH_APP_CONFIGS)[CCSwitchAppType],
              ][]
            ).map(([key, cfg]) => {
              const Icon = APP_ICONS[key]
              return (
                <Label
                  key={key}
                  htmlFor={`app-${key}`}
                  className={cn(
                    'text-muted-foreground hover:bg-background/60 hover:text-foreground focus-within:ring-ring flex min-h-9 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-[background-color,color,box-shadow] focus-within:ring-2 focus-within:ring-inset',
                    app === key &&
                      'bg-background text-foreground shadow-sm dark:bg-background/80'
                  )}
                >
                  <RadioGroupItem
                    value={key}
                    id={`app-${key}`}
                    className='sr-only'
                  />
                  <Icon className='size-4 shrink-0' strokeWidth={1.8} />
                  <span className='min-w-0 leading-4 break-words'>
                    {cfg.label}
                  </span>
                </Label>
              )
            })}
          </RadioGroup>
        </div>

        <FieldGroup className='min-w-0 gap-5'>
          <Field>
            <FieldLabel htmlFor='cc-switch-name'>{t('Name')}</FieldLabel>
            <Input
              id='cc-switch-name'
              value={name}
              onChange={(event) => setCustomName(event.target.value)}
              placeholder={defaultName}
              className='bg-background h-9 min-w-0'
            />
          </Field>

          <div className='grid gap-4 sm:grid-cols-2'>
            <Field className='min-w-0'>
              <FieldLabel htmlFor='cc-switch-endpoint'>
                {t('API Endpoint')}
              </FieldLabel>
              <CCSwitchComboboxField
                id='cc-switch-endpoint'
                label={t('API Endpoint')}
                options={endpointOptions}
                value={endpointAddress}
                onValueChange={setEndpointAddress}
                placeholder={t('API Endpoint')}
                emptyText={t('No matching items')}
              />
              <FieldDescription className='text-xs break-all'>
                {getDefaultCCSwitchEndpoint(app, endpointAddress, apiFormat)}
              </FieldDescription>
            </Field>

            <Field className='min-w-0'>
              <FieldLabel htmlFor='cc-switch-api-format'>
                {t('API Format')}
              </FieldLabel>
              <CCSwitchComboboxField
                id='cc-switch-api-format'
                label={t('API Format')}
                options={currentConfig.apiFormats.map((format) => ({
                  value: format,
                  label: t(API_FORMAT_LABELS[format]),
                }))}
                value={apiFormat}
                onValueChange={(value) =>
                  setSelectedApiFormat(value as CCSwitchApiFormat)
                }
                emptyText={t('No matching items')}
              />
              {requiresRouting && (
                <FieldDescription className='text-xs'>
                  {t('This format requires CC Switch routing.')}
                </FieldDescription>
              )}
            </Field>
          </div>

          <FieldSet className='min-w-0 gap-3 border-t pt-4'>
            <FieldLegend variant='label'>{t('Models')}</FieldLegend>
            <div className='grid gap-4 sm:grid-cols-2'>
              {modelFields.map((field) => (
                <Field
                  key={field.key}
                  className={cn('min-w-0', !isClaude && 'sm:col-span-2')}
                >
                  <FieldLabel htmlFor={`cc-switch-${field.key}`}>
                    {t(field.labelKey)}
                    {field.key === 'model' && modelRequired && (
                      <span className='text-destructive ml-0.5'>*</span>
                    )}
                  </FieldLabel>
                  <CCSwitchComboboxField
                    id={`cc-switch-${field.key}`}
                    label={t(field.labelKey)}
                    options={modelOptions}
                    value={models[field.key] || ''}
                    onValueChange={(v) =>
                      setModels((prev) => ({ ...prev, [field.key]: v ?? '' }))
                    }
                    placeholder={t('Select or enter model name')}
                    emptyText={t('No models found')}
                    allowCustomValue
                  />
                </Field>
              ))}
            </div>
            {!modelRequired && (
              <FieldDescription className='text-xs'>
                {t("Leave blank to use the client's default models.")}
              </FieldDescription>
            )}
            {app === 'copilot' && (
              <Field>
                <FieldLabel htmlFor='cc-switch-additional-models'>
                  {t('Additional Models')}
                </FieldLabel>
                <MultiSelect
                  id='cc-switch-additional-models'
                  options={modelOptions.filter(
                    (option) => option.value !== models.model?.trim()
                  )}
                  selected={additionalModels}
                  onChange={setAdditionalModels}
                  placeholder={t('Select or enter additional models')}
                  emptyText={t('No models found')}
                  maxVisibleChips={3}
                  allowCreate
                />
              </Field>
            )}
          </FieldSet>
          <Field className='border-t pt-4'>
            <FieldLabel htmlFor='cc-switch-usage-address'>
              {t('Balance Query Address')}
            </FieldLabel>
            <CCSwitchComboboxField
              id='cc-switch-usage-address'
              label={t('Balance Query Address')}
              options={usageOptions}
              value={usageAddress ?? getCCSwitchUsageBaseUrl(endpointAddress)}
              onValueChange={setUsageAddress}
              emptyText={t('No matching items')}
            />
            <FieldDescription className='text-xs'>
              {t('This address must serve /api/usage/token/.')}
            </FieldDescription>
          </Field>
        </FieldGroup>
      </div>
    </Dialog>
  )
}
