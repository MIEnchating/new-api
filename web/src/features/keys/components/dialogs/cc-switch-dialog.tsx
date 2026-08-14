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
  Hammer,
  Send,
  Sparkles,
  SquareTerminal,
} from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useStatus } from '@/hooks/use-status'
import { getBgColorClass } from '@/lib/colors'
import { cn } from '@/lib/utils'

import { getApiKeyModels } from '../../api'
import {
  buildCCSwitchURL,
  getDefaultCCSwitchEndpoint,
  resolveCCSwitchEndpointInfo,
  resolveCCSwitchServerAddress,
  type CCSwitchAppType,
} from '../../lib/cc-switch'

const APP_CONFIGS = {
  claude: {
    label: 'Claude Code',
    icon: SquareTerminal,
    defaultName: 'Claude Code',
    modelFields: [
      { key: 'model', labelKey: 'Primary Model', required: true },
      { key: 'haikuModel', labelKey: 'Haiku Model', required: false },
      { key: 'sonnetModel', labelKey: 'Sonnet Model', required: false },
      { key: 'opusModel', labelKey: 'Opus Model', required: false },
    ],
  },
  codex: {
    label: 'Codex',
    icon: Code2,
    defaultName: 'Codex',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
  gemini: {
    label: 'Gemini CLI',
    icon: Sparkles,
    defaultName: 'Gemini CLI',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
  grokbuild: {
    label: 'Grok Build',
    icon: Hammer,
    defaultName: 'Grok Build',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
  opencode: {
    label: 'OpenCode',
    icon: Braces,
    defaultName: 'OpenCode',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
  openclaw: {
    label: 'OpenClaw',
    icon: Bot,
    defaultName: 'OpenClaw',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
  hermes: {
    label: 'Hermes',
    icon: Send,
    defaultName: 'Hermes',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
} as const

type AppType = keyof typeof APP_CONFIGS & CCSwitchAppType

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
  value: string
  options: SelectOption[]
  onValueChange: (value: string) => void
  placeholder?: string
  emptyText: string
  allowCustomValue?: boolean
}

function CCSwitchComboboxField({
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
      {...(allowCustomValue
        ? {
            inputValue: value,
            onInputValueChange: onValueChange,
          }
        : {})}
    >
      <ComboboxInput
        className={cn(
          'bg-background h-9 w-full',
          hasDetailedOptions &&
            'hover:border-ring/60 hover:bg-muted/20 [&>input]:cursor-pointer [&>input]:pl-8'
        )}
        placeholder={placeholder}
        aria-label={placeholder}
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
          {optionValues.map((optionValue) => {
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
          })}
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
  const [app, setApp] = useState<AppType>('claude')
  const [name, setName] = useState<string>(APP_CONFIGS.claude.defaultName)
  const [models, setModels] = useState<Record<string, string>>({})
  const [endpointAddress, setEndpointAddress] = useState<string>(
    endpointInfo[0].url
  )

  const { data: modelsData, isFetching: modelsFetching } = useQuery({
    queryKey: ['api-key-models-ccswitch', props.tokenId],
    queryFn: () => getApiKeyModels(props.tokenId),
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

      setName(APP_CONFIGS.claude.defaultName)

      setEndpointAddress(endpointInfo[0].url)
    }
  }, [endpointInfo, props.open])

  const currentConfig = APP_CONFIGS[app]
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

  const handleAppChange = (val: string) => {
    const appVal = val as AppType
    setApp(appVal)
    setName(APP_CONFIGS[appVal].defaultName)
    setModels({})
  }

  const handleSubmit = () => {
    if (!models.model) {
      toast.warning(t('Please select a primary model'))
      return
    }
    const key = props.tokenKey.startsWith('sk-')
      ? props.tokenKey
      : `sk-${props.tokenKey}`
    const url = buildCCSwitchURL({
      app,
      name,
      models,
      apiKey: key,
      serverAddress,
      endpoint: getDefaultCCSwitchEndpoint(app, endpointAddress),
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
      contentClassName='sm:max-w-3xl'
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
      <div className='grid gap-5 md:min-h-[21.25rem] md:grid-cols-[12rem_minmax(0,1fr)] md:items-stretch'>
        <div className='md:h-full'>
          <RadioGroup
            value={app}
            onValueChange={handleAppChange}
            className='bg-muted/60 grid grid-cols-2 gap-1 rounded-lg p-1 md:h-full md:grid-cols-1 md:content-between'
          >
            {(
              Object.entries(APP_CONFIGS) as [
                AppType,
                (typeof APP_CONFIGS)[AppType],
              ][]
            ).map(([key, cfg]) => (
              <Label
                key={key}
                htmlFor={`app-${key}`}
                className={cn(
                  'text-muted-foreground hover:text-foreground flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-md px-3 text-xs font-medium transition-[background-color,color,box-shadow] md:justify-start',
                  app === key &&
                    'bg-background text-foreground shadow-sm dark:bg-background/80'
                )}
              >
                <RadioGroupItem
                  value={key}
                  id={`app-${key}`}
                  className='sr-only'
                />
                <cfg.icon className='size-4 shrink-0' strokeWidth={1.8} />
                <span className='min-w-0 truncate'>{cfg.label}</span>
              </Label>
            ))}
          </RadioGroup>
        </div>

        <div className='border-border divide-border min-w-0 divide-y overflow-hidden rounded-lg border md:h-full'>
          <div className='grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 px-3 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)]'>
            <Label htmlFor='cc-switch-name' className='text-muted-foreground'>
              {t('Name')}
            </Label>
            <Input
              id='cc-switch-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={currentConfig.defaultName}
              className='bg-background h-9 min-w-0'
            />
          </div>

          {endpointOptions.length > 1 && (
            <div className='grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 px-3 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)]'>
              <Label className='text-muted-foreground'>
                {t('API Endpoint')}
              </Label>
              <CCSwitchComboboxField
                options={endpointOptions}
                value={endpointAddress}
                onValueChange={setEndpointAddress}
                placeholder={t('API Endpoint')}
                emptyText={t('No matching items')}
              />
            </div>
          )}

          {currentConfig.modelFields.map((field) => (
            <div
              key={field.key}
              className='grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 px-3 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)]'
            >
              <Label className='text-muted-foreground'>
                {t(field.labelKey)}
                {field.required && (
                  <span className='text-destructive ml-0.5'>*</span>
                )}
              </Label>
              <CCSwitchComboboxField
                options={modelOptions}
                value={models[field.key] || ''}
                onValueChange={(v) =>
                  setModels((prev) => ({ ...prev, [field.key]: v }))
                }
                placeholder={t('Select or enter model name')}
                emptyText={t('No models found')}
                allowCustomValue
              />
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
