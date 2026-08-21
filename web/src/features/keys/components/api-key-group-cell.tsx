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
import { CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { BadgeCell, TruncatedCell } from '@/components/data-table'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import {
  AutoGroupBadge,
  GroupRatioBadge,
  type GroupRatio,
} from './auto-group-visuals'

type ApiKeyGroupCellProps = {
  crossGroupRetry: boolean
  group: string
  ratio?: GroupRatio
  scheduleEnabled?: boolean
  scheduleActive?: boolean
  shouldReduceMotion: boolean
}

export function ApiKeyGroupCell(props: ApiKeyGroupCellProps) {
  const { t } = useTranslation()

  if (props.group !== 'auto') {
    const ratio = typeof props.ratio === 'number' ? props.ratio : undefined
    return (
      <div
        className='flex w-full min-w-0 items-center gap-1'
        data-api-key-group-cell='normal'
      >
        <TruncatedCell
          className='-ml-1.5 flex-1'
          contentClassName='flex w-full min-w-0 [&>span]:min-w-0 [&>span]:w-full'
          tooltipContent={props.group || '-'}
          tooltipClassName='break-all'
        >
          <GroupBadge className='flex-1' group={props.group} ratio={ratio} />
        </TruncatedCell>
        {props.scheduleEnabled && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className='inline-flex'
                  data-group-ratio-schedule={
                    props.scheduleActive ? 'active' : 'enabled'
                  }
                />
              }
            >
              <CalendarClock
                className={
                  props.scheduleActive
                    ? 'size-3.5 shrink-0 text-emerald-600'
                    : 'text-muted-foreground size-3.5 shrink-0'
                }
              />
            </TooltipTrigger>
            <TooltipContent>
              {props.scheduleActive
                ? t('Scheduled ratio active')
                : t('Time-based ratio enabled')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <BadgeCell
            data-api-key-group-cell='auto'
            className='gap-1.5 overflow-visible text-xs'
          />
        }
      >
        {props.crossGroupRetry && (
          <StatusBadge
            label={t('Cross-group')}
            variant='info'
            copyable={false}
          />
        )}
        <AutoGroupBadge shouldReduceMotion={props.shouldReduceMotion} />
        <GroupRatioBadge
          ratio={props.ratio}
          isAuto
          shouldReduceMotion={props.shouldReduceMotion}
        />
      </TooltipTrigger>
      <TooltipContent>
        <span className='text-xs'>
          {t(
            'Automatically selects the best available group with circuit breaker mechanism'
          )}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
