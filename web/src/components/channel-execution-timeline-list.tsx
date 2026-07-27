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
  Activity,
  CheckCircle2,
  CircleDot,
  GitBranch,
  RefreshCcw,
  Server,
  SkipForward,
  Snowflake,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  StatusBadge,
  textColorMap,
  type StatusBadgeProps,
} from '@/components/status-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ChannelExecutionTimelineItem } from '@/lib/channel-execution-timeline'
import { formatUseTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type ChannelExecutionTimelineListProps = {
  items: ChannelExecutionTimelineItem[]
  executionGroup?: string
  showGroupContext?: boolean
  className?: string
}

type ChannelExecutionStatus = 'running' | 'success' | 'failed' | 'cancelled'

function eventIcon(state?: string) {
  switch (state) {
    case 'active':
      return CircleDot
    case 'success':
      return CheckCircle2
    case 'affinity_hit':
      return GitBranch
    case 'failed':
    case 'cancelled':
      return XCircle
    case 'cooling':
      return Snowflake
    case 'same_channel_retry':
      return RefreshCcw
    case 'skipped':
      return SkipForward
    default:
      return Activity
  }
}

function eventVariant(state?: string): StatusBadgeProps['variant'] {
  switch (state) {
    case 'success':
      return 'success'
    case 'failed':
      return 'danger'
    case 'cancelled':
    case 'cooling':
    case 'same_channel_retry':
      return 'warning'
    case 'active':
      return 'info'
    case 'affinity_hit':
      return 'purple'
    default:
      return 'neutral'
  }
}

function eventLabel(state?: string, isGroupEvent = false, reason?: string) {
  if (isGroupEvent) {
    switch (state) {
      case 'affinity_hit':
        return 'Group affinity hit'
      case 'cooling':
        return 'Group entered cooldown'
      case 'skipped':
        return 'Candidate group skipped'
    }
  }
  switch (state) {
    case 'active':
      return 'Channel request started'
    case 'affinity_hit':
      if (reason === 'channel_affinity') return 'Channel affinity hit'
      return 'Affinity hit'
    case 'same_channel_retry':
      return 'Same-channel retry'
    case 'success':
      return 'Channel request succeeded'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    case 'cooling':
      return 'Cooling'
    case 'skipped':
      return 'Skipped'
    default:
      return 'Unknown'
  }
}

function eventDescription(
  state?: string,
  isGroupEvent = false,
  reason?: string
) {
  if (isGroupEvent) {
    if (state === 'cooling' && reason === 'group_route_failure') {
      return 'The current group failed and entered cooldown; routing continues with the next candidate group when available'
    }
    return 'This is a group-routing decision, not an upstream channel request'
  }
  switch (state) {
    case 'active':
      return 'The upstream request has been sent to this channel'
    case 'affinity_hit':
      return 'The last successful channel was selected from the same matching context; no upstream request has been sent at this stage'
    case 'success':
      return 'This channel returned a successful response'
    case 'cancelled':
      return 'Request cancelled before this channel returned a result'
    default:
      return ''
  }
}

function eventReasonLabel(reason?: string) {
  switch (reason) {
    case 'channel_affinity':
      return 'Channel affinity'
    case 'affinity_cooling':
      return 'Affinity target is cooling'
    case 'cooling':
      return 'Channel is cooling'
    case 'group_route_failure':
      return 'Group route failed'
    case 'group_affinity':
      return 'Group affinity'
    case 'group_cooling':
      return 'Group is cooling'
    case 'group_unsupported':
      return 'Group does not support this request'
    default:
      return reason || ''
  }
}

function statusLabel(status: ChannelExecutionStatus) {
  switch (status) {
    case 'running':
      return 'Running'
    case 'success':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
  }
}

function formatDuration(
  startedAt: number | undefined,
  endedAt: number | undefined
) {
  if (!startedAt) return '--'
  const durationMs = Math.max(0, (endedAt ?? Date.now()) - startedAt)
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  return formatUseTime(durationMs / 1000)
}

function ChannelIdentity(props: {
  channelId: number
  channelName?: string
  label: string
}) {
  const fullName = `#${props.channelId}${props.channelName ? ` ${props.channelName}` : ''}`
  return (
    <span
      className='border-border/80 bg-background inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs'
      title={`${props.label}: ${fullName}`}
    >
      <Server className='text-muted-foreground size-3.5 shrink-0' />
      <span className='font-mono font-semibold'>#{props.channelId}</span>
      {props.channelName ? (
        <>
          <span className='text-border'>|</span>
          <span className='truncate font-medium'>{props.channelName}</span>
        </>
      ) : null}
    </span>
  )
}

function TimelineStep(props: {
  index: number
  total: number
  timestamp?: number
  variant?: StatusBadgeProps['variant']
  icon: LucideIcon
  children: React.ReactNode
}) {
  const StepIcon = props.icon
  const formattedTime = props.timestamp
    ? new Date(props.timestamp).toLocaleTimeString()
    : undefined

  return (
    <div className='relative grid min-w-0 grid-cols-[24px_minmax(0,1fr)] gap-x-2.5 pb-2.5 last:pb-0 sm:grid-cols-[4.5rem_24px_minmax(0,1fr)]'>
      <time className='text-muted-foreground hidden items-center justify-end text-right font-mono text-[11px] tabular-nums sm:flex'>
        {formattedTime}
      </time>
      <div className='relative flex items-center justify-center'>
        {props.index > 0 ? (
          <span className='bg-border absolute -top-2.5 bottom-1/2 left-1/2 w-px -translate-x-1/2' />
        ) : null}
        {props.index < props.total - 1 ? (
          <span className='bg-border absolute top-1/2 -bottom-2.5 left-1/2 w-px -translate-x-1/2' />
        ) : null}
        <span
          className={cn(
            'bg-background ring-background z-10 flex size-6 items-center justify-center rounded-full border ring-4',
            textColorMap[props.variant ?? 'neutral']
          )}
        >
          <StepIcon className='size-3' />
        </span>
      </div>
      <div className='border-border/70 bg-muted/15 min-w-0 rounded-md border px-3 py-2'>
        {formattedTime ? (
          <time className='text-muted-foreground mb-1.5 block text-right font-mono text-[11px] tabular-nums sm:hidden'>
            {formattedTime}
          </time>
        ) : null}
        {props.children}
      </div>
    </div>
  )
}

export function ChannelExecutionTimelineList(
  props: ChannelExecutionTimelineListProps
) {
  const { t } = useTranslation()

  return (
    <TooltipProvider delay={100}>
      <div className={cn('min-w-0', props.className)}>
        <div className='mb-2.5 grid min-w-0 grid-cols-[24px_minmax(0,1fr)] gap-x-2.5 sm:grid-cols-[4.5rem_24px_minmax(0,1fr)]'>
          <span className='hidden sm:block' />
          <span className='flex justify-center'>
            <Activity className='text-muted-foreground size-4' />
          </span>
          <span className='text-xs font-semibold'>{t('Timeline')}</span>
        </div>
        {props.items.map((item, index) => {
          if (item.kind === 'attempt') {
            const AttemptIcon = eventIcon(item.state)
            const attemptStatus: ChannelExecutionStatus =
              item.state === 'active' ? 'running' : item.state
            return (
              <TimelineStep
                key={`attempt-${item.channelId}-${item.startedAt ?? index}`}
                index={index}
                total={props.items.length}
                timestamp={item.startedAt}
                variant={eventVariant(item.state)}
                icon={AttemptIcon}
              >
                <div className='flex flex-wrap items-center gap-1.5'>
                  <StatusBadge
                    variant={eventVariant(item.state)}
                    size='sm'
                    copyable={false}
                  >
                    {t(statusLabel(attemptStatus))}
                  </StatusBadge>
                  {item.selectionState === 'affinity_hit' ? (
                    <StatusBadge variant='purple' size='sm' copyable={false}>
                      {t('Affinity hit')}
                    </StatusBadge>
                  ) : null}
                  {item.selectionState === 'same_channel_retry' ? (
                    <StatusBadge variant='warning' size='sm' copyable={false}>
                      {t('Same-channel retry')}
                    </StatusBadge>
                  ) : null}
                  {item.group &&
                  (props.showGroupContext ||
                    item.group !== props.executionGroup) ? (
                    <span className='text-muted-foreground inline-flex min-w-0 items-center gap-1 text-xs'>
                      <span>{t('Group')}:</span>
                      <span className='text-foreground font-mono break-all'>
                        {item.group}
                      </span>
                    </span>
                  ) : null}
                  <ChannelIdentity
                    channelId={item.channelId}
                    channelName={item.channelName}
                    label={t('Channel')}
                  />
                </div>
                {item.reason ? (
                  <p className='text-muted-foreground mt-1.5 text-xs break-all'>
                    {t(eventReasonLabel(item.reason))}
                  </p>
                ) : null}
                <div className='text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
                  <span>
                    {t('Duration')}:{' '}
                    {formatDuration(item.startedAt, item.endedAt)}
                  </span>
                  {item.retryIndex != null && item.retryIndex > 0 ? (
                    <span>
                      {t('Retry')}: {item.retryIndex}
                    </span>
                  ) : null}
                  {item.priority != null ? (
                    <span>
                      {t('Priority')}: {item.priority}
                    </span>
                  ) : null}
                </div>
              </TimelineStep>
            )
          }

          const event = item.event
          const EventIcon = eventIcon(event.state)
          const isGroupEvent = Boolean(event.group && !event.channel_id)
          const description = eventDescription(
            event.state,
            isGroupEvent,
            event.reason
          )
          return (
            <TimelineStep
              key={`${event.sequence ?? index}-${event.timestamp ?? 0}`}
              index={index}
              total={props.items.length}
              timestamp={event.timestamp}
              variant={eventVariant(event.state)}
              icon={EventIcon}
            >
              <div className='flex flex-wrap items-center gap-1.5'>
                {description ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className='inline-flex cursor-help' />}
                    >
                      <StatusBadge
                        variant={eventVariant(event.state)}
                        size='sm'
                        copyable={false}
                      >
                        {t(eventLabel(event.state, isGroupEvent, event.reason))}
                      </StatusBadge>
                    </TooltipTrigger>
                    <TooltipContent
                      side='top'
                      className='max-w-xs text-xs leading-5'
                    >
                      {t(description)}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <StatusBadge
                    variant={eventVariant(event.state)}
                    size='sm'
                    copyable={false}
                  >
                    {t(eventLabel(event.state, isGroupEvent, event.reason))}
                  </StatusBadge>
                )}
                {event.group &&
                  (props.showGroupContext ||
                    isGroupEvent ||
                    event.group !== props.executionGroup) && (
                    <span className='text-muted-foreground inline-flex min-w-0 items-center gap-1 text-xs'>
                      <span>{t('Group')}:</span>
                      <span className='text-foreground font-mono break-all'>
                        {event.group}
                      </span>
                    </span>
                  )}
                {event.channel_id ? (
                  <ChannelIdentity
                    channelId={event.channel_id}
                    channelName={event.channel_name}
                    label={t('Channel')}
                  />
                ) : null}
              </div>
              {event.reason &&
              event.state !== 'affinity_hit' &&
              !(
                event.state === 'cooling' &&
                event.reason === 'group_route_failure'
              ) ? (
                <p className='text-muted-foreground mt-1.5 text-xs break-all'>
                  {t(eventReasonLabel(event.reason))}
                </p>
              ) : null}
              {item.startedAt != null ||
              event.priority != null ||
              (event.retry_index != null && event.retry_index > 0) ||
              event.cooldown_until ? (
                <div className='text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
                  {item.startedAt != null ? (
                    <span>
                      {t('Duration')}:{' '}
                      {formatDuration(item.startedAt, event.timestamp)}
                    </span>
                  ) : null}
                  {event.priority != null ? (
                    <span>
                      {t('Priority')}: {event.priority}
                    </span>
                  ) : null}
                  {event.retry_index != null && event.retry_index > 0 ? (
                    <span>
                      {t('Retry')}: {event.retry_index}
                    </span>
                  ) : null}
                  {event.cooldown_until ? (
                    <span>
                      {t('Cooldown')}:{' '}
                      {new Date(event.cooldown_until * 1000).toLocaleString()}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </TimelineStep>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
