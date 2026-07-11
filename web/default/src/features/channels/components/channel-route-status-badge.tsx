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
import { Timer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { CHANNEL_STATUS } from '../constants'
import type { Channel } from '../types'

type ChannelRouteStatusBadgeProps = {
  channelStatus: Channel['status']
  routeStatus?: Channel['route_status']
}

type CooldownStatus = {
  cooling: boolean
  cooldown_until?: number
  cooldown_remaining_seconds?: number
}

type CooldownEntry = {
  key: string
  group?: string
  until: number
}

type StaticChannelState = {
  label: string
  variant: StatusVariant
}

function resolveStaticChannelState(
  channelStatus: Channel['status']
): StaticChannelState | null {
  switch (channelStatus) {
    case CHANNEL_STATUS.ENABLED:
      return null
    case CHANNEL_STATUS.MANUAL_DISABLED:
      return { label: 'Disabled', variant: 'neutral' }
    case CHANNEL_STATUS.AUTO_DISABLED:
      return { label: 'Error', variant: 'danger' }
    default:
      return { label: 'Unknown', variant: 'neutral' }
  }
}

function resolveCooldownUntil(status: CooldownStatus, receivedAt: number) {
  if (status.cooldown_until && status.cooldown_until > 0) {
    return status.cooldown_until
  }
  if (!status.cooling || !status.cooldown_remaining_seconds) {
    return 0
  }
  return receivedAt + Math.max(0, status.cooldown_remaining_seconds)
}

function formatCountdown(seconds: number) {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60
  const minuteText = String(minutes).padStart(2, '0')
  const secondText = String(remainingSeconds).padStart(2, '0')

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${minuteText}:${secondText}`
  }
  return `${minuteText}:${secondText}`
}

export function ChannelRouteStatusBadge(props: ChannelRouteStatusBadgeProps) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const cooldownEntries = useMemo<CooldownEntry[]>(() => {
    if (props.channelStatus !== CHANNEL_STATUS.ENABLED || !props.routeStatus) {
      return []
    }

    const receivedAt = Math.floor(Date.now() / 1000)
    const groupEntries = (props.routeStatus.groups ?? [])
      .map((group, index) => ({
        key: `${group.group}-${index}`,
        group: group.group,
        until: resolveCooldownUntil(group, receivedAt),
      }))
      .filter((entry) => entry.until > 0)

    if (groupEntries.length > 0) {
      return groupEntries
    }

    const until = resolveCooldownUntil(props.routeStatus, receivedAt)
    return until > 0 ? [{ key: 'channel', until }] : []
  }, [props.channelStatus, props.routeStatus])
  const activeCooldowns = cooldownEntries
    .map((entry) => ({ ...entry, remaining: Math.max(0, entry.until - now) }))
    .filter((entry) => entry.remaining > 0)
  const remaining = activeCooldowns.reduce(
    (maximum, entry) => Math.max(maximum, entry.remaining),
    0
  )
  const isCooling = remaining > 0

  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000))
    if (!isCooling) {
      return
    }

    const timer = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isCooling, props.channelStatus, props.routeStatus])

  const staticState = resolveStaticChannelState(props.channelStatus)
  if (staticState) {
    return (
      <StatusBadge variant={staticState.variant} size='sm' copyable={false}>
        {t(staticState.label)}
      </StatusBadge>
    )
  }

  const badge = isCooling ? (
    <StatusBadge
      variant='warning'
      size='sm'
      copyable={false}
      aria-label={`${t('Cooling')} ${formatCountdown(remaining)}`}
    >
      <Timer data-icon='inline-start' />
      <span>{t('Cooling')}</span>
      <span className='font-mono tabular-nums'>
        {formatCountdown(remaining)}
      </span>
    </StatusBadge>
  ) : (
    <StatusBadge variant='success' size='sm' copyable={false}>
      {t('Normal')}
    </StatusBadge>
  )

  if (!isCooling) {
    return badge
  }

  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger render={<span />}>{badge}</TooltipTrigger>
        <TooltipContent side='top' className='max-w-xs'>
          <div className='space-y-1 text-xs'>
            {activeCooldowns.map((entry) => (
              <div
                key={entry.key}
                className='flex items-center justify-between gap-3'
              >
                <span className='truncate'>
                  {entry.group ?? t('Remaining')}
                </span>
                <span className='font-mono tabular-nums'>
                  {formatCountdown(entry.remaining)}
                </span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
