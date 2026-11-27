import { zodResolver } from '@hookform/resolvers/zod'
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
import { Add01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Reorder } from 'motion/react'
import { useState } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { MultiSelect } from '@/components/multi-select'
import { TimePicker } from '@/components/time-picker'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { TitledCard } from '@/components/ui/titled-card'
import {
  getIntelligenceMonitor,
  intelligenceConfigSchema,
  intelligenceQueryKey,
  runIntelligenceTest,
  saveIntelligenceConfig,
  type IntelligenceConfig,
  type IntelligenceMonitorData,
} from '@/features/status-monitor/intelligence-api'
import {
  getIntelligenceEndpointOptions,
  getIntelligenceQuestionName,
} from '@/features/status-monitor/intelligence-labels'
import { cn } from '@/lib/utils'

import {
  SettingsControlGroup,
  SettingsForm,
  SettingsSwitchField,
} from '../components/settings-form-layout'
import {
  SettingsPageActionsPortal,
  SettingsPageFormActions,
} from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { IntelligenceGroupCard } from './intelligence-group-card'
import { IntelligenceHistory } from './intelligence-history'

export function IntelligenceSettingsSection() {
  const query = useQuery({
    queryKey: intelligenceQueryKey,
    queryFn: getIntelligenceMonitor,
    refetchInterval: (query) =>
      query.state.data?.history.some(
        (task) => task.status === 'pending' || task.status === 'running'
      )
        ? 3000
        : 30000,
    meta: { errorToast: false },
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return <IntelligenceSettings data={query.data} />
}

function intelligenceFormValues(
  config: IntelligenceConfig
): IntelligenceConfig {
  const allQuestionIndexes = config.questions.map((_, index) => index)
  return {
    ...config,
    groups: config.groups.map((group) => ({
      ...group,
      mode: group.mode ?? 'local',
      benchmark: group.benchmark ?? 'candy',
      models: group.models?.length
        ? group.models
        : group.model
          ? [group.model]
          : [],
      reasoning_effort: group.reasoning_effort || 'low',
      question_indexes: group.question_indexes ?? [...allQuestionIndexes],
    })),
  }
}

export function IntelligenceSettings(props: { data: IntelligenceMonitorData }) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<
    'settings' | 'questions' | 'history'
  >('settings')
  const [removeTarget, setRemoveTarget] = useState<{
    type: 'group' | 'question'
    id: string
  } | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({})
  const queryClient = useQueryClient()
  const endpoints = getIntelligenceEndpointOptions(t)
  const benchmarks = [
    { value: 'candy', label: t('Candy test') },
    { value: 'pelican', label: t('Pelican test') },
    { value: 'creative', label: t('Creative test') },
  ]
  const reasoningOptions = [
    { value: 'low', label: t('Low') },
    { value: 'medium', label: t('Medium') },
    { value: 'high', label: t('High') },
  ]
  const groupOptions = (
    props.data.group_order ?? Object.keys(props.data.catalog).sort()
  ).map((value) => ({ value, label: value }))
  const form = useForm<IntelligenceConfig>({
    resolver: zodResolver(intelligenceConfigSchema),
    defaultValues: intelligenceFormValues(props.data.config),
  })
  const questions = useFieldArray({ control: form.control, name: 'questions' })
  const groups = useFieldArray({ control: form.control, name: 'groups' })
  const groupIds = groups.fields.map((entry) => entry.id)
  const selectedGroups = form.watch('groups')
  const selectedQuestions = form.watch('questions')
  const questionOptions = selectedQuestions.map((question, index) => ({
    value: String(index),
    label:
      getIntelligenceQuestionName(question.name, t) ||
      t('Question {{number}}', { number: index + 1 }),
  }))
  const save = useMutation({
    mutationFn: saveIntelligenceConfig,
    onSuccess: (config) => {
      form.reset(intelligenceFormValues(config))
      toast.success(t('Saved successfully'))
      void queryClient.invalidateQueries({
        queryKey: ['status-monitor', 'intelligence'],
      })
    },
  })
  const run = useMutation({
    mutationFn: runIntelligenceTest,
    onSuccess: () => {
      toast.success(t('Intelligence test queued'))
      void queryClient.invalidateQueries({
        queryKey: ['status-monitor', 'intelligence'],
      })
    },
  })
  const pending = save.isPending || run.isPending
  const onSubmit = form.handleSubmit(
    (config) =>
      save.mutate({
        ...config,
        groups: config.groups.map((group) => ({
          ...group,
          reasoning_effort: group.reasoning_effort || 'low',
        })),
      }),
    (errors) => {
      setCollapsedGroups({})
      setActiveTab(errors.questions ? 'questions' : 'settings')
    }
  )

  return (
    <SettingsSection title={t('Intelligence testing')}>
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (
            value === 'settings' ||
            value === 'questions' ||
            value === 'history'
          ) {
            setActiveTab(value)
          }
        }}
        className='min-w-0 gap-4'
      >
        <TabsList
          aria-label={t('Intelligence testing')}
          className='min-h-9 max-w-full flex-wrap group-data-horizontal/tabs:h-auto'
        >
          <TabsTrigger value='settings' className='h-8 px-4'>
            {t('Settings')}
          </TabsTrigger>
          <TabsTrigger value='questions' className='h-8 px-4'>
            {t('Question bank')}
          </TabsTrigger>
          <TabsTrigger value='history' className='h-8 px-4'>
            {t('Intelligence test history')}
          </TabsTrigger>
        </TabsList>
        <SettingsForm
          onSubmit={onSubmit}
          hidden={activeTab === 'history'}
          className='@container gap-y-4'
        >
          {activeTab !== 'history' && (
            <>
              <SettingsPageFormActions
                onSave={onSubmit}
                saveLabel='Save'
                isSaving={save.isPending}
                isSaveDisabled={pending}
              />
              <SettingsPageActionsPortal>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => run.mutate(undefined)}
                  disabled={
                    pending ||
                    form.formState.isDirty ||
                    !selectedGroups.every(
                      (group) => group.models?.length || group.model
                    )
                  }
                >
                  {t('Run all groups')}
                </Button>
              </SettingsPageActionsPortal>
            </>
          )}
          <TabsContent
            value='settings'
            keepMounted
            className='min-w-0 space-y-4'
          >
            <section aria-label={t('Test groups')} className='min-w-0'>
              <div className='mb-3 flex flex-wrap items-center justify-between gap-3'>
                <div className='min-w-0 space-y-1'>
                  <h3 className='text-base font-semibold'>
                    {t('Test groups')}
                  </h3>
                  <FieldDescription className='text-xs'>
                    {t(
                      'Model requests from intelligence tests may incur charges.'
                    )}
                  </FieldDescription>
                </div>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='h-7 text-xs'
                  disabled={pending || groups.fields.length >= 50}
                  onClick={() =>
                    groups.append({
                      group: '',
                      model: '',
                      models: [],
                      endpoint: 'openai-response',
                      mode: 'local',
                      enabled: false,
                      times: ['09:00'],
                      question_indexes: selectedQuestions.map(
                        (_, index) => index
                      ),
                    })
                  }
                >
                  <HugeiconsIcon
                    icon={Add01Icon}
                    strokeWidth={2}
                    data-icon='inline-start'
                    aria-hidden='true'
                  />
                  {t('Add test group')}
                </Button>
              </div>
              <Reorder.Group
                axis='xy'
                values={groupIds}
                onReorder={(next) => {
                  if (pending) return
                  const first = groupIds.findIndex(
                    (id, index) => id !== next[index]
                  )
                  if (first < 0) return
                  let last = groupIds.length - 1
                  while (groupIds[last] === next[last]) last--
                  // Motion moves one item at a time. Keep the form field IDs
                  // and mounted editors intact by moving that field in place.
                  if (groupIds[last] === next[first]) groups.move(last, first)
                  else groups.move(first, last)
                }}
                className={cn(
                  'grid min-w-0 items-start gap-4',
                  groups.fields.length > 1 && '@min-[70rem]:grid-cols-2'
                )}
              >
                {groups.fields.map((entry, index) => (
                  <IntelligenceGroupCard
                    key={entry.id}
                    id={entry.id}
                    label={selectedGroups[index].group || t('Model Group')}
                    title={
                      selectedGroups[index].group ||
                      t('Test group {{number}}', { number: index + 1 })
                    }
                    index={index}
                    count={groups.fields.length}
                    open={!collapsedGroups[entry.id]}
                    onOpenChange={(open) =>
                      setCollapsedGroups((current) => ({
                        ...current,
                        [entry.id]: !open,
                      }))
                    }
                    pending={pending}
                    runDisabled={
                      pending ||
                      form.formState.isDirty ||
                      !selectedGroups[index].group ||
                      (selectedGroups[index].mode !== 'external' &&
                        selectedGroups[index].question_indexes?.length === 0) ||
                      !(
                        selectedGroups[index].models?.length ||
                        selectedGroups[index].model
                      )
                    }
                    onRun={() => run.mutate(selectedGroups[index].group)}
                    onRemove={() =>
                      setRemoveTarget({ type: 'group', id: entry.id })
                    }
                    onMove={(direction) =>
                      groups.move(index, index + (direction === 'up' ? -1 : 1))
                    }
                  >
                    <div className='grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 @min-[28rem]:grid-cols-2'>
                      <Field>
                        <FieldLabel htmlFor={`intelligence-mode-${entry.id}`}>
                          {t('Intelligence test source')}
                        </FieldLabel>
                        <Controller
                          name={`groups.${index}.mode`}
                          control={form.control}
                          render={({ field }) => (
                            <Select
                              value={field.value ?? 'local'}
                              items={[
                                {
                                  value: 'local',
                                  label: t('Local question bank'),
                                },
                                {
                                  value: 'external',
                                  label: t('Manxue AI'),
                                },
                              ]}
                              onValueChange={(value) =>
                                value !== null && field.onChange(value)
                              }
                              disabled={pending}
                            >
                              <SelectTrigger
                                id={`intelligence-mode-${entry.id}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent alignItemWithTrigger={false}>
                                <SelectItem value='local'>
                                  {t('Local question bank')}
                                </SelectItem>
                                <SelectItem value='external'>
                                  {t('Manxue AI')}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </Field>
                      <Field className='min-w-0'>
                        <FieldLabel htmlFor={`intelligence-group-${entry.id}`}>
                          {t('Model Group')}
                        </FieldLabel>
                        <Select
                          value={selectedGroups[index].group || null}
                          items={groupOptions}
                          onValueChange={(value) => {
                            if (value === null) return
                            form.setValue(`groups.${index}.group`, value, {
                              shouldDirty: true,
                            })
                            form.setValue(`groups.${index}.models`, [], {
                              shouldDirty: true,
                            })
                            form.setValue(`groups.${index}.model`, '', {
                              shouldDirty: true,
                            })
                          }}
                          disabled={pending}
                        >
                          <SelectTrigger id={`intelligence-group-${entry.id}`}>
                            <SelectValue placeholder={t('Select group')} />
                          </SelectTrigger>
                          <SelectContent alignItemWithTrigger={false}>
                            {groupOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <div className='grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 @min-[28rem]:grid-cols-2'>
                      <Field
                        className='min-w-0'
                        data-invalid={Boolean(
                          form.formState.errors.groups?.[index]?.models
                        )}
                      >
                        <FieldLabel htmlFor={`intelligence-models-${entry.id}`}>
                          {t('Models')}
                        </FieldLabel>
                        <Controller
                          name={`groups.${index}.models`}
                          control={form.control}
                          render={({ field }) => (
                            <MultiSelect
                              id={`intelligence-models-${entry.id}`}
                              className='h-8 flex-nowrap [&_[data-slot=combobox-chip]]:min-w-0'
                              options={(
                                props.data.catalog[
                                  selectedGroups[index].group
                                ] ?? []
                              ).map((value) => ({ value, label: value }))}
                              selected={field.value ?? []}
                              onChange={(values) => {
                                field.onChange(values)
                                form.setValue(`groups.${index}.model`, '', {
                                  shouldDirty: true,
                                })
                              }}
                              placeholder={t('Select models')}
                              emptyText={t('No models found')}
                              renderSelectedSummary={
                                (field.value?.length ?? 0) > 1
                                  ? ([first, ...rest]) => (
                                      <span className='flex min-w-0 items-center gap-1.5'>
                                        <span
                                          className='truncate'
                                          title={first}
                                        >
                                          {first}
                                        </span>
                                        <span className='shrink-0'>
                                          {t('+{{count}} more', {
                                            count: rest.length,
                                          })}
                                        </span>
                                      </span>
                                    )
                                  : undefined
                              }
                              disabled={pending || !selectedGroups[index].group}
                            />
                          )}
                        />
                        <FieldError>
                          {form.formState.errors.groups?.[index]?.models &&
                            t(
                              'Select between 1 and 50 models for intelligence testing'
                            )}
                        </FieldError>
                      </Field>
                      <Field className='min-w-0'>
                        <FieldLabel
                          htmlFor={`intelligence-endpoint-${entry.id}`}
                        >
                          {t('API Endpoint')}
                        </FieldLabel>
                        <Controller
                          name={`groups.${index}.endpoint`}
                          control={form.control}
                          render={({ field }) => (
                            <Select
                              name={field.name}
                              value={
                                selectedGroups[index].mode === 'external'
                                  ? 'openai-response'
                                  : field.value
                              }
                              items={endpoints}
                              onValueChange={(value) =>
                                value !== null && field.onChange(value)
                              }
                              disabled={
                                pending ||
                                selectedGroups[index].mode === 'external'
                              }
                            >
                              <SelectTrigger
                                className='py-1.5 data-[size=default]:h-auto data-[size=default]:min-h-8'
                                id={`intelligence-endpoint-${entry.id}`}
                                ref={field.ref}
                                onBlur={field.onBlur}
                                aria-invalid={Boolean(
                                  form.formState.errors.groups?.[index]
                                    ?.endpoint
                                )}
                              >
                                <SelectValue className='line-clamp-none! block! min-w-0 wrap-anywhere whitespace-normal' />
                              </SelectTrigger>
                              <SelectContent
                                align='start'
                                alignItemWithTrigger={false}
                                className='w-max max-w-(--available-width) min-w-[min(var(--anchor-width),var(--available-width))]'
                              >
                                {endpoints.map((endpoint) => (
                                  <SelectItem
                                    key={endpoint.value}
                                    value={endpoint.value}
                                    className='*:data-[slot=select-item-text]:min-w-0 *:data-[slot=select-item-text]:wrap-anywhere *:data-[slot=select-item-text]:whitespace-normal'
                                  >
                                    {endpoint.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </Field>
                    </div>
                    <div className='grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 @min-[28rem]:grid-cols-2'>
                      {selectedGroups[index].mode === 'external' ? (
                        <Field key='benchmark'>
                          <FieldLabel
                            htmlFor={`external-benchmark-${entry.id}`}
                          >
                            {t('External test type')}
                          </FieldLabel>
                          <Controller
                            name={`groups.${index}.benchmark`}
                            control={form.control}
                            render={({ field }) => (
                              <Select
                                value={field.value ?? 'candy'}
                                items={benchmarks}
                                onValueChange={(value) =>
                                  value !== null && field.onChange(value)
                                }
                                disabled={pending}
                              >
                                <SelectTrigger
                                  id={`external-benchmark-${entry.id}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent alignItemWithTrigger={false}>
                                  {benchmarks.map(({ value, label }) => (
                                    <SelectItem key={value} value={value}>
                                      {label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </Field>
                      ) : (
                        <Field
                          key='questions'
                          data-invalid={Boolean(
                            form.formState.errors.groups?.[index]
                              ?.question_indexes
                          )}
                        >
                          <FieldLabel
                            htmlFor={`intelligence-questions-${entry.id}`}
                          >
                            {t('Test questions')}
                          </FieldLabel>
                          <Controller
                            name={`groups.${index}.question_indexes`}
                            control={form.control}
                            render={({ field }) => (
                              <MultiSelect
                                id={`intelligence-questions-${entry.id}`}
                                placeholder={t('Test questions')}
                                options={questionOptions}
                                selected={
                                  field.value?.map(String) ??
                                  questionOptions.map(({ value }) => value)
                                }
                                onChange={(values) =>
                                  form.setValue(
                                    field.name,
                                    values.map(Number).sort((a, b) => a - b),
                                    {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                    }
                                  )
                                }
                                renderSelectedSummary={(values) =>
                                  t('{{count}} selected', {
                                    count: values.length,
                                  })
                                }
                                disabled={pending}
                              />
                            )}
                          />
                          <FieldError>
                            {form.formState.errors.groups?.[index]
                              ?.question_indexes &&
                              t(
                                'Select at least one valid, unique question for each group'
                              )}
                          </FieldError>
                        </Field>
                      )}
                      <Field className='min-w-0'>
                        <FieldLabel
                          htmlFor={`intelligence-reasoning-${entry.id}`}
                        >
                          {t('Reasoning Effort')}
                        </FieldLabel>
                        <Controller
                          name={`groups.${index}.reasoning_effort`}
                          control={form.control}
                          render={({ field }) => (
                            <Select
                              value={field.value || 'low'}
                              items={reasoningOptions}
                              onValueChange={(value) =>
                                value !== null && field.onChange(value)
                              }
                              disabled={pending}
                            >
                              <SelectTrigger
                                id={`intelligence-reasoning-${entry.id}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent alignItemWithTrigger={false}>
                                {reasoningOptions.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </Field>
                    </div>
                    <SettingsControlGroup className='bg-muted/30 rounded-lg border-0 px-3 py-2'>
                      <Controller
                        name={`groups.${index}.enabled`}
                        control={form.control}
                        render={({ field }) => (
                          <SettingsSwitchField
                            controlId={`intelligence-schedule-${entry.id}`}
                            label={t('Scheduled intelligence testing')}
                            className='py-0'
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={pending}
                          />
                        )}
                      />
                      {selectedGroups[index].enabled && (
                        <Controller
                          name={`groups.${index}.times`}
                          control={form.control}
                          render={({ field }) => (
                            <Field className='border-t pt-3'>
                              <FieldLabel>
                                {t('Daily execution times (Beijing time)')}
                              </FieldLabel>
                              <div className='flex flex-wrap items-center gap-2'>
                                {field.value.map((time, timeIndex) => (
                                  <div
                                    key={timeIndex}
                                    className='bg-background flex items-center rounded-lg border p-0.5'
                                  >
                                    <TimePicker
                                      value={time}
                                      showIcon={false}
                                      className='w-28 border-transparent bg-transparent px-2 shadow-none'
                                      aria-label={t(
                                        'Execution time {{number}}',
                                        {
                                          number: timeIndex + 1,
                                        }
                                      )}
                                      disabled={pending}
                                      onChange={(value) =>
                                        field.onChange(
                                          field.value.map((current, i) =>
                                            i === timeIndex ? value : current
                                          )
                                        )
                                      }
                                    />
                                    <Button
                                      type='button'
                                      variant='ghost'
                                      size='icon-sm'
                                      aria-label={t('Remove time')}
                                      title={t('Remove time')}
                                      disabled={pending}
                                      onClick={() =>
                                        field.onChange(
                                          field.value.filter(
                                            (_, i) => i !== timeIndex
                                          )
                                        )
                                      }
                                    >
                                      <HugeiconsIcon
                                        icon={Cancel01Icon}
                                        strokeWidth={2}
                                        aria-hidden='true'
                                      />
                                    </Button>
                                  </div>
                                ))}
                                <Button
                                  type='button'
                                  variant='outline'
                                  size='sm'
                                  disabled={pending || field.value.length >= 24}
                                  onClick={() =>
                                    field.onChange([...field.value, '09:00'])
                                  }
                                >
                                  <HugeiconsIcon
                                    icon={Add01Icon}
                                    strokeWidth={2}
                                    data-icon='inline-start'
                                    aria-hidden='true'
                                  />
                                  {t('Add time')}
                                </Button>
                              </div>
                            </Field>
                          )}
                        />
                      )}
                    </SettingsControlGroup>
                  </IntelligenceGroupCard>
                ))}
              </Reorder.Group>

              <FieldDescription className='col-span-full text-xs leading-relaxed'>
                {t('Missed schedules are skipped while the server is offline.')}
              </FieldDescription>
            </section>
          </TabsContent>
          <TabsContent
            value='questions'
            keepMounted
            className='min-w-0 space-y-4'
          >
            <section aria-label={t('Question bank')} className='min-w-0'>
              <TitledCard
                title={t('Question bank')}
                action={
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='h-7 text-xs'
                    disabled={pending || questions.fields.length >= 5}
                    onClick={() => questions.append({ name: '', prompt: '' })}
                  >
                    <HugeiconsIcon
                      icon={Add01Icon}
                      strokeWidth={2}
                      data-icon='inline-start'
                      aria-hidden='true'
                    />
                    {t('Add question')}
                  </Button>
                }
                className='min-w-0 border shadow-none ring-0'
                headerClassName='bg-muted/20 px-4 py-3! [&>div]:flex-row [&>div]:items-center [&>div>div:last-child]:w-auto'
                titleClassName='text-sm font-semibold sm:text-sm'
                contentClassName='p-4 sm:p-4'
                disableHoverEffect
              >
                <div className='flex flex-col gap-4'>
                  {questions.fields.map((question, index) => (
                    <FieldGroup
                      key={question.id}
                      className='min-w-0 gap-3 not-first:border-t not-first:pt-4'
                    >
                      <Field>
                        <FieldLabel htmlFor={`question-name-${question.id}`}>
                          {t('Question name')}
                        </FieldLabel>
                        <Controller
                          name={`questions.${index}.name`}
                          control={form.control}
                          render={({ field }) => (
                            <Input
                              {...field}
                              id={`question-name-${question.id}`}
                              value={getIntelligenceQuestionName(
                                field.value,
                                t
                              )}
                              disabled={pending}
                              maxLength={120}
                            />
                          )}
                        />
                      </Field>
                      <Field>
                        <div className='flex items-center justify-between gap-2'>
                          <FieldLabel
                            htmlFor={`question-prompt-${question.id}`}
                          >
                            {t('Prompt')}
                          </FieldLabel>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            className='text-muted-foreground hover:text-destructive'
                            aria-label={t('Remove question')}
                            title={t('Remove question')}
                            disabled={pending || questions.fields.length === 1}
                            onClick={() =>
                              setRemoveTarget({
                                type: 'question',
                                id: question.id,
                              })
                            }
                          >
                            <HugeiconsIcon
                              icon={Cancel01Icon}
                              strokeWidth={2}
                              aria-hidden='true'
                            />
                          </Button>
                        </div>
                        <Textarea
                          id={`question-prompt-${question.id}`}
                          {...form.register(`questions.${index}.prompt`)}
                          disabled={pending}
                          rows={7}
                          className='field-sizing-fixed min-h-40 resize-y text-sm leading-relaxed'
                        />
                      </Field>
                    </FieldGroup>
                  ))}

                  <FieldDescription className='text-xs leading-relaxed'>
                    {t(
                      'Up to 5 questions, 8000 bytes per prompt and 50 channel-question pairs per run.'
                    )}
                  </FieldDescription>
                </div>
              </TitledCard>
            </section>
          </TabsContent>
          <div hidden={activeTab === 'history'} className='flex flex-col gap-2'>
            {Object.keys(form.formState.errors).length > 0 && (
              <p role='alert' className='text-destructive text-sm'>
                {t(
                  'Complete each question and group, and choose unique execution times in HH:mm format.'
                )}
              </p>
            )}
            <FieldDescription className='text-xs leading-relaxed'>
              {t(
                'Save changes before running a test. Up to 4 runs execute simultaneously, with 4 concurrent requests per run. Additional runs wait in the queue.'
              )}
            </FieldDescription>
          </div>
        </SettingsForm>
        <TabsContent value='history' className='min-w-0'>
          <IntelligenceHistory history={props.data.history} />
        </TabsContent>
      </Tabs>
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
        title={
          removeTarget?.type === 'question'
            ? t('Remove question?')
            : t('Remove group?')
        }
        desc={
          removeTarget?.type === 'question'
            ? t(
                'This question will be removed from every group. Groups left without questions must select another before saving.'
              )
            : t(
                'Remove this test group and its schedule? Save to apply the change.'
              )
        }
        confirmText={t('Remove')}
        destructive
        disabled={pending}
        handleConfirm={() => {
          if (!removeTarget) return
          if (removeTarget.type === 'group') {
            const index = groups.fields.findIndex(
              (group) => group.id === removeTarget.id
            )
            if (index >= 0 && groups.fields.length > 1) groups.remove(index)
          } else {
            const index = questions.fields.findIndex(
              (question) => question.id === removeTarget.id
            )
            if (index >= 0 && questions.fields.length > 1) {
              form.getValues('groups').forEach((group, groupIndex) => {
                const selected =
                  group.question_indexes ?? selectedQuestions.map((_, i) => i)
                form.setValue(
                  `groups.${groupIndex}.question_indexes`,
                  selected
                    .filter((value) => value !== index)
                    .map((value) => (value > index ? value - 1 : value)),
                  { shouldDirty: true }
                )
              })
              questions.remove(index)
            }
          }
          setRemoveTarget(null)
        }}
      >
        <p className='bg-muted rounded-lg px-3 py-2 text-sm font-medium break-all'>
          {removeTarget?.type === 'question'
            ? getIntelligenceQuestionName(
                selectedQuestions[
                  questions.fields.findIndex(
                    (question) => question.id === removeTarget.id
                  )
                ]?.name ?? '',
                t
              )
            : selectedGroups[
                groups.fields.findIndex(
                  (group) => group.id === removeTarget?.id
                )
              ]?.group}
        </p>
      </ConfirmDialog>
    </SettingsSection>
  )
}
