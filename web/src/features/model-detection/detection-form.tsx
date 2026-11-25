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
import { CircleHelp, Play, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Controller, useForm, useWatch, type Control } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { PasswordInput } from '@/components/password-input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useApiInfo } from '@/features/dashboard/hooks/use-status-data'
import { getUserGroups, getUserModels } from '@/features/playground/api'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { modelDetectionSchema, type ModelDetectionInput } from './api'

type DetectionFieldProps<Name extends keyof ModelDetectionInput> = {
  name: Name
  label: string
  control: Control<ModelDetectionInput>
  disabled: boolean
}

type DetectionSelectName = 'api_url' | 'group' | 'model' | 'effort'

function DetectionSelect(
  props: DetectionFieldProps<DetectionSelectName> & {
    options: { value: string; label: string }[]
    placeholder?: string
    onChange?: () => void
  }
) {
  const id = `detector-${props.name}`

  return (
    <Field className='min-w-0 gap-1.5'>
      <FieldLabel htmlFor={id} className='text-xs'>
        {props.label}
      </FieldLabel>
      <Controller
        control={props.control}
        name={props.name}
        render={({ field }) => (
          <Select
            value={field.value || null}
            onValueChange={(value) => {
              field.onChange(value ?? '')
              props.onChange?.()
            }}
            disabled={props.disabled}
            items={props.options}
          >
            <SelectTrigger id={id}>
              <SelectValue
                className='min-w-0'
                placeholder={props.placeholder}
              />
            </SelectTrigger>
            <SelectContent
              align='start'
              alignItemWithTrigger={false}
              className='min-w-0'
            >
              <SelectGroup>
                {props.options.map((option) => (
                  <SelectItem value={option.value} key={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      />
    </Field>
  )
}

function DetectionSwitch(
  props: DetectionFieldProps<
    'image' | 'tokenizer' | 'stream' | 'strict' | 'parallel'
  > & {
    description: string
    inverted?: boolean
  }
) {
  const { t } = useTranslation()
  const id = `detector-${props.name}`
  return (
    <Field
      orientation='horizontal'
      className='min-w-0 items-center justify-between gap-2'
    >
      <div className='flex min-w-0 items-center gap-0.5'>
        <FieldLabel htmlFor={id} className='text-sm leading-5'>
          {props.label}
        </FieldLabel>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                className='text-muted-foreground size-6 shrink-0'
                aria-label={t('Help for {{label}}', { label: props.label })}
                aria-describedby={`${id}-help`}
              >
                <CircleHelp aria-hidden='true' />
              </Button>
            }
          />
          <TooltipContent id={`${id}-help`} role='tooltip' className='max-w-72'>
            {props.description}
          </TooltipContent>
        </Tooltip>
      </div>
      <Controller
        control={props.control}
        name={props.name}
        render={({ field }) => (
          <Switch
            id={id}
            className='shrink-0'
            aria-description={props.description}
            checked={props.inverted ? !field.value : field.value}
            onCheckedChange={(checked) =>
              field.onChange(props.inverted ? !checked : checked)
            }
            disabled={props.disabled}
          />
        )}
      />
    </Field>
  )
}

type DetectionFormProps = {
  onSubmit: (input: ModelDetectionInput) => Promise<void>
  onCancel: () => void
  onRefreshSamples: () => void
  samplesReady: boolean
  samplesLoading: boolean
  report: (retryTokenizer?: () => void) => ReactNode
  tokenizerRetry?: {
    target: Pick<ModelDetectionInput, 'model' | 'group' | 'api_url'>
    onSubmit: (input: ModelDetectionInput) => Promise<void>
  }
  samples: ReactNode
}

export function DetectionForm(props: DetectionFormProps) {
  const { t } = useTranslation()
  const form = useForm<ModelDetectionInput>({
    resolver: zodResolver(modelDetectionSchema),
    defaultValues: {
      group: '',
      model: '',
      api_url: '',
      api_key: '',
      parallel: true,
      effort: '',
      stream: true,
      image: false,
      tokenizer: false,
      strict: false,
    },
  })
  const [group, model, apiURL, apiKey] = useWatch({
    control: form.control,
    name: ['group', 'model', 'api_url', 'api_key'],
  })
  const { items: apiInfo } = useApiInfo()
  const addresses = new Map<string, string>()
  for (const item of apiInfo) {
    if (typeof item?.url !== 'string') continue
    const address = item.url.trim().replace(/\/+$/, '')
    if (!address.startsWith('https://') || addresses.has(address)) continue
    addresses.set(address, item.route ? `${item.route} · ${address}` : address)
  }
  const busy = form.formState.isSubmitting
  const controlProps = { control: form.control, disabled: busy }
  const groups = useQuery({
    queryKey: ['playground-groups'],
    queryFn: getUserGroups,
  })
  const models = useQuery({
    queryKey: ['playground-models', group],
    queryFn: () => getUserModels(group),
    enabled: Boolean(group),
  })
  const canReachModel =
    Boolean(model && models.data?.some((option) => option.value === model)) &&
    (!apiURL || (addresses.has(apiURL) && Boolean(apiKey.trim())))
  const canSubmit = canReachModel && props.samplesReady
  const retry = props.tokenizerRetry
  const canRetry =
    canReachModel &&
    !busy &&
    retry?.target.group === group &&
    retry?.target.model === model &&
    retry?.target.api_url === apiURL
  const optionsError = groups.error ?? models.error

  async function submit(input: ModelDetectionInput) {
    if (!canSubmit) return
    await props.onSubmit(input)
  }

  return (
    <form
      className='@container/detection flex min-h-0 min-w-0 flex-1 flex-col'
      onSubmit={form.handleSubmit(submit)}
    >
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto w-full max-w-7xl space-y-3 px-3 py-2 sm:px-6'>
          <Card aria-label={t('Connection settings')} role='region' size='sm'>
            <CardContent className='space-y-3'>
              <div className='grid gap-x-3 gap-y-2 @lg/detection:grid-cols-2 @4xl/detection:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_minmax(0,1.35fr)_minmax(0,0.8fr)]'>
                <DetectionSelect
                  {...controlProps}
                  name='api_url'
                  label={t('API address')}
                  placeholder={t('Current site')}
                  options={[
                    { value: '', label: t('Current site') },
                    ...Array.from(addresses, ([value, label]) => ({
                      value,
                      label,
                    })),
                  ]}
                  onChange={() => form.setValue('api_key', '')}
                />
                <DetectionSelect
                  {...controlProps}
                  name='group'
                  label={t('Group')}
                  placeholder={t('Select a group')}
                  options={groups.data ?? []}
                  disabled={busy || groups.isPending}
                  onChange={() => form.setValue('model', '')}
                />
                <DetectionSelect
                  {...controlProps}
                  name='model'
                  label={t('Model Name')}
                  placeholder={
                    group && models.isSuccess && models.data.length === 0
                      ? t('No model found.')
                      : t('Select Model')
                  }
                  options={models.data ?? []}
                  disabled={
                    busy || !group || models.isPending || !models.data?.length
                  }
                />
                <DetectionSelect
                  {...controlProps}
                  name='effort'
                  label={t('Reasoning Effort')}
                  placeholder={t('Default')}
                  options={[
                    { value: '', label: t('Default') },
                    { value: 'low', label: t('Low') },
                    { value: 'medium', label: t('Medium') },
                    { value: 'high', label: t('High') },
                  ]}
                />
                {apiURL && (
                  <Field className='min-w-0 gap-1.5 @lg/detection:col-span-2'>
                    <FieldLabel htmlFor='detector-api-key' className='text-xs'>
                      {t('API Key')}
                    </FieldLabel>
                    <PasswordInput
                      {...form.register('api_key')}
                      id='detector-api-key'
                      autoComplete='off'
                      aria-describedby='detector-api-key-description'
                      maxLength={256}
                      disabled={busy}
                    />
                    <FieldDescription id='detector-api-key-description'>
                      {t('Use an active API key for the selected group.')}
                    </FieldDescription>
                  </Field>
                )}
              </div>
              {optionsError && (
                <Alert variant='destructive'>
                  <AlertDescription>
                    {getServerErrorMessage(
                      optionsError,
                      t('Failed to load detector options.')
                    )}
                  </AlertDescription>
                </Alert>
              )}
              <FieldSet className='gap-1'>
                <FieldLegend variant='label' className='mb-1'>
                  {t('Sampling options')}
                </FieldLegend>
                <div className='bg-muted/40 grid items-center gap-x-3 gap-y-2 rounded-lg px-2.5 py-2 @lg/detection:grid-cols-2 @4xl/detection:grid-cols-5'>
                  <DetectionSwitch
                    {...controlProps}
                    name='stream'
                    label={t('Streaming output')}
                    description={t(
                      'Receive the upstream response in chunks when on, or all at once when off.'
                    )}
                  />
                  <DetectionSwitch
                    {...controlProps}
                    name='parallel'
                    label={t('Parallel requests')}
                    description={t(
                      'Send all three sample requests together when on, or one at a time when off.'
                    )}
                  />
                  <DetectionSwitch
                    {...controlProps}
                    name='strict'
                    label={t('Relaxed mode')}
                    inverted
                    description={t(
                      'When enabled, streaming stops at the target count and extra numbers are trimmed from non-streamed replies. When disabled, replies must end naturally.'
                    )}
                  />
                  <DetectionSwitch
                    {...controlProps}
                    name='tokenizer'
                    label={t('Tokenizer probe')}
                    description={t(
                      'Send additional requests to identify the tokenizer.'
                    )}
                  />
                  <DetectionSwitch
                    {...controlProps}
                    name='image'
                    label={t('Image mode')}
                    description={t(
                      'Send the challenge as a PNG. The model must accept images.'
                    )}
                  />
                </div>
              </FieldSet>
            </CardContent>
          </Card>
          {props.samples}
          {props.report(
            retry && canRetry ? form.handleSubmit(retry.onSubmit) : undefined
          )}
        </div>
      </div>
      <footer className='bg-background shrink-0 border-t'>
        <div className='mx-auto grid w-full max-w-7xl grid-cols-2 gap-2 px-3 py-1.5 sm:flex sm:justify-end sm:px-6'>
          <Button
            type='button'
            variant='outline'
            disabled={busy || props.samplesLoading}
            onClick={props.onRefreshSamples}
            className='h-auto min-h-9 min-w-0 whitespace-normal'
          >
            <RefreshCw data-icon='inline-start' aria-hidden='true' />
            {t('New sample prompts')}
          </Button>
          {busy ? (
            <Button
              type='button'
              variant='outline'
              onClick={props.onCancel}
              className='min-h-9'
            >
              {t('Cancel')}
            </Button>
          ) : (
            <Button
              type='submit'
              disabled={!canSubmit}
              className='h-auto min-h-9 min-w-0 whitespace-normal'
            >
              <Play data-icon='inline-start' aria-hidden='true' />
              {t('Run detection')}
            </Button>
          )}
        </div>
      </footer>
    </form>
  )
}
