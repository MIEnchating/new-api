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
/* eslint-disable no-nested-ternary */
import { useQuery } from '@tanstack/react-query'
import { Loader2, RefreshCcw, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChannelExecutionTimelineList } from '@/components/channel-execution-timeline-list'
import { RouteGroupProgressChain } from '@/components/route-group-progress-chain'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  buildCompactChannelExecutionEvents,
  buildChannelExecutionTimeline,
  getStandbyChannelIds,
} from '@/lib/channel-execution-timeline'
import { resolveRouteGroupProgress } from '@/lib/route-group-progress'
import { cn } from '@/lib/utils'

import {
  getChannelExecutionOptions,
  getChannelExecutionTrace,
  getRecentChannelExecutionTraces,
} from '../../api'
import { selectExecutionTrace } from '../../lib/channel-execution-trace'

type ChannelExecutionTraceDialogProps = {
  active: boolean
  group: string
  onGroupChange: (value: string) => void
  onTraceContextChange: (context: {
    group: string
    model: string
    requestPath: string
    mode: 'route' | 'retry'
  }) => void
}

function splitValues(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function traceStatusLabel(status: string) {
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

function traceStatusVariant(status: string): StatusVariant {
  if (status === 'success') return 'success'
  if (status === 'running') return 'info'
  if (status === 'cancelled') return 'warning'
  return 'danger'
}

function queryErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    const message = (error as { response?: { data?: { message?: unknown } } })
      .response?.data?.message
    if (typeof message === 'string' && message.trim()) return message
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

function formatEventTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString()
}

export function ChannelExecutionTracePanel(
  props: ChannelExecutionTraceDialogProps
) {
  const { t } = useTranslation()
  const [channelId, setChannelId] = useState(0)
  const [requestId, setRequestId] = useState('')
  const [searchedRequestId, setSearchedRequestId] = useState('')
  const [selectedRequestId, setSelectedRequestId] = useState('')

  const optionsQuery = useQuery({
    queryKey: ['channel-execution-options'],
    queryFn: getChannelExecutionOptions,
    enabled: props.active,
    staleTime: 30_000,
  })
  const channels = useMemo(
    () => optionsQuery.data?.data?.channels ?? [],
    [optionsQuery.data?.data?.channels]
  )
  const groups = useMemo(
    () => optionsQuery.data?.data?.groups ?? [],
    [optionsQuery.data?.data?.groups]
  )
  const groupChannels = useMemo(
    () =>
      channels.filter((item) => splitValues(item.group).includes(props.group)),
    [channels, props.group]
  )
  const channelNames = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel.name])),
    [channels]
  )

  useEffect(() => {
    if (!props.active || groups.length === 0) return
    if (!groups.some((item) => item.name === props.group)) {
      props.onGroupChange(groups[0].name)
    }
  }, [groups, props])

  const handleGroupChange = (group: string) => {
    setChannelId(0)
    setRequestId('')
    setSearchedRequestId('')
    setSelectedRequestId('')
    props.onGroupChange(group)
  }

  const recentQuery = useQuery({
    queryKey: ['channel-execution-traces', channelId, props.group],
    queryFn: () =>
      getRecentChannelExecutionTraces({
        channel_id: channelId || undefined,
        group: props.group,
        limit: 20,
      }),
    enabled: props.active && Boolean(props.group),
    refetchInterval: (query) =>
      query.state.data?.data?.some((item) => item.status === 'running')
        ? 1500
        : 10_000,
    retry: false,
  })
  const recentTraces = useMemo(
    () => recentQuery.data?.data ?? [],
    [recentQuery.data?.data]
  )

  useEffect(() => {
    if (!props.active || searchedRequestId || recentTraces.length === 0) return
    if (recentTraces.some((item) => item.request_id === selectedRequestId)) {
      return
    }
    const preferred =
      recentTraces.find((item) => item.status === 'running') ?? recentTraces[0]
    setSelectedRequestId(preferred.request_id)
  }, [props.active, recentTraces, searchedRequestId, selectedRequestId])

  const traceQuery = useQuery({
    queryKey: ['channel-execution-trace', searchedRequestId],
    queryFn: () => getChannelExecutionTrace(searchedRequestId),
    enabled: props.active && Boolean(searchedRequestId),
    refetchInterval: (query) =>
      query.state.data?.data?.status === 'running' ? 1000 : false,
    retry: false,
  })
  const selectedRecentTrace = recentTraces.find(
    (item) => item.request_id === selectedRequestId
  )
  const trace = selectExecutionTrace(
    searchedRequestId,
    traceQuery.data,
    selectedRecentTrace
  )

  useEffect(() => {
    if (!trace) return
    props.onTraceContextChange({
      group: trace.group,
      model: trace.model,
      requestPath: trace.request_path,
      mode: trace.mode,
    })
  }, [props, trace])
  const events =
    trace?.events && trace.events.length > 0
      ? trace.events
      : buildCompactChannelExecutionEvents(trace, {
          channelId: trace?.channel_ids?.[0],
          channelName: trace?.channel_name,
          startedAt: trace?.started_at,
          endedAt: trace?.updated_at,
        })
  const timeline = buildChannelExecutionTimeline(events, {
    status: trace?.status,
    endedAt: trace?.updated_at,
  })
  const standbyChannelIds = getStandbyChannelIds(timeline)
  const routeGroupStatuses = trace ? resolveRouteGroupProgress(trace) : []
  const traceError = searchedRequestId
    ? traceQuery.isError
      ? queryErrorMessage(traceQuery.error, t('Execution trace not found'))
      : traceQuery.data && !traceQuery.data.success
        ? traceQuery.data.message || t('Execution trace not found')
        : ''
    : ''

  const submitRequestId = () => {
    const value = requestId.trim()
    if (!value) return
    if (value === searchedRequestId) {
      void traceQuery.refetch()
      return
    }
    setSearchedRequestId(value)
    setSelectedRequestId(value)
  }

  const content = (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(150px,0.65fr)_minmax(180px,0.75fr)_minmax(0,1.25fr)_auto]'>
        <Select<string>
          value={props.group}
          items={groups.map((item) => ({
            value: item.name,
            label: item.name,
          }))}
          onValueChange={(value) => value !== null && handleGroupChange(value)}
        >
          <SelectTrigger className='w-full'>
            <SelectValue placeholder={t('Select group')} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {groups.map((item) => (
                <SelectItem key={item.name} value={item.name}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select<number>
          value={channelId}
          items={[
            { value: 0, label: t('All channels') },
            ...groupChannels.map((item) => ({
              value: item.id,
              label: `#${item.id} ${item.name}`,
            })),
          ]}
          onValueChange={(value) => value !== null && setChannelId(value)}
        >
          <SelectTrigger className='w-full'>
            <SelectValue placeholder={t('All channels')} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              <SelectItem value={0}>{t('All channels')}</SelectItem>
              {groupChannels.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  <span className='font-mono'>#{item.id}</span> {item.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input
          value={requestId}
          onChange={(event) => setRequestId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitRequestId()
          }}
          placeholder={t('Optional: search by request ID')}
          className='font-mono'
        />
        <Button
          type='button'
          size='icon'
          variant='outline'
          onClick={submitRequestId}
          disabled={!requestId.trim() || traceQuery.isFetching}
          aria-label={t('View execution trace')}
        >
          {traceQuery.isFetching ? (
            <Loader2 className='size-4 animate-spin' />
          ) : (
            <Search className='size-4' />
          )}
        </Button>
      </div>

      <div className='grid min-h-0 flex-1 overflow-hidden rounded-md border lg:grid-cols-[250px_minmax(0,1fr)]'>
        <div className='bg-muted/20 flex min-h-0 min-w-0 flex-col border-b lg:border-r lg:border-b-0'>
          <div className='flex items-center justify-between border-b px-3 py-2'>
            <span className='text-xs font-medium'>{t('Recent requests')}</span>
            {recentQuery.isFetching ? (
              <Loader2 className='text-muted-foreground size-3 animate-spin' />
            ) : null}
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            {recentQuery.isLoading ? (
              <div className='text-muted-foreground flex items-center justify-center gap-2 p-5 text-xs'>
                <Loader2 className='size-3.5 animate-spin' />
                {t('Loading recent requests...')}
              </div>
            ) : recentQuery.isError ? (
              <div className='space-y-2 p-3'>
                <p className='text-destructive text-xs'>
                  {queryErrorMessage(
                    recentQuery.error,
                    t('Failed to load recent requests')
                  )}
                </p>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() => void recentQuery.refetch()}
                >
                  <RefreshCcw className='size-3.5' />
                  {t('Retry')}
                </Button>
              </div>
            ) : recentTraces.length === 0 ? (
              <p className='text-muted-foreground p-4 text-center text-xs'>
                {t('No recent requests for this group')}
              </p>
            ) : (
              recentTraces.map((item) => (
                <button
                  key={item.request_id}
                  type='button'
                  className={cn(
                    'hover:bg-muted/60 flex w-full min-w-0 flex-col gap-1 border-b px-3 py-2.5 text-left last:border-b-0',
                    !searchedRequestId &&
                      selectedRequestId === item.request_id &&
                      'bg-muted'
                  )}
                  onClick={() => {
                    setSearchedRequestId('')
                    setSelectedRequestId(item.request_id)
                  }}
                >
                  <div className='flex w-full items-center gap-2'>
                    <StatusBadge
                      variant={traceStatusVariant(item.status)}
                      pulse={item.status === 'running'}
                      size='sm'
                      copyable={false}
                    >
                      {t(traceStatusLabel(item.status))}
                    </StatusBadge>
                    <span className='text-muted-foreground ml-auto font-mono text-[11px]'>
                      {formatEventTime(item.updated_at)}
                    </span>
                  </div>
                  <span className='w-full truncate font-mono text-xs'>
                    {item.request_id}
                  </span>
                  <span className='text-muted-foreground w-full truncate text-xs'>
                    {item.model} · {item.request_path}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className='min-h-0 min-w-0 overflow-y-auto p-3 sm:p-4'>
          {searchedRequestId && traceQuery.isFetching ? (
            <div className='text-muted-foreground flex min-h-48 items-center justify-center gap-2 text-sm'>
              <Loader2 className='size-4 animate-spin' />
              {t('Loading execution trace...')}
            </div>
          ) : traceError ? (
            <p className='text-destructive py-4 text-sm'>{traceError}</p>
          ) : trace ? (
            <div className='space-y-3'>
              <div className='flex flex-wrap items-center gap-2 border-b pb-3'>
                <StatusBadge
                  variant={traceStatusVariant(trace.status)}
                  pulse={trace.status === 'running'}
                  copyable={false}
                >
                  {t(traceStatusLabel(trace.status))}
                </StatusBadge>
                <span className='text-muted-foreground ml-auto font-mono text-[11px] break-all'>
                  {trace.request_id}
                </span>
              </div>
              <dl className='bg-muted/30 grid gap-2 rounded-md border p-3 sm:grid-cols-3'>
                {[
                  [t('Actual execution group'), trace.group],
                  [t('Model'), trace.model],
                  [t('Path'), trace.request_path],
                ].map(([label, value]) => (
                  <div key={label} className='min-w-0'>
                    <dt className='text-muted-foreground text-[11px]'>
                      {label}
                    </dt>
                    <dd className='truncate font-mono text-xs font-medium'>
                      {value || '-'}
                    </dd>
                  </div>
                ))}
                {routeGroupStatuses.length > 1 ? (
                  <div className='min-w-0 sm:col-span-3'>
                    <dt className='text-muted-foreground text-[11px]'>
                      {t('Group route chain')}
                    </dt>
                    <dd className='pt-1.5'>
                      <RouteGroupProgressChain items={routeGroupStatuses} />
                    </dd>
                  </div>
                ) : null}
              </dl>
              {standbyChannelIds.length > 0 ? (
                <div className='space-y-1.5'>
                  <div className='flex flex-wrap items-center gap-1.5'>
                    <span className='text-muted-foreground text-xs'>
                      {t('Candidate channel')}
                    </span>
                    {standbyChannelIds.map((id) => (
                      <StatusBadge
                        key={id}
                        variant='neutral'
                        size='sm'
                        copyable={false}
                      >
                        <span className='font-mono'>#{id}</span>
                        {channelNames.get(id) || t('Unknown channel')}
                      </StatusBadge>
                    ))}
                  </div>
                  <p className='text-muted-foreground text-[11px]'>
                    {t(
                      'If this channel fails, routing selects again from these available channels; the displayed order is not the execution order'
                    )}
                  </p>
                </div>
              ) : null}
              <ChannelExecutionTimelineList
                items={timeline}
                executionGroup={trace.group}
                showGroupContext={(trace.route_groups?.length ?? 0) > 1}
              />
            </div>
          ) : (
            <div className='text-muted-foreground flex h-full min-h-48 items-center justify-center px-4 text-center text-sm'>
              {t('Select a recent request to view its execution trace')}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return content
}
