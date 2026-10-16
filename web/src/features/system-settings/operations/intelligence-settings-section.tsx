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

import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { MultiSelect } from '@/components/multi-select'
import { TimePicker } from '@/components/time-picker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
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
  const [activeTab, setActiveTab] = useState<
    'settings' | 'questions' | 'history'
  >('settings')
  const [removeTarget, setRemoveTarget] = useState<{
    type: 'group' | 'question'
    id: string
  } | null>(null)
  const queryClient = useQueryClient()
  const endpoints = getIntelligenceEndpointOptions(t)
  const groupOptions = (
    props.data.group_order ?? Object.keys(props.data.catalog).sort()
  ).map((value) => ({ value, label: value }))
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
        question_indexes:
          group.question_indexes ??
          props.data.config.questions.map((_, index) => index),
      })),
    },
  })
  const questions = useFieldArray({ control: form.control, name: 'questions' })
  const groups = useFieldArray({ control: form.control, name: 'groups' })
  const selectedGroups = form.watch('groups')
  const selectedQuestions = form.watch('questions')
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
  const onSubmit = form.handleSubmit(
    (config) => save.mutate(config),
    (errors) => {
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
          className='h-auto min-h-9 max-w-full flex-wrap'
        >
          <TabsTrigger value='settings' className='px-4'>
            {t('Settings')}
          </TabsTrigger>
          <TabsTrigger value='questions' className='px-4'>
            {t('Question bank')}
          </TabsTrigger>
          <TabsTrigger value='history' className='px-4'>
            {t('Intelligence test history')}
          </TabsTrigger>
        </TabsList>
        <SettingsForm onSubmit={onSubmit} className='@container gap-y-4'>
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
          <TabsContent
            value='settings'
            keepMounted
            className='min-w-0 space-y-4'
          >
            <p className='text-muted-foreground text-xs leading-relaxed'>
              {t(
                'Send your questions to every enabled channel matching each selected group and model. Compare HTML previews manually. Upstream API usage may incur charges.'
              )}
            </p>

            <section aria-label={t('Test groups')} className='min-w-0'>
              <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
                <h3 className='text-base font-semibold'>{t('Test groups')}</h3>
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
              <div className='grid min-w-0 items-start gap-5 @min-[70rem]:grid-cols-2'>
                {groups.fields.map((entry, index) => (
                  <div
                    key={entry.id}
                    role='group'
                    aria-label={selectedGroups[index].group || t('Model Group')}
                    className='@container min-w-0'
                  >
                    <TitledCard
                      title={
                        selectedGroups[index].group ||
                        t('Test group {{number}}', { number: index + 1 })
                      }
                      className='min-w-0 border shadow-none ring-0'
                      headerClassName='bg-muted/30 px-4 py-3! sm:px-5'
                      titleClassName='break-all text-base sm:text-base'
                      contentClassName='flex min-w-0 flex-col gap-5 p-4 sm:p-5'
                      disableHoverEffect
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
                            <SelectTrigger
                              id={`intelligence-group-${entry.id}`}
                            >
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
                        <FieldLabel htmlFor={`intelligence-models-${entry.id}`}>
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
                      <FieldSet
                        data-invalid={Boolean(
                          form.formState.errors.groups?.[index]
                            ?.question_indexes
                        )}
                      >
                        <FieldLegend variant='label'>
                          {t('Test questions')}
                        </FieldLegend>
                        <div className='grid gap-2 @min-[28rem]:grid-cols-2'>
                          {selectedQuestions.map((question, questionIndex) => {
                            const selected =
                              selectedGroups[index].question_indexes ??
                              selectedQuestions.map((_, i) => i)
                            return (
                              <Field
                                key={questions.fields[questionIndex].id}
                                orientation='horizontal'
                                className='rounded-lg border p-3'
                              >
                                <Checkbox
                                  id={`intelligence-question-${entry.id}-${questionIndex}`}
                                  checked={selected.includes(questionIndex)}
                                  aria-invalid={Boolean(
                                    form.formState.errors.groups?.[index]
                                      ?.question_indexes
                                  )}
                                  disabled={pending}
                                  onCheckedChange={(checked) =>
                                    form.setValue(
                                      `groups.${index}.question_indexes`,
                                      checked
                                        ? [...selected, questionIndex].sort(
                                            (a, b) => a - b
                                          )
                                        : selected.filter(
                                            (value) => value !== questionIndex
                                          ),
                                      {
                                        shouldDirty: true,
                                        shouldValidate: true,
                                      }
                                    )
                                  }
                                />
                                <FieldLabel
                                  htmlFor={`intelligence-question-${entry.id}-${questionIndex}`}
                                  className='min-w-0 flex-1 break-words'
                                >
                                  {getIntelligenceQuestionName(
                                    question.name,
                                    t
                                  ) ||
                                    t('Question {{number}}', {
                                      number: questionIndex + 1,
                                    })}
                                </FieldLabel>
                              </Field>
                            )
                          })}
                        </div>
                        <FieldError>
                          {form.formState.errors.groups?.[index]
                            ?.question_indexes &&
                            t(
                              'Select at least one valid, unique question for each group'
                            )}
                        </FieldError>
                      </FieldSet>
                      <SettingsControlGroup className='bg-muted/20 space-y-4 rounded-xl p-4'>
                        <div className='flex flex-col gap-4'>
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
                                className='border-t pt-4 pb-0'
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
                                    disabled={
                                      pending || field.value.length >= 24
                                    }
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
                      <div className='flex flex-wrap items-center justify-between gap-4 border-t pt-4'>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          disabled={
                            pending ||
                            form.formState.isDirty ||
                            !selectedGroups[index].group ||
                            selectedGroups[index].question_indexes?.length ===
                              0 ||
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
                          onClick={() =>
                            setRemoveTarget({ type: 'group', id: entry.id })
                          }
                        >
                          {t('Remove group')}
                        </Button>
                      </div>
                    </TitledCard>
                  </div>
                ))}

                <FieldDescription className='col-span-full text-xs leading-relaxed'>
                  {t(
                    'Each group runs its selected questions for every selected model. Manage questions in the Question bank tab. Missed schedules are skipped while the server is offline.'
                  )}
                </FieldDescription>
              </div>
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
