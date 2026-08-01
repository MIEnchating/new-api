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
import {
  ChevronDown,
  KeyRound,
  Network,
  Plus,
  Settings2,
  Trash2,
  WalletCards,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useFieldArray,
  useForm,
  type SubmitErrorHandler,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
  sideDrawerSwitchItemClassName,
} from '@/components/drawer-layout'
import { MultiSelect } from '@/components/multi-select'
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
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useStatus } from '@/hooks/use-status'
import { getUserModels, getUserGroups } from '@/lib/api'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { cn } from '@/lib/utils'

import {
  createApiKey,
  updateApiKey,
  getApiKey,
  getTokenAutoGroups,
} from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import {
  canConfigureGroupRouteCooldown,
  getApiKeyFormSchema,
  getAutomaticGroupRoutePriorities,
  type ApiKeyFormValues,
  getApiKeyFormDefaultValues,
  transformFormDataToPayload,
  transformApiKeyToFormDefaults,
} from '../lib'
import type { ApiKey } from '../types'
import {
  ApiKeyGroupCombobox,
  type ApiKeyGroupOption,
} from './api-key-group-combobox'
import { useApiKeys } from './api-keys-provider'
import { AutoGroupOrderEditor } from './auto-group-order-editor'

type ApiKeyMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: ApiKey
}

function getFormErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : undefined
}

