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
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { ModelGroupSelector } from '@/components/model-group-selector'
import { TimePicker } from '@/components/time-picker'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
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
import { Textarea } from '@/components/ui/textarea'
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

import { SettingsCard } from '../components/settings-card'
import {
  SettingsForm,
  SettingsSwitchField,
} from '../components/settings-form-layout'
import {
  SettingsPageActionsPortal,
  SettingsPageFormActions,
} from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'

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
  const running = query.data.history.some(
    (task) => task.status === 'pending' || task.status === 'running'
  )
  return <IntelligenceSettings data={query.data} running={running} />
}

export function IntelligenceSettings(props: {
  data: IntelligenceMonitorData
  running: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const endpoints = getIntelligenceEndpointOptions(t)
  const form = useForm<IntelligenceConfig>({
    resolver: zodResolver(intelligenceConfigSchema),
    defaultValues: {
      ...props.data.config,
      groups: props.data.config.groups.map((group) => ({
        ...group,
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
      <p className='text-muted-foreground text-sm'>
        {t(
          'Send your questions to every enabled channel matching the selected group and model. Compare HTML previews and basic checks manually. Upstream API usage may incur charges.'
        )}
      </p>
      <SettingsForm onSubmit={onSubmit} className='@container'>
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
              props.running ||
              form.formState.isDirty ||
              !props.data.config.groups.every((group) => group.model)
            }
          >
            {props.running ? t('Running') : t('Run all groups')}
          </Button>
        </SettingsPageActionsPortal>
        <div className='grid min-w-0 items-start gap-5 @min-[60rem]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]'>
          <section aria-label={t('Test groups')} className='min-w-0'>
            <SettingsCard
              title={t('Test groups')}
              className='min-w-0 shadow-none'
              disableHoverEffect
            >
              <div className='flex flex-col gap-5'>
                {groups.fields.map((entry, index) => (
                  <div
                    key={entry.id}
                    role='group'
                    aria-label={selectedGroups[index].group || t('Model Group')}
                    className='@container flex min-w-0 flex-col gap-4 border-b pb-5'
                  >
                    <div className='grid min-w-0 gap-4 @min-[34rem]:grid-cols-2'>
                      <Field className='min-w-0'>
                        <FieldLabel>{t('Model Group')}</FieldLabel>
                        <ModelGroupSelector
                          selectedGroup={selectedGroups[index].group}
                          selectedModel={selectedGroups[index].model}
                          groups={Object.keys(props.data.catalog)
                            .sort()
                            .map((value) => ({ value, label: value }))}
                          models={(
                            props.data.catalog[selectedGroups[index].group] ??
                            []
                          ).map((value) => ({
                            value,
                            label: value,
                          }))}
                          onGroupChange={(value) => {
                            form.setValue(`groups.${index}.group`, value, {
                              shouldDirty: true,
                            })
                            form.setValue(`groups.${index}.model`, '', {
                              shouldDirty: true,
                            })
                          }}
                          onModelChange={(value) =>
                            form.setValue(`groups.${index}.model`, value, {
                              shouldDirty: true,
                            })
                          }
                          disabled={pending}
                          className='w-full max-w-none'
                        />
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
                    <div className='bg-muted/30 rounded-lg px-3 pb-3'>
                      <Controller
                        name={`groups.${index}.enabled`}
                        control={form.control}
                        render={({ field }) => (
                          <SettingsSwitchField
                            controlId={`intelligence-schedule-${entry.id}`}
                            label={t('Scheduled intelligence testing')}
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={pending}
                          />
                        )}
                      />
                      <Controller
                        name={`groups.${index}.times`}
                        control={form.control}
                        render={({ field }) => (
                          <Field>
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
                                    aria-label={t('Execution time {{number}}', {
                                      number: timeIndex + 1,
                                    })}
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
                    </div>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        disabled={
                          pending ||
                          props.running ||
                          form.formState.isDirty ||
                          !selectedGroups[index].group ||
                          !selectedGroups[index].model
                        }
                        onClick={() => run.mutate(selectedGroups[index].group)}
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
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='self-start'
                  disabled={pending || groups.fields.length >= 50}
                  onClick={() =>
                    groups.append({
                      group: '',
                      model: '',
                      endpoint: 'openai',
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
                <FieldDescription>
                  {t(
                    'Each group has its own model, endpoint and daily times. The question bank is shared. Missed times are skipped while the server is offline or another test is running.'
                  )}
                </FieldDescription>
              </div>
            </SettingsCard>
          </section>
          <section aria-label={t('Question bank')} className='min-w-0'>
            <SettingsCard
              title={t('Question bank')}
              className='min-w-0 shadow-none'
              disableHoverEffect
            >
              <div className='flex flex-col gap-5'>
                {questions.fields.map((question, index) => (
                  <FieldGroup
                    key={question.id}
                    className='min-w-0 gap-4 border-b pb-5'
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
                            value={getIntelligenceQuestionName(field.value, t)}
                            disabled={pending}
                            maxLength={120}
                          />
                        )}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`question-prompt-${question.id}`}>
                        {t('Prompt')}
                      </FieldLabel>
                      <Textarea
                        id={`question-prompt-${question.id}`}
                        {...form.register(`questions.${index}.prompt`)}
                        disabled={pending}
                        rows={10}
                        className='min-h-48 resize-y leading-relaxed'
                      />
                    </Field>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='text-muted-foreground hover:text-destructive self-end'
                      disabled={pending || questions.fields.length === 1}
                      onClick={() => questions.remove(index)}
                    >
                      {t('Remove question')}
                    </Button>
                  </FieldGroup>
                ))}
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='self-start'
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
                <FieldDescription>
                  {t(
                    'Up to 5 questions, 8000 bytes per prompt and 50 channel-question pairs per run.'
                  )}
                </FieldDescription>
              </div>
            </SettingsCard>
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
          <FieldDescription>
            {t(
              'Save changes before running a test. Only one intelligence test can run at a time.'
            )}
          </FieldDescription>
        </div>
      </SettingsForm>
    </SettingsSection>
  )
}
