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
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge } from '@/components/status-badge'
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
import { Switch } from '@/components/ui/switch'
import { getChannelFilterGroups } from '@/features/channels/api'

import {
  SettingsControlChildren,
  SettingsControlGroup,
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageActionsPortal } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'
import {
  clearAllRouteAffinity,
  getRouteAffinityStats,
} from './route-affinity-api'
import {
  resolveRouteCooldownToggle,
  resolveSameChannelRetryToggle,
} from './route-cooldown'
import {
  exclusionModes,
  type ExclusionMode,
  type GroupExclusions,
  parseGroupExclusions,
  serializeGroupExclusions,
} from './route-exclusions'

function exclusionModeLabelKey(mode: ExclusionMode) {
  switch (mode) {
    case 'same_channel_retry':
      return 'Do not retry the current channel'
    case 'next_channel':
      return 'Do not switch to another channel'
    case 'all':
      return 'Do not retry or switch channels'
  }
}

const routeAffinitySchema = z.object({
  RetryTimes: z.coerce.number().min(0).max(10),
  ChannelRouteCooldownEnabled: z.boolean(),
  ChannelRouteCooldownSeconds: z.coerce
    .number()
    .int()
    .min(0)
    .max(31536000, 'Cooldown cannot exceed 31536000 seconds'),
  ChannelRouteStickyEnabled: z.boolean(),
  ChannelRouteSameChannelRetries: z.coerce.number().int().min(0).max(10),
  ChannelRouteGroupExclusionsEnabled: z.boolean(),
  ChannelRouteGroupExclusions: z.string(),
})

type RouteAffinityFormInput = z.input<typeof routeAffinitySchema>
type RouteAffinityFormValues = z.output<typeof routeAffinitySchema>

type RouteAffinitySettings = {
  RetryTimes: number
  ChannelRouteCooldownEnabled: boolean
  ChannelRouteCooldownSeconds: number
  ChannelRouteStickyEnabled: boolean
  ChannelRouteSameChannelRetries: number
  ChannelRouteGroupExclusionsEnabled: boolean
  ChannelRouteGroupExclusions: string
}

type RouteAffinitySectionProps = {
  defaultValues: RouteAffinitySettings
}

function normalizeValues(
  values: RouteAffinityFormValues | RouteAffinitySettings
): RouteAffinitySettings {
  return {
    RetryTimes: values.ChannelRouteCooldownEnabled ? 0 : values.RetryTimes,
    ChannelRouteCooldownEnabled: values.ChannelRouteCooldownEnabled,
    ChannelRouteCooldownSeconds: values.ChannelRouteCooldownSeconds,
    ChannelRouteStickyEnabled: values.ChannelRouteStickyEnabled,
    ChannelRouteSameChannelRetries: values.ChannelRouteSameChannelRetries,
    ChannelRouteGroupExclusionsEnabled:
      values.ChannelRouteGroupExclusionsEnabled,
    ChannelRouteGroupExclusions: serializeGroupExclusions(
      parseGroupExclusions(values.ChannelRouteGroupExclusions)
    ),
  }
}

