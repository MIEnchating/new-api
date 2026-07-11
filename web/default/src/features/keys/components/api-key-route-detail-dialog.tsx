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
import { Clock, Edit, Route } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/design-system/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/design-system/dialog'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'

import { getApiKeyRouteStatus } from '../api'
import { parseApiKeyGroupRouteConfig } from '../lib'
import type { RouteStatus } from '../types'
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
  const { open, setOpen, currentRow } = useApiKeys()
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const routes = parseApiKeyGroupRouteConfig(currentRow?.group_route_config)
  const { data: routeStatusData } = useQuery({
    queryKey: ['api-key-route-status', currentRow?.id],
    queryFn: () => getApiKeyRouteStatus(currentRow?.id ?? 0),
    enabled: open === 'route-detail' && !!currentRow?.id,
  })
  const routeStatusMap = useMemo(
    () =>
      new Map(
        (routeStatusData?.data ?? []).map((status) => [status.group, status])
      ),
    [routeStatusData?.data]
  )

  useEffect(() => {
    if (open !== 'route-detail') {
      return
    }
    setNow(Math.floor(Date.now() / 1000))
    const timer = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [open])

  return (
    <Dialog open={open === 'route-detail'} onOpenChange={() => setOpen(null)}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Route className='size-4' />
            {t('Route Groups')}
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
              const routeStatus = routeStatusMap.get(route.group)
              const cooldownRemaining = getRouteCooldownRemaining(
                routeStatus,
                now
              )
              const cooling = cooldownRemaining > 0
              return (
                <div
                  key={route.group}
                  className='border-border/70 bg-muted/20 grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5'
                >
                  <span className='bg-background text-muted-foreground flex size-7 items-center justify-center rounded-md border text-xs font-medium tabular-nums'>
                    {index + 1}
                  </span>

                  <div className='min-w-0 space-y-1'>
                    <div className='flex min-w-0 flex-wrap items-center gap-2'>
                      <GroupBadge group={route.group} />
                      <StatusBadge variant='neutral' appearance='outline'>
                        {t('Priority')} {route.priority}
                      </StatusBadge>
                      <StatusBadge variant={cooling ? 'warning' : 'success'}>
                        {cooling ? t('Cooling') : t('Normal')}
                      </StatusBadge>
                    </div>
                  </div>

                  <div className='text-right'>
                    <div className='flex items-center justify-end gap-1.5 text-sm font-medium tabular-nums'>
                      <Clock className='text-muted-foreground size-3.5' />
                      {formatCooldown(
                        cooling ? cooldownRemaining : route.cooldown_seconds,
                        t
                      )}
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      {cooling ? t('Remaining') : t('Cooldown')}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className='border-border text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm'>
            {t('No data')}
          </div>
        )}

        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => setOpen(null)}>
            {t('Close')}
          </Button>
          <Button type='button' onClick={() => setOpen('update')}>
            <Edit className='size-4' />
            {t('Edit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
