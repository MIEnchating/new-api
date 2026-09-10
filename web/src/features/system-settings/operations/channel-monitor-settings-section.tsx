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
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GripVertical } from 'lucide-react'
import { useId, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  getCacheMetrics,
  updateMonitorHealthThresholds,
  updateCacheMonitorGroups,
} from '@/features/status-monitor/api'
import {
  defaultHealthThresholds,
  type CacheMetricsResponse,
} from '@/features/status-monitor/types'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import {
  SettingsForm,
  SettingsFormGrid,
  SettingsControlGroup,
  SettingsSwitchField,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'

const CACHE_SETTINGS_QUERY_KEY = ['channel-monitor-settings']
const CACHE_GROUP_DRAG_MODIFIERS = [restrictToParentElement]
const settingsSchema = z.object({
  thresholds: z.object({
    minimum_sample: z.number().int().min(1).max(1000000),
    warning_error_rate: z.number().min(0).max(100),
    critical_error_rate: z.number().min(0).max(100),
    target_ttft_ms: z.number().int().min(1).max(3600000),
    warning_ttft_ms: z.number().int().min(1).max(3600000),
    critical_ttft_ms: z.number().int().min(1).max(3600000),
    warning_cache_rate: z.number().min(0).max(100),
    critical_cache_rate: z.number().min(0).max(100),
  }),
  allGroups: z.boolean(),
  groups: z.array(z.string()),
})
type CacheSettings = z.infer<typeof settingsSchema>

function SortableCacheGroupRow(props: {
  group: string
  selected: boolean
  checkboxDisabled: boolean
  dragDisabled: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const checkboxId = useId()
  const sortable = useSortable({
    id: props.group,
    disabled: props.dragDisabled,
    transition: {
      duration: 220,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
  })

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
        zIndex: sortable.isDragging ? 10 : undefined,
      }}
      className={cn(
        'hover:bg-accent relative flex min-w-0 items-center gap-2 rounded-lg border border-transparent px-3 py-2 transition-[background-color,box-shadow,opacity]',
        props.selected && 'bg-primary/5 border-primary/15',
        sortable.isDragging && 'bg-accent z-10 opacity-70 shadow-md'
      )}
    >
      <label
        htmlFor={checkboxId}
        className='flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1'
      >
        <Checkbox
          id={checkboxId}
          checked={props.selected}
          disabled={props.checkboxDisabled}
          onCheckedChange={props.onToggle}
        />
        <span className='min-w-0 flex-1 text-sm [overflow-wrap:anywhere] break-words'>
          {props.group}
        </span>
      </label>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        disabled={props.dragDisabled}
        className='text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 shrink-0 touch-none items-center justify-center rounded-md enabled:cursor-grab enabled:active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30'
        aria-label={t('Drag to reorder')}
        title={t('Drag to reorder')}
      >
        <GripVertical className='size-4' />
      </Button>
    </div>
  )
}

