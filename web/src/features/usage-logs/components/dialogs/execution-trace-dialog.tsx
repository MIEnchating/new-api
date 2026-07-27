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
import {
  Activity,
  Check,
  CheckCircle2,
  Copy,
  Info,
  ListTree,
  Loader2,
  RefreshCcw,
  Route,
  SkipForward,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ChannelExecutionTimelineList } from '@/components/channel-execution-timeline-list'
import { Dialog } from '@/components/dialog'
import { RouteGroupProgressChain } from '@/components/route-group-progress-chain'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { getChannelExecutionTrace } from '@/features/channels/api'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import {
  buildCompactChannelExecutionEvents,
  buildChannelExecutionTimeline,
  getFailedChannelExecutionConclusion,
  getStandbyChannelIds,
} from '@/lib/channel-execution-timeline'
import { resolveRouteGroupProgress } from '@/lib/route-group-progress'

type ExecutionTraceDialogProps = {
  requestId: string
  upstreamRequestIds?: string[]
  upstreamRequestIdSources?: Record<string, string>
  isRetryIntermediate?: boolean
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

function traceStatusIcon(status?: string) {
  if (status === 'success') return CheckCircle2
  if (status === 'failed') return XCircle
  if (status === 'cancelled') return SkipForward
  return Activity
}

function traceStatusTone(status?: string): IconBadgeTone {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'destructive'
  if (status === 'cancelled') return 'warning'
  return 'info'
}

function upstreamRequestIdSourceLabel(
  t: (key: string) => string,
  source?: string
) {
  if (source === 'x-oneapi-request-id') {
    return t('New API / One API (X-Oneapi-Request-Id)')
  }
  if (source === 'x-request-id') {
    return t('Sub2API / other upstream (X-Request-Id)')
  }
  return t('Not recorded')
}

function UpstreamRequestIdChain(props: {
  requestIds: string[]
  sources?: Record<string, string>
}) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })

  if (props.requestIds.length === 0) return null

  return (
    <section className='bg-background overflow-hidden rounded-md border'>
      <div className='bg-muted/30 flex min-w-0 items-center gap-2 border-b px-3 py-2'>
        <ListTree
          className='text-muted-foreground size-3.5 shrink-0'
          aria-hidden='true'
        />
        <h3 className='min-w-0 flex-1 truncate text-xs font-medium'>
          {t(
            props.requestIds.length === 1
              ? 'Upstream Request ID'
              : 'Upstream Request ID Chain'
          )}
        </h3>
        <span className='bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px] leading-none tabular-nums'>
          {props.requestIds.length}
        </span>
      </div>

      <ol className='divide-y'>
        {props.requestIds.map((requestId, index) => {
          const copied = copiedText === requestId

          return (
            <li
              key={`${requestId}-${index}`}
              className='grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-start gap-2 px-3 py-2'
            >
              <span className='bg-muted text-muted-foreground mt-0.5 flex size-6 items-center justify-center rounded-full font-mono text-[10px] font-medium tabular-nums'>
                {index + 1}
              </span>
              <div className='min-w-0'>
                <div className='text-foreground font-mono text-xs leading-5 break-all'>
                  {requestId}
                </div>
                <div className='text-muted-foreground mt-0.5 text-[11px] leading-4 break-words'>
                  {upstreamRequestIdSourceLabel(t, props.sources?.[requestId])}
                </div>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                className='text-muted-foreground hover:text-foreground mt-0.5'
                onClick={() => void copyToClipboard(requestId)}
                aria-label={`${t('Copy to clipboard')}: ${requestId}`}
                title={copied ? t('Copied') : t('Copy to clipboard')}
              >
                {copied ? (
                  <Check className='text-success' aria-hidden='true' />
                ) : (
                  <Copy aria-hidden='true' />
                )}
              </Button>
            </li>
          )
        })}
      </ol>
    </section>
  )
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
  const routeGroupProgress = trace ? resolveRouteGroupProgress(trace) : []
  const TraceStatusIcon = traceStatusIcon(trace?.status)
  const upstreamRequestIds = props.upstreamRequestIds ?? []
  const standbyChannelIds = getStandbyChannelIds(timeline)
  const failedConclusion =
    trace?.status === 'failed'
      ? getFailedChannelExecutionConclusion(events)
      : undefined
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
          <div className='space-y-3 border-b pb-4'>
            <div className='bg-muted/25 grid gap-px overflow-hidden rounded-md border sm:grid-cols-3'>
              <div className='bg-background flex min-w-0 items-center gap-2.5 px-3 py-2.5'>
                <IconBadge size='sm' tone={traceStatusTone(trace.status)}>
                  <TraceStatusIcon />
                </IconBadge>
                <div className='min-w-0'>
                  <div className='text-muted-foreground text-[11px]'>
                    {t('Status')}
                  </div>
                  <div className='truncate text-xs font-medium'>
                    {t(traceStatusLabel(trace.status))}
                  </div>
                </div>
              </div>
              <div className='bg-background flex min-w-0 items-center gap-2.5 px-3 py-2.5'>
                <IconBadge size='sm' tone='primary'>
                  {trace.mode === 'route' ? <Route /> : <RefreshCcw />}
                </IconBadge>
                <div className='min-w-0'>
                  <div className='text-muted-foreground text-[11px]'>
                    {t('Mode')}
                  </div>
                  <div className='truncate text-xs font-medium'>
                    {t(
                      trace.mode === 'route'
                        ? 'Channel routing'
                        : 'Traditional retry'
                    )}
                  </div>
                </div>
              </div>
              <div className='bg-background flex min-w-0 items-center gap-2.5 px-3 py-2.5'>
                <IconBadge size='sm' tone='neutral'>
                  <ListTree />
                </IconBadge>
                <div className='min-w-0'>
                  <div className='text-muted-foreground text-[11px]'>
                    {t('Details')}
                  </div>
                  <div className='truncate text-xs font-medium'>
                    {t(
                      trace.compact
                        ? 'Execution summary'
                        : 'Request execution trace'
                    )}
                  </div>
                </div>
              </div>
            </div>

            {props.isRetryIntermediate ? (
              <div
                role='status'
                className='flex min-w-0 gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100'
              >
                <Info className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
                <div className='min-w-0 text-xs leading-5'>
                  <div className='font-medium'>
                    {t('Intermediate retry error')}
                  </div>
                  <div className='text-amber-800 dark:text-amber-200'>
                    {t(
                      'This entry records an intermediate channel failure. The execution trace may include later attempts and the final state of the same request.'
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <dl className='bg-muted/30 grid gap-2 rounded-md border p-3 sm:grid-cols-2'>
              {[
                [t('Request ID'), trace.request_id],
                [t('Actual execution group'), trace.group],
                [t('Model'), trace.model],
                [t('Path'), trace.request_path],
                ...(trace.priority != null
                  ? [[t('Priority'), trace.priority]]
                  : []),
              ].map(([label, value]) => (
                <div key={String(label)} className='min-w-0'>
                  <dt className='text-muted-foreground text-[11px]'>{label}</dt>
                  <dd className='font-mono text-xs break-all'>
                    {value == null || value === '' ? '-' : value}
                  </dd>
                </div>
              ))}
            </dl>

            <UpstreamRequestIdChain
              requestIds={upstreamRequestIds}
              sources={props.upstreamRequestIdSources}
            />

            {routeGroupProgress.length > 1 ? (
              <div className='space-y-1.5'>
                <div className='text-muted-foreground text-xs'>
                  {t('Group route chain')}
                </div>
                <RouteGroupProgressChain items={routeGroupProgress} />
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
              showGroupContext={(trace.route_groups?.length ?? 0) > 1}
            />
          ) : (
            <p className='text-muted-foreground py-8 text-center text-sm'>
              {t('Execution trace not found')}
            </p>
          )}

          {failedConclusion ? (
            <div
              role='status'
              className='border-destructive/30 bg-destructive/5 space-y-2 rounded-md border px-3 py-2.5'
            >
              <div className='flex flex-wrap items-center gap-2'>
                <IconBadge size='sm' tone='destructive'>
                  <XCircle />
                </IconBadge>
                <span className='text-sm font-semibold'>
                  {t('Final conclusion')}
                </span>
                <StatusBadge variant='danger' size='sm' copyable={false}>
                  {t('Request failed')}
                </StatusBadge>
              </div>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'All channel attempts failed and the request did not receive a successful response.'
                )}
              </p>
              {failedConclusion.reason ? (
                <div className='bg-background/70 rounded border px-2.5 py-2 text-xs break-all'>
                  <span className='text-muted-foreground'>
                    {t('Final error')}:{' '}
                  </span>
                  {failedConclusion.reason}
                </div>
              ) : null}
              <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[11px]'>
                {failedConclusion.channelId ? (
                  <span>
                    {t('Last channel')}: #{failedConclusion.channelId}{' '}
                    {failedConclusion.channelName}
                  </span>
                ) : null}
                <span>
                  {t('Attempts')}: {failedConclusion.attemptCount}
                </span>
                <span>
                  {t('Channels')}: {failedConclusion.channelCount}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
