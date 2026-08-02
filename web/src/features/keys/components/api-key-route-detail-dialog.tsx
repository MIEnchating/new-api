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
import type { TFunction } from 'i18next'
import { Clock, Loader2, Network, RotateCcw, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { GroupBadge } from '@/components/group-badge'
import { StatusBadge, type StatusBadgeProps } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import {
  clearApiKeyRouteCooldown,
  getApiKeyRouteStatus,
  updateApiKeyGroupRoutes,
} from '../api'
import { canDisableGroupRoute, parseApiKeyGroupRouteConfig } from '../lib'
import type { ApiKeyGroupRoute, RouteStatus } from '../types'
import { useApiKeys } from './api-keys-provider'

function formatCooldown(seconds: number, t: TFunction) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '-'

  if (seconds >= 86_400 && seconds % 86_400 === 0) {
    return `${seconds / 86_400} ${t('days')}`
  }
  if (seconds >= 3_600 && seconds % 3_600 === 0) {
    return `${seconds / 3_600} ${t('hours')}`
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60} ${t('minutes')}`
  }

  return `${seconds} ${t('seconds')}`
}

function getRouteCooldownRemaining(
  routeStatus: RouteStatus | undefined,
  now: number
) {
  if (!routeStatus) {
    return 0
  }
  if (routeStatus.cooldown_until) {
    return Math.max(0, routeStatus.cooldown_until - now)
  }
  return Math.max(0, routeStatus.cooldown_remaining_seconds ?? 0)
}

export function ApiKeyRouteDetailDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, setCurrentRow, triggerRefresh } =
    useApiKeys()
  const [isResettingAllCooldowns, setIsResettingAllCooldowns] = useState(false)
  const [resettingGroup, setResettingGroup] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [draftRoutes, setDraftRoutes] = useState<ApiKeyGroupRoute[]>([])
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const storedRoutes = useMemo(
    () => parseApiKeyGroupRouteConfig(currentRow?.group_route_config),
    [currentRow?.group_route_config]
  )
  const routes = draftRoutes
  const isDirty = JSON.stringify(draftRoutes) !== JSON.stringify(storedRoutes)
  const { data: routeStatusData, refetch: refetchRouteStatus } = useQuery({
    queryKey: ['api-key-route-status', currentRow?.id],
    queryFn: () => getApiKeyRouteStatus(currentRow?.id ?? 0),
    enabled: open === 'route-detail' && !!currentRow?.id,
  })
  const routeStatusMap = useMemo(() => {
    const statusesByGroup = new Map<string, RouteStatus[]>()
    for (const status of routeStatusData?.data ?? []) {
      if (!status.group) continue
      const statuses = statusesByGroup.get(status.group) ?? []
      statuses.push(status)
      statusesByGroup.set(status.group, statuses)
    }
    return statusesByGroup
  }, [routeStatusData?.data])
  const hasActiveCooldown = (routeStatusData?.data ?? []).some(
    (status) => getRouteCooldownRemaining(status, now) > 0
  )

  useEffect(() => {
    if (open !== 'route-detail') {
      return
    }
    setDraftRoutes(storedRoutes)
    setNow(Math.floor(Date.now() / 1000))
    const timer = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [open, currentRow?.id, storedRoutes])

  const updateDraftRoute = (
    index: number,
    patch: Partial<ApiKeyGroupRoute>
  ) => {
    setDraftRoutes((current) =>
      current.map((route, routeIndex) =>
        routeIndex === index ? { ...route, ...patch } : route
      )
    )
  }

  const handleRouteEnabledChange = (index: number, enabled: boolean) => {
    if (!enabled && !canDisableGroupRoute(draftRoutes, index)) {
      toast.error(t('Please enable at least one route group'))
      return
    }
    updateDraftRoute(index, { enabled })
  }

  const handleSaveRoutes = async () => {
    if (!currentRow?.id || !isDirty || isSaving) return
    if (
      draftRoutes.some(
        (route) => !Number.isInteger(route.priority) || route.priority < 0
      )
    ) {
      toast.error(t('Priority must be zero or greater'))
      return
    }

    setIsSaving(true)
    try {
      const result = await updateApiKeyGroupRoutes(currentRow.id, draftRoutes)
      if (!result.success || !result.data) {
        toast.error(result.message || t('Save failed, please retry'))
        return
      }
      setCurrentRow(result.data)
      setDraftRoutes(
        parseApiKeyGroupRouteConfig(result.data.group_route_config)
      )
      triggerRefresh()
      await refetchRouteStatus()
      toast.success(t('Saved successfully'))
    } catch {
      toast.error(t('Save failed, please retry'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleResetCooldown = async (group?: string) => {
    if (!currentRow?.id || isResettingAllCooldowns || resettingGroup) return
    if (group) {
      setResettingGroup(group)
    } else {
      setIsResettingAllCooldowns(true)
    }
    try {
      const result = await clearApiKeyRouteCooldown(currentRow.id, group)
      if (!result.success) {
        toast.error(result.message || t('Failed to reset cooldown'))
        return
      }
      setNow(Math.floor(Date.now() / 1000))
      await refetchRouteStatus()
      toast.success(t('Cooldown reset'))
    } catch {
      toast.error(t('Failed to reset cooldown'))
    } finally {
      setIsResettingAllCooldowns(false)
      setResettingGroup(null)
    }
  }

  return (
    <Dialog open={open === 'route-detail'} onOpenChange={() => setOpen(null)}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Network className='size-4' />
            {t('Group routing rules')}
          </DialogTitle>
          <DialogDescription>
            {currentRow?.name
              ? `${t('Name')}: ${currentRow.name}`
              : t('Details')}
          </DialogDescription>
        </DialogHeader>

        {routes.length > 0 ? (
          <div className='space-y-2'>
            {routes.map((route, index) => {
              const enabled = route.enabled !== false
              const coolingStatuses = enabled
                ? (routeStatusMap.get(route.group) ?? [])
                    .map((status) => ({
                      status,
                      remaining: getRouteCooldownRemaining(status, now),
                    }))
                    .filter(({ remaining }) => remaining > 0)
                : []
              const cooling = coolingStatuses.length > 0
              let statusLabel = t('Normal')
              let statusVariant: StatusBadgeProps['variant'] = 'success'
              if (!enabled) {
                statusLabel = t('Disabled')
                statusVariant = 'neutral'
              } else if (cooling) {
                statusLabel = t('Cooling')
                statusVariant = 'warning'
              }
              return (
                <div
                  key={route.group}
                  className='border-border/70 bg-muted/20 grid grid-cols-[2rem_minmax(0,1fr)_auto_auto_auto] items-center gap-x-2 gap-y-2 rounded-lg border px-3 py-2.5 max-[520px]:grid-cols-[2rem_minmax(0,1fr)_auto]'
                >
                  <span className='bg-background text-muted-foreground flex size-7 items-center justify-center rounded-md border text-xs font-medium tabular-nums'>
                    {index + 1}
                  </span>

                  <div className='min-w-0 space-y-1'>
                    <div className='flex min-w-0 flex-wrap items-center gap-2'>
                      <GroupBadge group={route.group} />
                      <StatusBadge
                        label={statusLabel}
                        variant={statusVariant}
                        copyable={false}
                      />
                    </div>
                  </div>

                  <div className='flex items-center gap-1.5 max-[520px]:col-start-2 max-[520px]:row-start-2 max-[520px]:border-t max-[520px]:pt-2'>
                    <span className='text-muted-foreground text-xs'>
                      {t('Priority')}
                    </span>
                    <Input
                      type='number'
                      min={0}
                      step={1}
                      value={route.priority}
                      onChange={(event) =>
                        updateDraftRoute(index, {
                          priority: Number(event.target.value),
                        })
                      }
                      aria-label={`${route.group} ${t('Priority')}`}
                      className='h-7 w-14 text-center tabular-nums'
                    />
                  </div>

                  <div className='flex items-center justify-end gap-1 text-right max-[520px]:col-start-3 max-[520px]:row-start-2 max-[520px]:border-t max-[520px]:pt-2'>
                    <div>
                      <div className='flex items-center justify-end gap-1 text-sm font-medium tabular-nums'>
                        <Clock className='text-muted-foreground size-3.5' />
                        {cooling
                          ? coolingStatuses.length
                          : formatCooldown(route.cooldown_seconds, t)}
                      </div>
                      <div className='text-muted-foreground text-xs'>
                        {cooling ? t('Cooling') : t('Cooldown')}
                      </div>
                    </div>
                    <TooltipProvider delay={100}>
                      <Tooltip>
                        <TooltipTrigger
                          render={<span className='inline-flex' />}
                        >
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            onClick={() =>
                              void handleResetCooldown(route.group)
                            }
                            disabled={
                              !cooling ||
                              isResettingAllCooldowns ||
                              !!resettingGroup
                            }
                            aria-label={t('Reset group cooldown')}
                          >
                            {resettingGroup === route.group ? (
                              <Loader2 className='size-3.5 animate-spin' />
                            ) : (
                              <RotateCcw className='size-3.5' />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {cooling
                            ? t('Reset group cooldown')
                            : t('No active cooldown for this group')}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  <TooltipProvider delay={100}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className='inline-flex max-[520px]:col-start-3 max-[520px]:row-start-1' />
                        }
                      >
                        <Switch
                          checked={enabled}
                          onCheckedChange={(checked) =>
                            handleRouteEnabledChange(index, checked)
                          }
                          aria-label={`${route.group} ${t('Enabled')}`}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        {enabled ? t('Enabled') : t('Disabled')}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {cooling && (
                    <div className='col-span-4 col-start-2 space-y-1.5 border-t pt-2 max-[520px]:col-span-2'>
                      {coolingStatuses.map(({ status, remaining }) => (
                        <div
                          key={`${status.model}:${status.request_path}`}
                          className='flex min-w-0 items-center justify-between gap-3 text-xs'
                        >
                          <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
                            <StatusBadge
                              label={status.model || '-'}
                              variant='neutral'
                              copyable={false}
                            />
                            {status.request_path && (
                              <span className='text-muted-foreground truncate font-mono'>
                                {status.request_path}
                              </span>
                            )}
                          </div>
                          <span className='shrink-0 font-medium tabular-nums'>
                            {formatCooldown(remaining, t)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className='border-border text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm'>
            {t('No data')}
          </div>
        )}

        <DialogFooter className='sm:flex-wrap sm:items-center'>
          <Button
            type='button'
            variant='outline'
            className='sm:mr-auto'
            onClick={() => void handleResetCooldown()}
            disabled={
              !hasActiveCooldown || isResettingAllCooldowns || !!resettingGroup
            }
          >
            {isResettingAllCooldowns ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <RotateCcw className='size-4' />
            )}
            {t('Reset all cooldowns')}
          </Button>
          <Button type='button' variant='outline' onClick={() => setOpen(null)}>
            {t('Close')}
          </Button>
          <Button
            type='button'
            onClick={() => void handleSaveRoutes()}
            disabled={!isDirty || isSaving}
          >
            {isSaving ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Save className='size-4' />
            )}
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