function GroupExclusionEditor(props: {
  value: string
  groupOptions: string[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const exclusions = parseGroupExclusions(props.value)
  const entries = Object.entries(exclusions)
  const availableGroups = props.groupOptions.filter(
    (group) => !(group in exclusions)
  )

  const update = (next: GroupExclusions) => {
    props.onChange(serializeGroupExclusions(next))
  }

  const addRule = () => {
    const group = availableGroups[0]
    if (!group) return
    update({
      ...exclusions,
      [group]: { mode: 'all', enabled: true },
    })
  }

  return (
    <div className='space-y-3'>
      {entries.length > 0 ? (
        <div className='grid items-start gap-3 xl:grid-cols-2'>
          {entries.map(([group, rule]) => {
            const selectableGroups = [
              group,
              ...props.groupOptions.filter(
                (option) => option !== group && !(option in exclusions)
              ),
            ]
            return (
              <div
                key={group}
                className='grid min-w-0 gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,1fr)_7.5rem] sm:items-center'
              >
                <Select
                  value={group}
                  disabled={props.disabled}
                  onValueChange={(nextGroup) => {
                    if (!nextGroup || nextGroup === group) return
                    const next = { ...exclusions }
                    delete next[group]
                    next[nextGroup] = rule
                    update(next)
                  }}
                >
                  <SelectTrigger className='min-w-0'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {selectableGroups.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <Select
                  value={rule.mode}
                  disabled={props.disabled}
                  onValueChange={(nextMode) => {
                    if (!exclusionModes.includes(nextMode as ExclusionMode)) {
                      return
                    }
                    update({
                      ...exclusions,
                      [group]: {
                        ...rule,
                        mode: nextMode as ExclusionMode,
                      },
                    })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {t(exclusionModeLabelKey(rule.mode))}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='same_channel_retry'>
                        {t('Do not retry the current channel')}
                      </SelectItem>
                      <SelectItem value='next_channel'>
                        {t('Do not switch to another channel')}
                      </SelectItem>
                      <SelectItem value='all'>
                        {t('Do not retry or switch channels')}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <div className='flex items-center justify-end gap-1.5 sm:border-l sm:pl-2'>
                  <label className='text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs'>
                    <span>{t('Enabled')}</span>
                    <Switch
                      size='sm'
                      checked={rule.enabled}
                      disabled={props.disabled}
                      onCheckedChange={(enabled) =>
                        update({
                          ...exclusions,
                          [group]: { ...rule, enabled },
                        })
                      }
                    />
                  </label>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='text-destructive'
                    disabled={props.disabled}
                    aria-label={t('Delete')}
                    onClick={() => {
                      const next = { ...exclusions }
                      delete next[group]
                      update(next)
                    }}
                  >
                    <Trash2 className='size-4' />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className='text-muted-foreground rounded-md border border-dashed px-3 py-5 text-center text-sm'>
          {t('No route exclusion groups configured')}
        </div>
      )}

      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={props.disabled || availableGroups.length === 0}
        onClick={addRule}
      >
        <Plus data-icon='inline-start' />
        {t('Add excluded group')}
      </Button>
    </div>
  )
}

export function ChannelRoutingSection(props: RouteAffinitySectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const defaults = useMemo(
    () => normalizeValues(props.defaultValues),
    [props.defaultValues]
  )
  const enabledCooldownSecondsRef = useRef(
    defaults.ChannelRouteCooldownSeconds > 0
      ? defaults.ChannelRouteCooldownSeconds
      : 60
  )
  const enabledSameChannelRetriesRef = useRef(
    defaults.ChannelRouteSameChannelRetries > 0
      ? defaults.ChannelRouteSameChannelRetries
      : 1
  )
  const form = useForm<
    RouteAffinityFormInput,
    unknown,
    RouteAffinityFormValues
  >({
    resolver: zodResolver(routeAffinitySchema),
    defaultValues: defaults,
  })

  useResetForm(form, defaults)

  useEffect(() => {
    if (defaults.ChannelRouteCooldownSeconds > 0) {
      enabledCooldownSecondsRef.current = defaults.ChannelRouteCooldownSeconds
    }
  }, [defaults.ChannelRouteCooldownSeconds])

  useEffect(() => {
    if (defaults.ChannelRouteSameChannelRetries > 0) {
      enabledSameChannelRetriesRef.current =
        defaults.ChannelRouteSameChannelRetries
    }
  }, [defaults.ChannelRouteSameChannelRetries])

  const affinityStats = useQuery({
    queryKey: ['route-affinity-stats'],
    queryFn: getRouteAffinityStats,
  })
  const groupOptionsQuery = useQuery({
    queryKey: ['channel-route-group-options'],
    queryFn: () => getChannelFilterGroups(true),
  })
  const groupOptions = groupOptionsQuery.data?.data ?? []

  const routeEnabled = form.watch('ChannelRouteCooldownEnabled')
  const groupExclusionsEnabled = form.watch(
    'ChannelRouteGroupExclusionsEnabled'
  )

  const onSubmit = async (values: RouteAffinityFormValues) => {
    const normalized = normalizeValues(values)
    const updates = (
      Object.keys(normalized) as Array<keyof RouteAffinitySettings>
    ).filter((key) => normalized[key] !== defaults[key])

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of updates) {
      await updateOption.mutateAsync({ key, value: normalized[key] })
    }
  }

  const handleClearAll = async () => {
    setIsClearing(true)
    try {
      const result = await clearAllRouteAffinity()
      if (!result.success) {
        toast.error(result.message || t('Failed to clear route affinity'))
        return
      }
      toast.success(t('Route affinity cleared'))
      await affinityStats.refetch()
      setClearConfirmOpen(false)
    } catch {
      toast.error(t('Failed to clear route affinity'))
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <>
      <SettingsSection title={t('Channel routing')}>
        <Form {...form}>
          <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
            <SettingsPageActionsPortal>
              <Button
                type='button'
                size='sm'
                onClick={form.handleSubmit(onSubmit)}
                disabled={updateOption.isPending}
              >
                <Save data-icon='inline-start' />
                <span>
                  {updateOption.isPending ? t('Saving...') : t('Save Changes')}
                </span>
              </Button>
            </SettingsPageActionsPortal>

            <div className='grid overflow-hidden rounded-md border sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]'>
              <div className='flex min-w-0 items-center justify-between gap-3 border-b px-3 py-3 sm:border-r sm:border-b-0'>
                <div className='min-w-0'>
                  <div className='text-xs font-medium'>
                    {t('Channel routing')}
                  </div>
                  <div className='text-muted-foreground mt-0.5 text-xs'>
                    {t(
                      'Select channels by priority and continue with the next candidate after a failure.'
                    )}
                  </div>
                </div>
                <StatusBadge
                  variant={routeEnabled ? 'success' : 'neutral'}
                  size='sm'
                  copyable={false}
                >
                  {t(routeEnabled ? 'Enabled' : 'Disabled')}
                </StatusBadge>
              </div>

              <div className='flex min-w-0 flex-wrap items-center gap-2 px-3 py-2.5'>
                <div className='mr-auto min-w-0'>
                  <div className='text-xs font-medium'>
                    {t('Route affinity cache')}
                  </div>
                  <div className='text-muted-foreground mt-0.5 text-xs'>
                    {t('Cache Entries')}:{' '}
                    {affinityStats.data?.data?.total ?? '-'}
                  </div>
                </div>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() => affinityStats.refetch()}
                  disabled={affinityStats.isFetching}
                >
                  <RefreshCw
                    data-icon='inline-start'
                    className={affinityStats.isFetching ? 'animate-spin' : ''}
                  />
                  <span>{t('Refresh')}</span>
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() => setClearConfirmOpen(true)}
                >
                  <Trash2 data-icon='inline-start' />
                  <span>{t('Clear')}</span>
                </Button>
              </div>
            </div>

            <SettingsControlGroup>
              <div className='space-y-0.5'>
                <h4 className='text-sm font-medium'>{t('Routing strategy')}</h4>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Configure candidate switching and route affinity behavior.'
                  )}
                </p>
              </div>
              <SettingsControlChildren className='grid gap-3 md:grid-cols-2'>
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
                  name='ChannelRouteStickyEnabled'
                  render={({ field }) => (
                    <SettingsSwitchItem>
                      <SettingsSwitchContent>
                        <FormLabel>{t('Enable route affinity')}</FormLabel>
                        <FormDescription>
                          {t(
                            'Keep using the last successful routed channel until it fails'
                          )}
                        </FormDescription>
                      </SettingsSwitchContent>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          disabled={!routeEnabled}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </SettingsSwitchItem>
                  )}
                />
              </SettingsControlChildren>
            </SettingsControlGroup>

            <SettingsControlGroup>
              <div className='space-y-0.5'>
                <h4 className='text-sm font-medium'>{t('Failure handling')}</h4>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Control retries on the selected channel and when failed channels become available again.'
                  )}
                </p>
              </div>
              <SettingsControlChildren className='grid gap-4 md:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='ChannelRouteSameChannelRetries'
                  render={({ field }) => {
                    const parsedValue = Number(field.value)
                    const sameChannelRetries = Number.isFinite(parsedValue)
                      ? parsedValue
                      : 0

                    return (
                      <FormItem>
                        <div className='flex min-h-5 items-center justify-between gap-2'>
                          <FormLabel>{t('Same-channel retries')}</FormLabel>
                          <label className='text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs'>
                            <span>{t('Disable same-channel retries')}</span>
                            <Switch
                              size='sm'
                              checked={sameChannelRetries === 0}
                              disabled={!routeEnabled}
                              onCheckedChange={(disabled) => {
                                const next = resolveSameChannelRetryToggle(
                                  sameChannelRetries,
                                  disabled,
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
                            min={1}
                            max={10}
                            step={1}
                            disabled={!routeEnabled || sameChannelRetries === 0}
                            {...safeNumberFieldProps(field)}
                            onChange={(event) => {
                              const value = event.target.valueAsNumber
                              if (!Number.isFinite(value)) return
                              field.onChange(value)
                              if (value > 0) {
                                enabledSameChannelRetriesRef.current = value
                              }
                            }}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Number of retries on the current channel before switching channels'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )
                  }}
                />

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
                          <FormLabel>{t('Cooldown time (seconds)')}</FormLabel>
                          <label className='text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs'>
                            <span>{t('Disable cooldown')}</span>
                            <Switch
                              size='sm'
                              checked={cooldownSeconds === 0}
                              disabled={!routeEnabled}
                              onCheckedChange={(disabled) => {
                                const next = resolveRouteCooldownToggle(
                                  cooldownSeconds,
                                  disabled,
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
                            disabled={!routeEnabled || cooldownSeconds === 0}
                            {...safeNumberFieldProps(field)}
                            onChange={(event) => {
                              const value = event.target.valueAsNumber
                              if (!Number.isFinite(value)) return
                              field.onChange(value)
                              if (value > 0) {
                                enabledCooldownSecondsRef.current = value
                              }
                            }}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'How long a failed routed channel stays out of selection before it is tried again'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )
                  }}
                />
              </SettingsControlChildren>
            </SettingsControlGroup>

            <SettingsControlGroup>
              <FormField
                control={form.control}
                name='ChannelRouteGroupExclusionsEnabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Route exclusion groups')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Configure whether each group skips same-channel retries, next-channel failover, or both'
                        )}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        disabled={!routeEnabled}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </SettingsSwitchItem>
                )}
              />

              <FormField
                control={form.control}
                name='ChannelRouteGroupExclusions'
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <GroupExclusionEditor
                        value={field.value}
                        groupOptions={groupOptions}
                        disabled={
                          !routeEnabled ||
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
            </SettingsControlGroup>
          </SettingsForm>
        </Form>
      </SettingsSection>

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={t('Confirm clearing all route affinity')}
        desc={t(
          'This clears every saved route affinity record. Future requests will select channels again.'
        )}
        confirmText={t('Clear')}
        destructive
        isLoading={isClearing}
        handleConfirm={handleClearAll}
      />
    </>
  )
}