export function ApiKeysMutateDrawer({
  open,
  onOpenChange,
  currentRow,
}: ApiKeyMutateDrawerProps) {
  const { t } = useTranslation()
  const isUpdate = !!currentRow
  const currentRowId = currentRow?.id
  const { triggerRefresh } = useApiKeys()
  const { status, loading: statusLoading } = useStatus()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [autoSortGroupRoutes, setAutoSortGroupRoutes] = useState(false)
  const manualRoutePrioritiesRef = useRef(new Map<string, number>())
  const enabledRouteCooldownsRef = useRef(new Map<string, number>())
  const [initializedTarget, setInitializedTarget] = useState<string | null>(
    null
  )
  const defaultUseAutoGroup = status?.default_use_auto_group === true

  // Fetch models
  const { data: modelsData } = useQuery({
    queryKey: ['user-models'],
    queryFn: getUserModels,
    enabled: open,
    staleTime: 0,
  })

  // Fetch groups
  const {
    data: groupsData,
    isFetched: groupsFetched,
    isFetching: groupsFetching,
  } = useQuery({
    queryKey: ['user-groups'],
    queryFn: getUserGroups,
    enabled: open,
    staleTime: 0,
  })

  const {
    data: apiKeyData,
    isFetched: apiKeyFetched,
    isFetching: apiKeyFetching,
  } = useQuery({
    queryKey: ['api-key', currentRowId],
    queryFn: () => getApiKey(currentRowId ?? 0),
    enabled: open && isUpdate && currentRowId !== undefined,
    staleTime: 0,
  })

  const {
    data: autoGroupsData,
    isFetched: autoGroupsFetched,
    isFetching: autoGroupsFetching,
  } = useQuery({
    queryKey: ['token-auto-groups'],
    queryFn: getTokenAutoGroups,
    enabled: open,
    staleTime: 0,
  })

  const models = modelsData?.data || []
  const groupsRaw = groupsData?.data
  const groups = useMemo<ApiKeyGroupOption[]>(
    () =>
      Object.entries(groupsRaw ?? {})
        .map(([key, info]) => ({
          value: key,
          label: key,
          desc: info.desc || key,
          ratio: info.ratio,
          order: info.order,
        }))
        .sort(
          (a, b) =>
            (a.order ?? Number.MAX_SAFE_INTEGER) -
              (b.order ?? Number.MAX_SAFE_INTEGER) ||
            a.label.localeCompare(b.label)
        ),
    [groupsRaw]
  )
  const routableGroups = useMemo(
    () => groups.filter((group) => group.value !== 'auto'),
    [groups]
  )
  const backendHasAuto = groups.some((g) => g.value === 'auto')
  const availableAutoGroupNames = useMemo(
    () => groups.filter((group) => group.value !== 'auto').map((g) => g.value),
    [groups]
  )
  const globalAutoGroups = useMemo(() => {
    const available = new Set(availableAutoGroupNames)
    return (autoGroupsData?.data?.groups || []).filter((group) =>
      available.has(group)
    )
  }, [autoGroupsData, availableAutoGroupNames])
  const globalAutoGroupOptions = useMemo(() => {
    const groupsByValue = new Map(groups.map((group) => [group.value, group]))
    return globalAutoGroups.flatMap((group) => {
      const option = groupsByValue.get(group)
      return option ? [option] : []
    })
  }, [globalAutoGroups, groups])
  const maxAutoGroups =
    Number.isInteger(autoGroupsData?.data?.max_count) &&
    Number(autoGroupsData?.data?.max_count) > 0
      ? Number(autoGroupsData?.data?.max_count)
      : 5
  const schema = useMemo(
    () => getApiKeyFormSchema(t, maxAutoGroups),
    [t, maxAutoGroups]
  )

  const form = useForm<ApiKeyFormValues>({
    resolver: zodResolver(schema),
    defaultValues: getApiKeyFormDefaultValues(),
  })
  const routeFields = useFieldArray({
    control: form.control,
    name: 'group_routes',
  })

  // Load existing data when updating
  useEffect(() => {
    if (!open) {
      setInitializedTarget(null)
      return
    }
    if (
      !groupsFetched ||
      groupsFetching ||
      !autoGroupsFetched ||
      autoGroupsFetching
    ) {
      return
    }
    if (isUpdate && (!apiKeyFetched || apiKeyFetching)) return
    if (!isUpdate && statusLoading) return

    const target = isUpdate && currentRow ? `update:${currentRow.id}` : 'create'
    if (initializedTarget === target) return
    setAutoSortGroupRoutes(false)
    manualRoutePrioritiesRef.current.clear()
    enabledRouteCooldownsRef.current.clear()
    if (isUpdate && currentRow) {
      if (apiKeyData?.success && apiKeyData.data) {
        form.reset(
          transformApiKeyToFormDefaults(
            apiKeyData.data,
            availableAutoGroupNames,
            maxAutoGroups
          )
        )
        setInitializedTarget(target)
      }
    } else {
      form.reset(
        getApiKeyFormDefaultValues(defaultUseAutoGroup && backendHasAuto)
      )
      setInitializedTarget(target)
    }
  }, [
    open,
    isUpdate,
    currentRow,
    form,
    defaultUseAutoGroup,
    statusLoading,
    backendHasAuto,
    groupsFetched,
    groupsFetching,
    autoGroupsFetched,
    autoGroupsFetching,
    apiKeyData,
    apiKeyFetched,
    apiKeyFetching,
    availableAutoGroupNames,
    maxAutoGroups,
    initializedTarget,
  ])

  const formTarget =
    isUpdate && currentRow ? `update:${currentRow.id}` : 'create'
  const isFormInitialized = initializedTarget === formTarget
  const selectedGroup = form.watch('group')

  // Clear stale selections after group permissions change; never pick for the user.
  useEffect(() => {
    if (!open || groups.length === 0) return
    const currentGroup = selectedGroup
    if (currentGroup && !groups.some((g) => g.value === currentGroup)) {
      form.setValue('group', '')
      if (currentGroup === 'auto') {
        form.setValue('auto_groups', [])
        form.setValue('auto_groups_mode', 'inherit')
        form.setValue('cross_group_retry', false)
      }
    }
    const currentRoutes = form.getValues('group_routes') || []
    currentRoutes.forEach((route, index) => {
      if (
        route.group &&
        !routableGroups.some((group) => group.value === route.group)
      ) {
        form.setValue(`group_routes.${index}.group`, '')
      }
    })
  }, [open, groups, routableGroups, form, selectedGroup])

  const onSubmit = async (data: ApiKeyFormValues) => {
    setIsSubmitting(true)
    try {
      const basePayload = transformFormDataToPayload(data)

      if (isUpdate && currentRow) {
        const result = await updateApiKey({
          ...basePayload,
          id: currentRow.id,
        })
        if (result.success) {
          toast.success(t(SUCCESS_MESSAGES.API_KEY_UPDATED))
          onOpenChange(false)
          triggerRefresh()
        } else {
          toast.error(result.message || t(ERROR_MESSAGES.UPDATE_FAILED))
        }
      } else {
        // Create mode - handle batch creation
        const count = data.tokenCount || 1
        let successCount = 0

        for (let i = 0; i < count; i++) {
          const result = await createApiKey({
            ...basePayload,
            name:
              i === 0 && data.name
                ? data.name
                : `${data.name || 'default'}-${Math.random().toString(36).slice(2, 8)}`,
          })
          if (result.success) {
            successCount++
          } else {
            toast.error(result.message || t(ERROR_MESSAGES.CREATE_FAILED))
            break
          }
        }

        if (successCount > 0) {
          toast.success(
            t('Successfully created {{count}} API Key(s)', {
              count: successCount,
            })
          )
          onOpenChange(false)
          triggerRefresh()
        }
      }
    } catch {
      toast.error(t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setIsSubmitting(false)
    }
  }

  const onInvalid: SubmitErrorHandler<ApiKeyFormValues> = () => {
    toast.error(t('Please fix the highlighted fields before saving'))
  }

  const handleSetExpiry = (months: number, days: number, hours: number) => {
    if (months === 0 && days === 0 && hours === 0) {
      form.setValue('expired_time', undefined)
      return
    }

    const now = new Date()
    now.setMonth(now.getMonth() + months)
    now.setDate(now.getDate() + days)
    now.setHours(now.getHours() + hours)

    form.setValue('expired_time', now)
  }

  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const tokensOnly = currencyMeta.kind === 'tokens'
  const quotaLabel = t('Quota ({{currency}})', { currency: currencyLabel })
  const quotaPlaceholder = tokensOnly
    ? t('Enter quota in tokens')
    : t('Enter quota in {{currency}}', { currency: currencyLabel })
  const autoGroupsMode = form.watch('auto_groups_mode')
  const unlimitedQuota = form.watch('unlimited_quota')
  const groupRouteEnabled = form.watch('group_route_enabled')
  const groupRoutes = form.watch('group_routes') || []
  const cooldownUnavailable = !canConfigureGroupRouteCooldown(groupRoutes)
  const groupRoutesMessage = getFormErrorMessage(
    form.formState.errors.group_routes
  )
  const nextRoutePriority = () => {
    const priorities =
      form.getValues('group_routes')?.map((route) => route.priority) || []
    if (priorities.length === 0) {
      return 1
    }
    return Math.max(Math.max(...priorities) - 1, 0)
  }
  const nextManualRoutePriority = () => {
    if (!autoSortGroupRoutes) return nextRoutePriority()
    const priorities = routeFields.fields.flatMap((field) => {
      const priority = manualRoutePrioritiesRef.current.get(field.id)
      return priority == null ? [] : [priority]
    })
    return priorities.length > 0 ? Math.max(Math.min(...priorities) - 1, 0) : 1
  }
  const setAutomaticRoutePriorities = () => {
    getAutomaticGroupRoutePriorities(routeFields.fields.length).forEach(
      (priority, index) => {
        form.setValue(`group_routes.${index}.priority`, priority, {
          shouldDirty: true,
          shouldValidate: true,
        })
      }
    )
  }
  const handleAutoSortGroupRoutes = (checked: boolean) => {
    if (checked) {
      const routes = form.getValues('group_routes') || []
      manualRoutePrioritiesRef.current = new Map(
        routeFields.fields.map((field, index) => [
          field.id,
          routes[index]?.priority ?? 1,
        ])
      )
      setAutoSortGroupRoutes(true)
      setAutomaticRoutePriorities()
      return
    }

    routeFields.fields.forEach((field, index) => {
      const priority = manualRoutePrioritiesRef.current.get(field.id)
      if (priority == null) return
      form.setValue(`group_routes.${index}.priority`, priority, {
        shouldDirty: true,
        shouldValidate: true,
      })
    })
    manualRoutePrioritiesRef.current.clear()
    setAutoSortGroupRoutes(false)
  }

  useEffect(() => {
    if (!autoSortGroupRoutes) return
    const currentFieldIds = new Set(routeFields.fields.map((field) => field.id))
    for (const fieldId of manualRoutePrioritiesRef.current.keys()) {
      if (!currentFieldIds.has(fieldId)) {
        manualRoutePrioritiesRef.current.delete(fieldId)
      }
    }

    const routes = form.getValues('group_routes') || []
    const knownPriorities = routeFields.fields.flatMap((field) => {
      const priority = manualRoutePrioritiesRef.current.get(field.id)
      return priority == null ? [] : [priority]
    })
    let nextPriority =
      knownPriorities.length > 0
        ? Math.max(Math.min(...knownPriorities) - 1, 0)
        : 1
    routeFields.fields.forEach((field, index) => {
      if (manualRoutePrioritiesRef.current.has(field.id)) return
      manualRoutePrioritiesRef.current.set(
        field.id,
        routes[index]?.priority ?? nextPriority
      )
      nextPriority = Math.max(nextPriority - 1, 0)
    })
    getAutomaticGroupRoutePriorities(routeFields.fields.length).forEach(
      (priority, index) => {
        form.setValue(`group_routes.${index}.priority`, priority, {
          shouldDirty: true,
          shouldValidate: true,
        })
      }
    )
  }, [autoSortGroupRoutes, form, routeFields.fields])

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) {
          form.reset()
        }
      }}
    >
      <SheetContent
        className={sideDrawerContentClassName('max-w-none sm:!max-w-[620px]')}
      >
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isUpdate ? t('Update API Key') : t('Create API Key')}
          </SheetTitle>
          <SheetDescription>
            {isUpdate
              ? t('Update the API key by providing necessary info.')
              : t('Add a new API key by providing necessary info.')}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='api-key-form'
            onSubmit={form.handleSubmit(onSubmit, onInvalid)}
            aria-busy={!isFormInitialized}
            inert={!isFormInitialized || isSubmitting ? true : undefined}
            className={sideDrawerFormClassName('gap-5')}
          >
            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Basic Information')}
                description={t('Set API key basic information')}
                icon={<KeyRound className='size-4' />}
                iconTone='info'
              />
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Name')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('Enter a name')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='group_route_enabled'
                render={({ field }) => (
                  <FormItem className={sideDrawerSwitchItemClassName()}>
                    <div className='flex flex-col gap-0.5'>
                      <FormLabel className='text-sm'>
                        {t('Group routing')}
                      </FormLabel>
                      <FormDescription className='text-xs'>
                        {t(
                          'Route this key across multiple groups by priority and cooldown.'
                        )}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={!!field.value}
                        onCheckedChange={(checked) => {
                          field.onChange(checked)
                          if (checked && routeFields.fields.length === 0) {
                            routeFields.append({
                              group: '',
                              priority: 1,
                              cooldown_seconds: 60,
                              enabled: true,
                            })
                          }
                        }}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {groupRouteEnabled ? (
                <div className='flex flex-col gap-3'>
                  <SideDrawerSectionHeader
                    title={t('Group routing rules')}
                    description={t('Higher priority groups are tried first')}
                    icon={<Network className='size-4' />}
                  />
                  <FormField
                    control={form.control}
                    name='group_route_sticky'
                    render={({ field }) => (
                      <FormItem className={sideDrawerSwitchItemClassName()}>
                        <div className='flex flex-col gap-0.5'>
                          <FormLabel className='text-sm'>
                            {t('Group affinity')}
                          </FormLabel>
                          <FormDescription className='text-xs'>
                            {t(
                              'After a fallback route succeeds, keep using that successful group until it fails.'
                            )}
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={!!field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <div className={sideDrawerSwitchItemClassName()}>
                    <div className='flex flex-col gap-0.5'>
                      <Label
                        htmlFor='api-key-auto-sort-group-routes'
                        className='text-sm'
                      >
                        {t('Automatic priority sorting')}
                      </Label>
                      <p className='text-muted-foreground text-xs'>
                        {t(
                          'Assign priorities from highest to lowest based on the group list order. Turning it off restores the previous manual priorities.'
                        )}
                      </p>
                    </div>
                    <Switch
                      id='api-key-auto-sort-group-routes'
                      checked={autoSortGroupRoutes}
                      onCheckedChange={handleAutoSortGroupRoutes}
                    />
                  </div>
                  <div className='flex flex-col gap-3'>
                    {routeFields.fields.map((routeField, index) => (
                      <div
                        key={routeField.id}
                        className='border-border/70 grid min-w-0 gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem] sm:items-start'
                      >
                        <FormField
                          control={form.control}
                          name={`group_routes.${index}.group`}
                          render={({ field }) => (
                            <FormItem className='min-w-0 sm:col-span-2'>
                              <FormLabel className='min-h-5'>
                                {t('Group')}
                              </FormLabel>
                              <FormControl>
                                <ApiKeyGroupCombobox
                                  options={routableGroups}
                                  value={field.value}
                                  onValueChange={field.onChange}
                                  placeholder={t('Select a group')}
                                  compact
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name={`group_routes.${index}.enabled`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className='min-h-5'>
                                {t('Status')}
                              </FormLabel>
                              <FormControl>
                                <Switch
                                  checked={field.value !== false}
                                  onCheckedChange={field.onChange}
                                  className='my-[4px]'
                                  aria-label={t('Enabled')}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name={`group_routes.${index}.priority`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className='min-h-5'>
                                {t('Priority')}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type='number'
                                  min='0'
                                  step='1'
                                  disabled={autoSortGroupRoutes}
                                  onChange={(e) =>
                                    field.onChange(
                                      Number.parseInt(e.target.value, 10) || 0
                                    )
                                  }
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name={`group_routes.${index}.cooldown_seconds`}
                          render={({ field }) => (
                            <FormItem>
                              <div className='flex min-h-5 items-center justify-between gap-2'>
                                <FormLabel
                                  className={cn(
                                    cooldownUnavailable &&
                                      'text-muted-foreground'
                                  )}
                                >
                                  {t('Cooldown')}
                                </FormLabel>
                                <label className='text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs'>
                                  <span>{t('Disable cooldown')}</span>
                                  <Switch
                                    size='sm'
                                    checked={field.value === 0}
                                    disabled={cooldownUnavailable}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        const currentValue = field.value ?? 60
                                        if (currentValue > 0) {
                                          enabledRouteCooldownsRef.current.set(
                                            routeField.id,
                                            currentValue
                                          )
                                        }
                                        field.onChange(0)
                                        return
                                      }
                                      field.onChange(
                                        enabledRouteCooldownsRef.current.get(
                                          routeField.id
                                        ) ?? 60
                                      )
                                    }}
                                  />
                                </label>
                              </div>
                              <TooltipProvider delay={100}>
                                <Tooltip>
                                  <TooltipTrigger
                                    render={<div className='w-full' />}
                                  >
                                    <FormControl>
                                      <Input
                                        {...field}
                                        type='number'
                                        min='0'
                                        max='31536000'
                                        step='1'
                                        disabled={
                                          cooldownUnavailable ||
                                          field.value === 0
                                        }
                                        onChange={(event) => {
                                          const value = Number.parseInt(
                                            event.target.value,
                                            10
                                          )
                                          const nextValue = Number.isNaN(value)
                                            ? 1
                                            : value
                                          field.onChange(nextValue)
                                          if (nextValue > 0) {
                                            enabledRouteCooldownsRef.current.set(
                                              routeField.id,
                                              nextValue
                                            )
                                          }
                                        }}
                                      />
                                    </FormControl>
                                  </TooltipTrigger>
                                  {cooldownUnavailable ? (
                                    <TooltipContent
                                      side='top'
                                      className='max-w-xs'
                                    >
                                      {t(
                                        'Add and enable at least two group routing rules to configure cooldown.'
                                      )}
                                    </TooltipContent>
                                  ) : null}
                                </Tooltip>
                              </TooltipProvider>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <div className='grid justify-items-start gap-2 sm:col-start-3 sm:row-start-2'>
                          <span
                            aria-hidden='true'
                            className='hidden min-h-5 sm:block'
                          />
                          <Button
                            type='button'
                            variant='outline'
                            size='icon'
                            onClick={() => routeFields.remove(index)}
                            aria-label={t('Remove group routing rule')}
                          >
                            <Trash2 className='size-4' />
                          </Button>
                        </div>
                      </div>
                    ))}

                    <Button
                      type='button'
                      variant='outline'
                      className='w-full justify-center gap-2'
                      onClick={() =>
                        routeFields.append({
                          group: '',
                          priority: nextManualRoutePriority(),
                          cooldown_seconds: 60,
                          enabled: true,
                        })
                      }
                    >
                      <Plus className='size-4' />
                      {t('Add group routing rule')}
                    </Button>
                    {groupRoutesMessage && (
                      <p className='text-destructive text-sm'>
                        {t(groupRoutesMessage)}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <FormField
                    control={form.control}
                    name='group'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Group')}</FormLabel>
                        <FormControl>
                          <ApiKeyGroupCombobox
                            options={groups}
                            value={field.value}
                            onValueChange={(group) => {
                              field.onChange(group)
                              form.setValue(
                                'cross_group_retry',
                                group === 'auto',
                                { shouldDirty: true }
                              )
                            }}
                            placeholder={t('Select a group')}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {selectedGroup === 'auto' && (
                    <FormField
                      control={form.control}
                      name='auto_groups'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Auto group order')}</FormLabel>
                          <FormDescription>
                            {t(
                              'Choose and order the groups this API key will try.'
                            )}
                          </FormDescription>
                          <FormControl>
                            <AutoGroupOrderEditor
                              value={field.value}
                              mode={autoGroupsMode}
                              options={groups}
                              globalOptions={globalAutoGroupOptions}
                              maxCount={maxAutoGroups}
                              onChange={(value) => {
                                form.setValue('auto_groups_mode', value.mode, {
                                  shouldDirty: true,
                                  shouldValidate: false,
                                })
                                form.setValue(
                                  'auto_groups',
                                  value.groups.slice(0, maxAutoGroups),
                                  {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                  }
                                )
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {selectedGroup === 'auto' && (
                    <FormField
                      control={form.control}
                      name='cross_group_retry'
                      render={({ field }) => (
                        <FormItem className={sideDrawerSwitchItemClassName()}>
                          <div className='flex flex-col gap-0.5'>
                            <FormLabel className='text-sm'>
                              {t('Cross-group retry')}
                            </FormLabel>
                            <FormDescription className='line-clamp-2 text-xs sm:line-clamp-none'>
                              {t(
                                'When enabled, if channels in the current group fail, it will try channels in the next group in order.'
                              )}
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={!!field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  )}
                </>
              )}

              <FormField
                control={form.control}
                name='expired_time'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Expiration Time')}</FormLabel>
                    <div className='grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                      <FormControl>
                        <DateTimePicker
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={t('Never expires')}
                          className='min-w-0 [&_input[type=time]]:w-24 sm:[&_input[type=time]]:w-32'
                        />
                      </FormControl>
                      <div className='grid grid-cols-4 gap-2 sm:flex'>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='px-2 text-xs sm:px-3 sm:text-sm'
                          onClick={() => handleSetExpiry(0, 0, 0)}
                        >
                          {t('Never')}
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='px-2 text-xs sm:px-3 sm:text-sm'
                          onClick={() => handleSetExpiry(1, 0, 0)}
                        >
                          {t('1 Month')}
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='px-2 text-xs sm:px-3 sm:text-sm'
                          onClick={() => handleSetExpiry(0, 1, 0)}
                        >
                          {t('1 Day')}
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          className='px-2 text-xs sm:px-3 sm:text-sm'
                          onClick={() => handleSetExpiry(0, 0, 1)}
                        >
                          {t('1 Hour')}
                        </Button>
                      </div>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!isUpdate && (
                <FormField
                  control={form.control}
                  name='tokenCount'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Quantity')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min='1'
                          placeholder={t('Number of keys to create')}
                          onChange={(e) =>
                            field.onChange(
                              Number.parseInt(e.target.value, 10) || 1
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Create multiple API keys at once (random suffix will be added to names)'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </SideDrawerSection>

            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Quota Settings')}
                description={t('Set quota amount and limits')}
                icon={<WalletCards className='size-4' />}
                iconTone='success'
              />
              {!unlimitedQuota && (
                <FormField
                  control={form.control}
                  name='remain_quota_dollars'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{quotaLabel}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          step={tokensOnly ? 1 : 0.01}
                          placeholder={quotaPlaceholder}
                          onChange={(e) =>
                            field.onChange(
                              Number.parseFloat(e.target.value) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {tokensOnly
                          ? t('Enter the quota amount in tokens')
                          : t('Enter the quota amount in {{currency}}', {
                              currency: currencyLabel,
                            })}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name='unlimited_quota'
                render={({ field }) => (
                  <FormItem className={sideDrawerSwitchItemClassName()}>
                    <div className='flex flex-col gap-0.5'>
                      <FormLabel className='text-sm'>
                        {t('Unlimited Quota')}
                      </FormLabel>
                      <FormDescription className='text-xs'>
                        {t('Enable unlimited quota for this API key')}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </SideDrawerSection>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <SideDrawerSection>
                <CollapsibleTrigger
                  render={
                    <button
                      type='button'
                      className='hover:bg-muted/40 flex w-full items-center gap-3 rounded-md py-1.5 text-left transition-colors'
                    />
                  }
                >
                  <SideDrawerSectionHeader
                    className='flex-1'
                    title={t('Advanced Settings')}
                    description={t('Set API key access restrictions')}
                    icon={<Settings2 className='size-4' />}
                  />
                  <ChevronDown
                    className={cn(
                      'text-muted-foreground size-4 shrink-0 transition-transform',
                      advancedOpen && 'rotate-180'
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className='flex flex-col gap-4 pt-2'>
                    <FormField
                      control={form.control}
                      name='model_limits'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Model Limits')}</FormLabel>
                          <FormControl>
                            <MultiSelect
                              options={models.map((m) => ({
                                label: m,
                                value: m,
                              }))}
                              selected={field.value}
                              onChange={field.onChange}
                              placeholder={t(
                                'Select models (empty for allow all)'
                              )}
                            />
                          </FormControl>
                          <FormDescription>
                            {t('Limit which models can be used with this key')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name='allow_ips'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t('IP Whitelist (supports CIDR)')}
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              className='min-h-20 resize-none'
                              placeholder={t(
                                'One IP per line (empty for no restriction)'
                              )}
                              rows={3}
                            />
                          </FormControl>
                          <FormDescription>
                            {t(
                              'Do not over-trust this feature. IP may be spoofed. Please use with nginx, CDN and other gateways.'
                            )}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CollapsibleContent>
              </SideDrawerSection>
            </Collapsible>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose
            render={<Button variant='outline' className='w-full sm:w-auto' />}
          >
            {t('Close')}
          </SheetClose>
          <Button
            type='button'
            onClick={form.handleSubmit(onSubmit, onInvalid)}
            disabled={!isFormInitialized || isSubmitting}
            className='w-full sm:w-auto'
          >
            {isSubmitting ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
