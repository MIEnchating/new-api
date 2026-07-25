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
  CheckCircle2,
  ChevronRight,
  CircleDot,
  SkipForward,
  Snowflake,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { DisplayRouteGroupStatus } from '@/lib/route-group-progress'

type RouteGroupProgressItem = {
  group: string
  status: DisplayRouteGroupStatus
}

function statusLabel(status: DisplayRouteGroupStatus) {
  switch (status) {
    case 'active':
      return 'Active'
    case 'cooling':
      return 'Cooling'
    case 'skipped':
      return 'Skipped'
    case 'success':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    case 'not_executed':
      return 'Not executed'
    default:
      return 'Pending'
  }
}

function statusIcon(status: DisplayRouteGroupStatus) {
  switch (status) {
    case 'success':
      return CheckCircle2
    case 'failed':
      return XCircle
    case 'cooling':
      return Snowflake
    case 'skipped':
    case 'not_executed':
      return SkipForward
    default:
      return CircleDot
  }
}

function statusClass(status: DisplayRouteGroupStatus) {
  switch (status) {
    case 'success':
      return 'border-success/25 bg-success/5 text-success'
    case 'failed':
      return 'border-destructive/25 bg-destructive/5 text-destructive'
    case 'cooling':
      return 'border-warning/25 bg-warning/5 text-warning'
    case 'active':
      return 'border-info/25 bg-info/5 text-info'
    default:
      return 'border-border bg-muted/25 text-muted-foreground'
  }
}

export function RouteGroupProgressChain(props: {
  items: RouteGroupProgressItem[]
}) {
  const { t } = useTranslation()

  return (
    <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
      {props.items.map((item, index) => {
        const StatusIcon = statusIcon(item.status)
        return (
          <span key={item.group} className='contents'>
            {index > 0 ? (
              <ChevronRight className='text-muted-foreground size-3.5 shrink-0' />
            ) : null}
            <span
              className={`inline-flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 ${statusClass(item.status)}`}
            >
              <StatusIcon className='size-3.5 shrink-0' />
              <span className='font-mono text-xs font-medium break-all'>
                {item.group}
              </span>
              <span className='text-[11px]'>{t(statusLabel(item.status))}</span>
            </span>
          </span>
        )
      })}
    </div>
  )
}
