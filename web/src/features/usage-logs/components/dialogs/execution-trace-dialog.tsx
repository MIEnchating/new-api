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
import { Activity, Loader2, RefreshCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ChannelExecutionTimelineList } from '@/components/channel-execution-timeline-list'
import { Dialog } from '@/components/dialog'
import { StatusBadge, type StatusBadgeProps } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  getChannelExecutionTrace,
  type ChannelExecutionRouteGroupStatus,
} from '@/features/channels/api'
import {
  buildCompactChannelExecutionEvents,
  buildChannelExecutionTimeline,
  getStandbyChannelIds,
} from '@/lib/channel-execution-timeline'

type ExecutionTraceDialogProps = {
  requestId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function traceStatusLabel(status?: string) {
  switch (status) {
    case 'running':
      return 'Running'
    case 'success':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Unknown'
  }
}

function traceStatusVariant(status?: string): StatusBadgeProps['variant'] {
  if (status === 'success') return 'success'
  if (status === 'running') return 'info'
  if (status === 'cancelled') return 'warning'
  return 'danger'
}

function routeGroupStatusLabel(
  status: ChannelExecutionRouteGroupStatus['status']
) {
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
    default:
      return 'Pending'
  }
}

function routeGroupStatusVariant(
  status: ChannelExecutionRouteGroupStatus['status']
): StatusBadgeProps['variant'] {
  switch (status) {
    case 'active':
      return 'info'
    case 'cooling':
      return 'warning'
    case 'success':
      return 'success'
    case 'failed':
      return 'danger'
    default:
      return 'neutral'
  }
}

function queryErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    const responseMessage = (
      error as { response?: { data?: { message?: unknown } } }
    ).response?.data?.message
    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

export function ExecutionTraceDialog(props: ExecutionTraceDialogProps) {
  const { t } = useTranslation()
  const traceQuery = useQuery({
    queryKey: ['channel-execution-trace', props.requestId],
    queryFn: () => getChannelExecutionTrace(props.requestId),
    enabled: props.open && Boolean(props.requestId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (query) =>
      query.state.data?.data?.status === 'running' ? 1000 : false,
    retry: false,
  })

  const trace = traceQuery.data?.success ? traceQuery.data.data : undefined
  const events =
    trace?.events && trace.events.length > 0
      ? trace.events
      : buildCompactChannelExecutionEvents(trace, {
          channelId: trace?.channel_ids?.[0],
          startedAt: trace?.started_at,
          endedAt: trace?.updated_at,
        })
  const timeline = buildChannelExecutionTimeline(events, {
    status: trace?.status,
    endedAt: trace?.updated_at,
  })
  const standbyChannelIds = getStandbyChannelIds(timeline)
  const errorMessage = traceQuery.isError
    ? queryErrorMessage(traceQuery.error, t('Execution trace not found'))
    : traceQuery.data && !traceQuery.data.success
      ? traceQuery.data.message || t('Execution trace not found')
      : ''

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <span className='inline-flex items-center gap-2'>
          <Activity className='size-4' aria-hidden='true' />
          {t('Request execution trace')}
        </span>
      }
      description={t('View execution trace')}
      descriptionClassName='sr-only'
      contentClassName='sm:max-w-3xl'
      contentHeight='min(76dvh, 720px)'
      bodyClassName='pr-2 sm:pr-4'
    >
      {traceQuery.isLoading || (traceQuery.isFetching && !trace) ? (
        <div className='text-muted-foreground flex min-h-56 items-center justify-center gap-2 text-sm'>
          <Loader2 className='size-4 animate-spin' />
          {t('Loading execution trace...')}
        </div>
      ) : errorMessage || !trace ? (
        <div className='flex min-h-56 flex-col items-center justify-center gap-3 px-4 text-center'>
          <p className='text-destructive text-sm'>
            {errorMessage || t('Execution trace not found')}
          </p>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => void traceQuery.refetch()}
            disabled={traceQuery.isFetching}
          >
            <RefreshCcw
              className={traceQuery.isFetching ? 'animate-spin' : undefined}
            />
            {t('Retry')}
          </Button>
        </div>
      ) : (
        <div className='min-w-0 space-y-4 py-1'>
          <div className='space-y-3 border-b pb-3'>
            <div className='flex flex-wrap items-center gap-2'>
              <StatusBadge
                variant={traceStatusVariant(trace.status)}
                pulse={trace.status === 'running'}
                copyable={false}
              >
                {t(traceStatusLabel(trace.status))}
              </StatusBadge>
              <span className='text-muted-foreground text-xs'>
                {t(
                  trace.mode === 'route'
                    ? 'Channel routing'
                    : 'Traditional retry'
                )}
              </span>
              {trace.compact ? (
                <StatusBadge variant='neutral' size='sm' copyable={false}>
                  {t('Execution summary')}
                </StatusBadge>
              ) : null}
            </div>

            <dl className='bg-muted/30 grid gap-2 rounded-md border p-3 sm:grid-cols-2'>
              {[
                [t('Request ID'), trace.request_id],
                [t('Group'), trace.group],
                [t('Model'), trace.model],
                [t('Path'), trace.request_path],
              ].map(([label, value]) => (
                <div key={label} className='min-w-0'>
                  <dt className='text-muted-foreground text-[11px]'>{label}</dt>
                  <dd className='font-mono text-xs break-all'>
                    {value || '-'}
                  </dd>
                </div>
              ))}
            </dl>

            {trace.route_groups && trace.route_groups.length > 1 ? (
              <div className='space-y-1.5'>
                <div className='text-muted-foreground text-xs'>
                  {t('Group route chain')}
                </div>
                <div className='flex flex-wrap items-center gap-1.5'>
                  {trace.route_groups.map((group, index) => (
                    <span key={`${group}-${index}`} className='contents'>
                      {index > 0 ? (
                        <span className='text-muted-foreground text-xs'>→</span>
                      ) : null}
                      <StatusBadge variant='neutral' size='sm' copyable={false}>
                        <span className='font-mono'>{group}</span>
                      </StatusBadge>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {trace.route_group_statuses?.length ? (
              <div className='space-y-1.5'>
                <div className='text-muted-foreground text-xs'>
                  {t('Group route status')}
                </div>
                <div className='flex flex-wrap gap-1.5'>
                  {trace.route_group_statuses.map((item) => (
                    <StatusBadge
                      key={item.group}
                      variant={routeGroupStatusVariant(item.status)}
                      size='sm'
                      copyable={false}
                    >
                      <span className='font-mono'>{item.group}</span>
                      <span>{t(routeGroupStatusLabel(item.status))}</span>
                    </StatusBadge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {standbyChannelIds.length > 0 ? (
            <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
              <span className='text-muted-foreground text-xs'>
                {t('Standby channels')}
              </span>
              {standbyChannelIds.map((channelId) => (
                <StatusBadge
                  key={channelId}
                  variant='neutral'
                  size='sm'
                  copyable={false}
                >
                  <span className='font-mono'>#{channelId}</span>
                </StatusBadge>
              ))}
            </div>
          ) : null}

          {timeline.length > 0 ? (
            <ChannelExecutionTimelineList
              items={timeline}
              executionGroup={trace.group}
            />
          ) : (
            <p className='text-muted-foreground py-8 text-center text-sm'>
              {t('Execution trace not found')}
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}
