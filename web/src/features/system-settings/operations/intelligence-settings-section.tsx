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
import { useState } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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

export function IntelligenceSettings(props: { data: IntelligenceMonitorData }) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'settings' | 'history'>('settings')
  const queryClient = useQueryClient()
  const endpoints = getIntelligenceEndpointOptions(t)
  const form = useForm<IntelligenceConfig>({
    resolver: zodResolver(intelligenceConfigSchema),
    defaultValues: {
      ...props.data.config,
      groups: props.data.config.groups.map((group) => ({
        ...group,
        models: group.models?.length
          ? group.models
          : group.model
            ? [group.model]
            : [],
        stream: group.stream ?? true,
      })),
    },
  })
  const questions = useFieldArray({ control: form.control, name: 'questions' })
  const groups = useFieldArray({ control: form.control, name: 'groups' })
  const selectedGroups = form.watch('groups')
  const save = useMutation({
    mutationFn: saveIntelligenceConfig,
    onSuccess: (config) => {
      form.reset(config)
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
  const onSubmit = form.handleSubmit((config) => save.mutate(config))

  return (
    <SettingsSection title={t('Intelligence testing')}>
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (value === 'settings' || value === 'history') setActiveTab(value)
        }}
        className='min-w-0 gap-4'
      >
        <TabsList aria-label={t('Intelligence testing')} className='h-9'>
          <TabsTrigger value='settings' className='px-4'>
            {t('Settings')}
          </TabsTrigger>
          <TabsTrigger value='history' className='px-4'>
            {t('Intelligence test history')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value='settings' keepMounted className='min-w-0 space-y-4'>
          <p className='text-muted-foreground text-xs leading-relaxed'>
            {t(
              'Send your questions to every enabled channel matching each selected group and model. Compare HTML previews manually. Upstream API usage may incur charges.'
            )}
          </p>
          <SettingsForm onSubmit={onSubmit} className='@container gap-y-4'>
            {activeTab === 'settings' && (
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
                      !props.data.config.groups.every(
                        (group) => group.models?.length || group.model
                      )
                    }
                  >
                    {t('Run all groups')}
                  </Button>
                </SettingsPageActionsPortal>
              </>
            )}
            <div className='grid min-w-0 items-start gap-4 @min-[52rem]:grid-cols-[minmax(0,1.35fr)_minmax(20rem,1fr)]'>
              <section aria-label={t('Test groups')} className='min-w-0'>
                <TitledCard
                  title={t('Test groups')}
                  action={
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
                          stream: true,
                          enabled: false,
                          times: ['09:00'],
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
                  }
                  className='min-w-0 border shadow-none ring-0'
                  headerClassName='bg-muted/20 px-4 py-3! [&>div]:flex-row [&>div]:items-center [&>div>div:last-child]:w-auto'
                  titleClassName='text-sm font-semibold sm:text-sm'
                  contentClassName='p-4 sm:p-4'
                  disableHoverEffect
                >
                  <div className='flex flex-col gap-4'>
                    {groups.fields.map((entry, index) => (
                      <div
                        key={entry.id}
                        role='group'
                        aria-label={
                          selectedGroups[index].group || t('Model Group')
                        }
                        className='@container flex min-w-0 flex-col gap-3 not-first:border-t not-first:pt-4'
                      >
                        <div className='grid min-w-0 grid-cols-1 gap-3 @min-[28rem]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]'>
                          <Field className='min-w-0'>
                            <FieldLabel
                              htmlFor={`intelligence-group-${entry.id}`}
                            >
                              {t('Model Group')}
                            </FieldLabel>
                            <Select
                              value={selectedGroups[index].group || null}
                              items={Object.keys(props.data.catalog)
                                .sort()
                                .map((value) => ({ value, label: value }))}
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
                              <SelectTrigger
                                id={`intelligence-group-${entry.id}`}
                              >
                                <SelectValue placeholder={t('Select group')} />
                              </SelectTrigger>
                              <SelectContent alignItemWithTrigger={false}>
                                {Object.keys(props.data.catalog)
                                  .sort()
                                  .map((value) => (
                                    <SelectItem key={value} value={value}>
                                      {value}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field>
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
                                  value={field.value}
                                  items={endpoints}
                                  onValueChange={(value) =>
                                    value !== null && field.onChange(value)
                                  }
                                  disabled={pending}
                                >
                                  <SelectTrigger
                                    id={`intelligence-endpoint-${entry.id}`}
                                    ref={field.ref}
                                    onBlur={field.onBlur}
                                    aria-invalid={Boolean(
                                      form.formState.errors.groups?.[index]
                                        ?.endpoint
                                    )}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent alignItemWithTrigger={false}>
                                    {endpoints.map((endpoint) => (
                                      <SelectItem
                                        key={endpoint.value}
                                        value={endpoint.value}
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
                        <Field
                          className='min-w-0'
                          data-invalid={Boolean(
                            form.formState.errors.groups?.[index]?.models
                          )}
                        >
                          <FieldLabel
                            htmlFor={`intelligence-models-${entry.id}`}
                          >
                            {t('Models')}
                          </FieldLabel>
                          <Controller
                            name={`groups.${index}.models`}
                            control={form.control}
                            render={({ field }) => (
                              <MultiSelect
                                id={`intelligence-models-${entry.id}`}
                                className='[&_[data-slot=combobox-chip]]:max-w-full'
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
                                maxVisibleChips={3}
                                disabled={
                                  pending || !selectedGroups[index].group
                                }
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
                        <SettingsControlGroup className='bg-muted/40 space-y-3 rounded-lg border-0 p-3'>
                          <div className='grid gap-3 @min-[32rem]:grid-cols-2'>
                            <Controller
                              name={`groups.${index}.stream`}
                              control={form.control}
                              render={({ field }) => (
                                <SettingsSwitchField
                                  controlId={`intelligence-stream-${entry.id}`}
                                  label={t('Streaming output')}
                                  description={t(
                                    'Receive output incrementally to reduce gateway timeouts. Enabled by default.'
                                  )}
                                  checked={field.value ?? true}
                                  onCheckedChange={field.onChange}
                                  disabled={pending}
                                  className='py-0'
                                />
                              )}
                            />
                            <Controller
                              name={`groups.${index}.enabled`}
                              control={form.control}
                              render={({ field }) => (
                                <SettingsSwitchField
                                  controlId={`intelligence-schedule-${entry.id}`}
                                  label={t('Scheduled intelligence testing')}
                                  className='py-0'
                                  description={t(
                                    'Daily execution times (Beijing time)'
                                  )}
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  disabled={pending}
                                />
                              )}
                            />
                          </div>
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
                                                i === timeIndex
                                                  ? value
                                                  : current
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
                                      disabled={
                                        pending || field.value.length >= 24
                                      }
                                      onClick={() =>
                                        field.onChange([
                                          ...field.value,
                                          '09:00',
                                        ])
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
                        <div className='flex flex-wrap items-center justify-end gap-2'>
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            disabled={
                              pending ||
                              form.formState.isDirty ||
                              !selectedGroups[index].group ||
                              !(
                                selectedGroups[index].models?.length ||
                                selectedGroups[index].model
                              )
                            }
                            onClick={() =>
                              run.mutate(selectedGroups[index].group)
                            }
                          >
                            {t('Run this group')}
                          </Button>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='text-muted-foreground hover:text-destructive'
                            disabled={pending || groups.fields.length === 1}
                            onClick={() => groups.remove(index)}
                          >
                            {t('Remove group')}
                          </Button>
                        </div>
                      </div>
                    ))}

                    <FieldDescription className='text-xs leading-relaxed'>
                      {t(
                        'Each group has its own models, endpoint and daily times. All selected models are tested. The question bank is shared. Missed times are skipped while the server is offline.'
                      )}
                    </FieldDescription>
                  </div>
                </TitledCard>
              </section>
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
                              disabled={
                                pending || questions.fields.length === 1
                              }
                              onClick={() => questions.remove(index)}
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
            </div>
            <div className='flex flex-col gap-2'>
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
        </TabsContent>
        <TabsContent value='history' className='min-w-0'>
          <IntelligenceHistory history={props.data.history} />
        </TabsContent>
      </Tabs>
    </SettingsSection>
  )
}