function ChannelMonitorSettingsForm(props: {
  data: CacheMetricsResponse['data']
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const allGroupsId = useId()
  const saved = useRef<CacheSettings>({
    thresholds:
      props.data.health_thresholds ??
      defaultHealthThresholds(props.data.baseline),
    allGroups: props.data.all_groups,
    groups: props.data.display_groups,
  })
  const form = useForm<CacheSettings>({
    resolver: zodResolver(settingsSchema, {
      error: () => t('Enter a valid number within the allowed range.'),
    }),
    defaultValues: saved.current,
  })
  const allGroups = form.watch('allGroups')
  const selectedGroups = form.watch('groups')
  const availableGroups = props.data.available_groups
  const selectedAvailable = selectedGroups.filter((group) =>
    availableGroups.includes(group)
  )
  const orderedGroups = [
    ...selectedAvailable,
    ...availableGroups.filter((group) => !selectedGroups.includes(group)),
  ]
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const save = useMutation({
    mutationFn: async (values: CacheSettings) => {
      if (
        JSON.stringify(values.thresholds) !==
        JSON.stringify(saved.current.thresholds)
      ) {
        const response = requireServerSuccess(
          await updateMonitorHealthThresholds(values.thresholds)
        )
        saved.current = { ...saved.current, thresholds: response.data }
      }
      if (
        values.allGroups !== saved.current.allGroups ||
        JSON.stringify(values.groups) !== JSON.stringify(saved.current.groups)
      ) {
        const response = requireServerSuccess(
          await updateCacheMonitorGroups(values.allGroups, values.groups)
        )
        saved.current = {
          ...saved.current,
          allGroups: response.data.all_groups,
          groups: response.data.display_groups,
        }
      }
      return saved.current
    },
    onSuccess: (values) => {
      form.reset(values)
      toast.success(t('Setting updated successfully'))
      void queryClient.invalidateQueries({ queryKey: CACHE_SETTINGS_QUERY_KEY })
    },
    onError: (error) => handleServerError(error, t('Failed to update setting')),
  })
  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return
    const source = selectedGroups.indexOf(String(event.active.id))
    const target = selectedGroups.indexOf(String(event.over.id))
    if (source < 0 || target < 0) return
    form.setValue('groups', arrayMove(selectedGroups, source, target), {
      shouldDirty: true,
    })
  }
  const onSubmit = form.handleSubmit((values) => {
    if (save.isPending || (!values.allGroups && values.groups.length === 0)) {
      return
    }
    const h = values.thresholds
    if (h.warning_error_rate >= h.critical_error_rate) {
      form.setError('thresholds.critical_error_rate', {
        message: t('Critical error rate must exceed the warning rate.'),
      })
      return
    }
    if (
      h.target_ttft_ms > h.warning_ttft_ms ||
      h.warning_ttft_ms >= h.critical_ttft_ms
    ) {
      form.setError('thresholds.critical_ttft_ms', {
        message: t('TTFT thresholds must satisfy target ≤ warning < critical.'),
      })
      return
    }
    if (h.critical_cache_rate > h.warning_cache_rate) {
      form.setError('thresholds.critical_cache_rate', {
        message: t('Critical cache rate cannot exceed the warning rate.'),
      })
      return
    }
    save.mutate(values)
  })

  return (
    <SettingsSection title={t('Channel Monitor')}>
      <Form {...form}>
        <SettingsForm onSubmit={onSubmit}>
          <SettingsPageFormActions
            onSave={onSubmit}
            onReset={() => form.reset(saved.current)}
            isSaving={save.isPending}
            isSaveDisabled={
              !form.formState.isDirty ||
              (!allGroups && selectedGroups.length === 0)
            }
            isResetDisabled={!form.formState.isDirty}
          />
          <fieldset disabled={save.isPending} className='min-w-0 space-y-6'>
            <SettingsControlGroup className='bg-card space-y-4 p-4 sm:p-5'>
              <div>
                <h4 className='text-sm font-medium'>{t('Monitored groups')}</h4>
                <p className='text-muted-foreground mt-1 text-xs'>
                  {t('Choose which groups are visible in cache analytics.')}
                </p>
              </div>
              <SettingsSwitchField
                controlId={allGroupsId}
                label={t('Automatically show all groups')}
                checked={allGroups}
                disabled={save.isPending}
                onCheckedChange={(checked) =>
                  form.setValue('allGroups', checked, { shouldDirty: true })
                }
              />
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={CACHE_GROUP_DRAG_MODIFIERS}
                onDragEnd={handleDragEnd}
              >
                <div className='grid max-h-80 grid-cols-1 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-2'>
                  <SortableContext
                    items={orderedGroups}
                    strategy={rectSortingStrategy}
                  >
                    {orderedGroups.length === 0 ? (
                      <EmptyState title={t('No data')} />
                    ) : (
                      orderedGroups.map((group) => (
                        <SortableCacheGroupRow
                          key={group}
                          group={group}
                          selected={allGroups || selectedGroups.includes(group)}
                          checkboxDisabled={allGroups || save.isPending}
                          dragDisabled={
                            allGroups ||
                            save.isPending ||
                            !selectedGroups.includes(group) ||
                            selectedAvailable.length < 2
                          }
                          onToggle={() =>
                            form.setValue(
                              'groups',
                              selectedGroups.includes(group)
                                ? selectedGroups.filter(
                                    (item) => item !== group
                                  )
                                : [...selectedGroups, group],
                              { shouldDirty: true }
                            )
                          }
                        />
                      ))
                    )}
                  </SortableContext>
                </div>
              </DndContext>
            </SettingsControlGroup>
            <SettingsControlGroup className='bg-card space-y-5 p-4 sm:p-5'>
              <div className='space-y-1'>
                <h4 className='text-sm font-medium'>
                  {t('Health thresholds')}
                </h4>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  {t(
                    'Control status colors and overall scores. Signals with too few samples remain unknown.'
                  )}
                </p>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  {t(
                    'TTFT uses the average first-token latency. Overall score weights: errors 60%, TTFT 20%, cache 20%.'
                  )}
                </p>
              </div>
              <SettingsFormGrid className='grid-cols-2 gap-x-4 gap-y-5 xl:grid-cols-4'>
                {(
                  [
                    [
                      'minimum_sample',
                      t('Minimum sample count'),
                      1,
                      1000000,
                      1,
                    ],
                    [
                      'warning_error_rate',
                      t('Warning error rate (%)'),
                      0,
                      100,
                      0.1,
                    ],
                    [
                      'critical_error_rate',
                      t('Critical error rate (%)'),
                      0,
                      100,
                      0.1,
                    ],
                    ['target_ttft_ms', t('Target TTFT (ms)'), 1, 3600000, 1],
                    ['warning_ttft_ms', t('Warning TTFT (ms)'), 1, 3600000, 1],
                    [
                      'critical_ttft_ms',
                      t('Critical TTFT (ms)'),
                      1,
                      3600000,
                      1,
                    ],
                    [
                      'warning_cache_rate',
                      t('Warning cache rate (%)'),
                      0,
                      100,
                      0.1,
                    ],
                    [
                      'critical_cache_rate',
                      t('Critical cache rate (%)'),
                      0,
                      100,
                      0.1,
                    ],
                  ] as const
                ).map(([name, label, min, max, step]) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={`thresholds.${name}`}
                    render={({ field }) => (
                      <FormItem className='min-w-0'>
                        <FormLabel className='text-xs'>{label}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type='number'
                            min={min}
                            max={max}
                            step={step}
                            disabled={save.isPending}
                            value={Number.isNaN(field.value) ? '' : field.value}
                            onChange={(event) =>
                              field.onChange(event.target.valueAsNumber)
                            }
                            className='tabular-nums'
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </SettingsFormGrid>
            </SettingsControlGroup>
          </fieldset>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}

export function ChannelMonitorSettingsSection() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: CACHE_SETTINGS_QUERY_KEY,
    queryFn: async () => requireServerSuccess(await getCacheMetrics()),
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  if (query.isPending) return <LoadingState />
  if (!query.data) {
    return (
      <ErrorState
        title={t('Cache monitoring unavailable')}
        onRetry={() => void query.refetch()}
      />
    )
  }
  return <ChannelMonitorSettingsForm data={query.data.data} />
}
