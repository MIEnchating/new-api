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
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { Channel } from '../types'

type ChannelRouteStatusBadgeProps = {
  routeStatus?: Channel['route_status']
}

function formatRemaining(t: TFunction, seconds?: number) {
  if (!seconds || seconds <= 0) return ''
  return `${seconds}${t('seconds remaining')}`
}

export function ChannelRouteStatusBadge({
  routeStatus,
}: ChannelRouteStatusBadgeProps) {
  const { t } = useTranslation()
  const coolingGroups = routeStatus?.groups?.filter((group) => group.cooling) ?? []
  const isCooling = routeStatus?.cooling || coolingGroups.length > 0

  const badge = (
    <StatusBadge
      label={isCooling ? t('Cooling') : t('Normal')}
      variant={isCooling ? 'warning' : 'success'}
      size='sm'
      copyable={false}
    />
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
            {coolingGroups.map((group) => (
              <div key={group.group}>
                {group.group}: {formatRemaining(t, group.cooldown_remaining_seconds)}
              </div>
            ))}
            {coolingGroups.length === 0 && routeStatus?.cooldown_remaining_seconds ? (
              <div>
                {t('Remaining')}:{' '}
                {formatRemaining(t, routeStatus.cooldown_remaining_seconds)}
              </div>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
