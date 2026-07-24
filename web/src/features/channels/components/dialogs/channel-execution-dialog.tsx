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
import {
  ArrowDown,
  CheckCircle2,
  Equal,
  Loader2,
  RefreshCcw,
  Search,
  Shuffle,
  Snowflake,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChannelExecutionTimelineList } from '@/components/channel-execution-timeline-list'
import { Dialog } from '@/components/dialog'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { cn } from '@/lib/utils'

import {
  getChannelExecutionPlan,
  getChannelExecutionOptions,
  getRecentChannelExecutionTraces,
  getChannelExecutionTrace,
  type ChannelExecutionRouteGroupStatus,
} from '../../api'
import { selectExecutionTrace } from '../../lib/channel-execution-trace'

type ChannelExecutionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function splitValues(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatEventTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  }).format(new Date(timestamp))
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
): StatusVariant {
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
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return fallback
}

export function ChannelExecutionDialog({
  open,
  onOpenChange,
}: ChannelExecutionDialogProps) {
  const { t } = useTranslation()
  const channelsQuery = useQuery({
    queryKey: ['channel-execution-options'],
    queryFn: getChannelExecutionOptions,
    enabled: open,
    staleTime: 30_000,
  })
  const channels = useMemo(
    () => channelsQuery.data?.data?.channels ?? [],
    [channelsQuery.data?.data?.channels]
  )
  const groups = useMemo(
    () => channelsQuery.data?.data?.groups ?? [],
    [channelsQuery.data?.data?.groups]
  )
  const [mode, setMode] = useState<'route' | 'retry'>('route')
  const [group, setGroup] = useState('')
  const selectedGroup = groups.find((item) => item.name === group)
  const models = useMemo(() => selectedGroup?.models ?? [], [selectedGroup])
  const [model, setModel] = useState('')
  const [channelID, setChannelID] = useState(0)
  const [requestPath, setRequestPath] = useState('/v1/chat/completions')
  const [requestID, setRequestID] = useState('')
  const [searchedRequestID, setSearchedRequestID] = useState('')
  const [selectedRequestID, setSelectedRequestID] = useState('')

  useEffect(() => {
    if (!open || groups.length === 0) return
    if (!groups.some((item) => item.name === group)) {
      setGroup(groups[0].name)
    }
  }, [group, groups, open])

  useEffect(() => {
    if (!open) return
    setModel((current) =>
      models.includes(current) ? current : (models[0] ?? '')
    )
    setChannelID((current) => {
      if (current === 0) return current
      const channel = channels.find((item) => item.id === current)
      return channel && splitValues(channel.group).includes(group) ? current : 0
    })
  }, [channels, group, models, open])

  const planQuery = useQuery({
    queryKey: ['channel-execution-plan', group, model, requestPath, mode],
    queryFn: () =>
      getChannelExecutionPlan({
        group,
        model,
        path: requestPath.trim(),
        mode,
      }),
    enabled: open && group !== '' && model !== '',
    retry: false,
  })

  const recentQuery = useQuery({
    queryKey: ['channel-execution-traces', channelID, group],
    queryFn: () =>
      getRecentChannelExecutionTraces({
        channel_id: channelID > 0 ? channelID : undefined,
        group,
        limit: 20,
      }),
    enabled: open && group !== '',
    refetchInterval: (query) =>
      query.state.data?.data?.some((item) => item.status === 'running')
        ? 1500
        : 10_000,
    retry: false,
  })

  const traceQuery = useQuery({
    queryKey: ['channel-execution-trace', searchedRequestID],
    queryFn: () => getChannelExecutionTrace(searchedRequestID),
    enabled: open && searchedRequestID !== '',
    refetchInterval: (query) =>
      query.state.data?.data?.status === 'running' ? 1000 : false,
    retry: false,
  })

  const plan = planQuery.data?.data
  const groupChannels = useMemo(
    () => channels.filter((item) => splitValues(item.group).includes(group)),
    [channels, group]
  )
  const channelNames = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel.name])),
    [channels]
  )
  const recentTraces = useMemo(
    () => recentQuery.data?.data ?? [],
    [recentQuery.data?.data]
  )
  const selectedRecentTrace = recentTraces.find(
    (item) => item.request_id === selectedRequestID
  )
  const trace = selectExecutionTrace(
    searchedRequestID,
    traceQuery.data,
    selectedRecentTrace
  )
  const traceEvents = trace?.events ?? []
  const executionEvents =
    traceEvents.length > 0
      ? traceEvents
      : buildCompactChannelExecutionEvents(trace, {
          channelId: trace?.channel_ids?.[0],
          channelName: trace?.channel_ids?.[0]
            ? channelNames.get(trace.channel_ids[0])
            : undefined,
          startedAt: trace?.started_at,
          endedAt: trace?.updated_at,
        })
  const executionTimeline = buildChannelExecutionTimeline(executionEvents, {
    status: trace?.status,
    endedAt: trace?.updated_at,
  })
  const standbyChannelIds = getStandbyChannelIds(executionTimeline)
  const submitRequestID = () => {
    const nextRequestID = requestID.trim()
    if (!nextRequestID) return
    if (nextRequestID === searchedRequestID) {
      void traceQuery.refetch()
      return
    }
    setSearchedRequestID(nextRequestID)
    setSelectedRequestID(nextRequestID)
  }
  const traceSearchError = searchedRequestID
    ? traceQuery.isError
      ? queryErrorMessage(traceQuery.error, t('Execution trace not found'))
      : traceQuery.data && !traceQuery.data.success
        ? traceQuery.data.message || t('Execution trace not found')
        : ''
    : ''

  useEffect(() => {
    setSearchedRequestID('')
    setRequestID('')
    setSelectedRequestID('')
  }, [channelID, group])

  useEffect(() => {
    if (!open || searchedRequestID || recentTraces.length === 0) return
    if (recentTraces.some((item) => item.request_id === selectedRequestID)) {
      return
    }
    const preferred =
      recentTraces.find((item) => item.status === 'running') ?? recentTraces[0]
    setSelectedRequestID(preferred.request_id)
  }, [open, recentTraces, searchedRequestID, selectedRequestID])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Group execution plan')}
      description={t(
        'Generate candidate plans by group, model, path, and routing strategy'
      )}
      contentClassName='sm:max-w-4xl'
      contentHeight='min(76dvh, 720px)'
      bodyClassName='space-y-4 pr-1'
    >
      <section className='space-y-3 border-b pb-4'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div className='space-y-0.5'>
            <h3 className='text-sm font-medium'>{t('Strategy preview')}</h3>
            <p className='text-muted-foreground text-xs'>
              {t(
                'The selected group determines the candidate channels and execution order'
              )}
            </p>
          </div>
          <div className='bg-muted inline-flex h-8 items-center rounded-md p-0.5'>
            <Button
              type='button'
              size='sm'
              variant={mode === 'route' ? 'secondary' : 'ghost'}
              className='h-7 rounded-sm px-3'
              onClick={() => setMode('route')}
            >
              {t('Channel routing')}
            </Button>
            <Button
              type='button'
              size='sm'
              variant={mode === 'retry' ? 'secondary' : 'ghost'}
              className='h-7 rounded-sm px-3'
              onClick={() => setMode('retry')}
            >
              {t('Traditional retry')}
            </Button>
          </div>
        </div>

        <div className='grid gap-3 sm:grid-cols-3'>
          <div className='space-y-1.5'>
            <Label>{t('Group')}</Label>
            <Select<string>
              value={group}
              items={groups.map((item) => ({
                value: item.name,
                label: item.name,
              }))}
              onValueChange={(value) => value !== null && setGroup(value)}
            >
              <SelectTrigger className='w-full'>
                <SelectValue
                  placeholder={
                    channelsQuery.isLoading
                      ? t('Loading groups...')
                      : t('Select group')
                  }
                />
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
          </div>
          <div className='space-y-1.5'>
            <Label>{t('Model')}</Label>
            <Select<string>
              value={model}
              items={models.map((value) => ({ value, label: value }))}
              onValueChange={(value) => value !== null && setModel(value)}
            >
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {models.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='route-execution-path'>{t('Path')}</Label>
            <Input
              id='route-execution-path'
              value={requestPath}
              onChange={(event) => setRequestPath(event.target.value)}
            />
          </div>
        </div>

        {planQuery.isLoading ? (
          <div className='text-muted-foreground flex h-20 items-center justify-center gap-2 text-sm'>
            <Loader2 className='size-4 animate-spin' />
            {t('Calculating execution plan...')}
          </div>
        ) : planQuery.isError ? (
          <div className='flex flex-wrap items-center justify-between gap-3 py-4'>
            <p className='text-destructive text-sm'>
              {queryErrorMessage(
                planQuery.error,
                t('Failed to load execution plan')
              )}
            </p>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() => void planQuery.refetch()}
              disabled={planQuery.isFetching}
            >
              <RefreshCcw
                className={cn(
                  'size-3.5',
                  planQuery.isFetching && 'animate-spin'
                )}
              />
              {t('Retry')}
            </Button>
          </div>
        ) : planQuery.data && !planQuery.data.success ? (
          <p className='text-destructive py-4 text-sm'>
            {planQuery.data.message || t('Failed to load execution plan')}
          </p>
        ) : plan?.pools.length ? (
          <div className='space-y-3'>
            <div className='bg-muted/30 grid overflow-hidden rounded-md border sm:grid-cols-3 sm:divide-x'>
              <div className='flex min-w-0 items-center gap-2.5 border-b px-3 py-2.5 sm:border-b-0'>
                <div className='bg-background text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border'>
                  <ArrowDown className='size-4' />
                </div>
                <div className='min-w-0'>
                  <div className='text-xs font-medium'>{t('Priority')}</div>
                  <div className='text-muted-foreground mt-0.5 text-xs'>
                    {t('Higher values are selected first')}
                  </div>
                </div>
              </div>
              <div className='flex min-w-0 items-center gap-2.5 border-b px-3 py-2.5 sm:border-b-0'>
                <div className='bg-background text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border'>
                  <Shuffle className='size-4' />
                </div>
                <div className='min-w-0'>
                  <div className='text-xs font-medium'>
                    {t('Same priority')}
                  </div>
                  <div className='text-muted-foreground mt-0.5 text-xs'>
                    {t('Random selection by weight')}
                  </div>
                </div>
              </div>
              <div className='flex min-w-0 items-center gap-2.5 px-3 py-2.5'>
                <div className='bg-background text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border'>
                  <Equal className='size-4' />
                </div>
                <div className='min-w-0'>
                  <div className='text-xs font-medium'>
                    {t('All weights are 0')}
                  </div>
                  <div className='text-muted-foreground mt-0.5 text-xs'>
                    {t('Equal probability selection')}
                  </div>
                </div>
              </div>
            </div>
            <div className='space-y-3'>
              {plan.pools.map((pool, index) => {
                const hasPositiveWeight = pool.candidates.some(
                  (candidate) => candidate.weight > 0
                )
                return (
                  <div
                    key={pool.priority}
                    className='overflow-hidden rounded-md border'
                  >
                    <div className='bg-muted/30 flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5'>
                      <div className='flex min-w-0 items-center gap-2'>
                        <span className='text-sm font-medium'>
                          {t('Priority level {{level}}', { level: index + 1 })}
                        </span>
                        <StatusBadge
                          variant='neutral'
                          size='sm'
                          copyable={false}
                        >
                          {t('Priority')} {pool.priority}
                        </StatusBadge>
                      </div>
                      <span className='text-muted-foreground text-xs'>
                        {t('{{count}} candidate channels', {
                          count: pool.candidates.length,
                        })}
                      </span>
                    </div>
                    <div className='divide-y'>
                      <div className='text-muted-foreground bg-muted/10 hidden grid-cols-[minmax(0,1fr)_7rem_8rem] gap-3 px-3 py-1.5 text-[11px] sm:grid'>
                        <span>{t('Candidate channel')}</span>
                        <span>{t('Weight')}</span>
                        <span className='text-right'>{t('Status')}</span>
                      </div>
                      {pool.candidates.map((candidate) => {
                        const zeroWeightExcluded =
                          hasPositiveWeight && candidate.weight === 0
                        const candidateCooling = candidate.state === 'cooling'
                        return (
                          <div
                            key={candidate.channel_id}
                            className={cn(
                              'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_8rem]',
                              (candidateCooling || zeroWeightExcluded) &&
                                'bg-muted/20'
                            )}
                          >
                            <div className='flex min-w-0 items-center gap-2'>
                              <span className='bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px]'>
                                #{candidate.channel_id}
                              </span>
                              <span
                                className={cn(
                                  'truncate text-sm font-medium',
                                  (candidateCooling || zeroWeightExcluded) &&
                                    'text-muted-foreground'
                                )}
                              >
                                {candidate.channel_name}
                              </span>
                            </div>
                            <div className='text-muted-foreground text-right text-xs sm:text-left'>
                              <span className='sm:hidden'>{t('Weight')} </span>
                              <span className='text-foreground font-medium'>
                                {candidate.weight}
                              </span>
                            </div>
                            <div className='col-span-2 flex sm:col-span-1 sm:justify-end'>
                              {candidateCooling ? (
                                <StatusBadge
                                  variant='warning'
                                  size='sm'
                                  copyable={false}
                                >
                                  <Snowflake className='size-3' />
                                  {t('Cooling')}
                                </StatusBadge>
                              ) : zeroWeightExcluded ? (
                                <StatusBadge
                                  variant='neutral'
                                  size='sm'
                                  copyable={false}
                                >
                                  {t('Not selected')}
                                </StatusBadge>
                              ) : (
                                <StatusBadge
                                  variant='success'
                                  size='sm'
                                  copyable={false}
                                >
                                  <CheckCircle2 className='size-3' />
                                  {t('Eligible')}
                                </StatusBadge>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <p className='text-muted-foreground py-4 text-sm'>
            {t('No matching candidates')}
          </p>
        )}
      </section>

      <section className='space-y-3'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='space-y-0.5'>
            <h3 className='text-sm font-medium'>
              {t('Request execution trace')}
            </h3>
            <p className='text-muted-foreground text-xs'>
              {t('Running and recent requests in the selected group')}
            </p>
          </div>
          <StatusBadge
            variant={
              recentTraces.some((item) => item.status === 'running')
                ? 'info'
                : 'neutral'
            }
            pulse={recentTraces.some((item) => item.status === 'running')}
            size='sm'
            copyable={false}
          >
            {recentTraces.some((item) => item.status === 'running')
              ? t('{{count}} running', {
                  count: recentTraces.filter(
                    (item) => item.status === 'running'
                  ).length,
                })
              : t('No running requests')}
          </StatusBadge>
        </div>

        <div className='grid gap-2 sm:grid-cols-[minmax(180px,0.75fr)_minmax(0,1.25fr)_auto]'>
          <Select<number>
            value={channelID}
            items={[
              { value: 0, label: t('All channels') },
              ...groupChannels.map((item) => ({
                value: item.id,
                label: `#${item.id} ${item.name}`,
              })),
            ]}
            onValueChange={(value) => value !== null && setChannelID(value)}
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
            value={requestID}
            onChange={(event) => setRequestID(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitRequestID()
            }}
            placeholder={t('Optional: search by request ID')}
            className='font-mono'
          />
          <Button
            type='button'
            size='icon'
            variant='outline'
            onClick={submitRequestID}
            disabled={!requestID.trim() || traceQuery.isFetching}
            aria-label={t('View execution trace')}
            title={t('View execution trace')}
          >
            {traceQuery.isFetching ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Search className='size-4' />
            )}
          </Button>
        </div>

        <div className='grid min-h-[220px] overflow-hidden rounded-md border lg:grid-cols-[250px_minmax(0,1fr)]'>
          <div className='bg-muted/20 min-w-0 border-b lg:border-r lg:border-b-0'>
            <div className='flex items-center justify-between border-b px-3 py-2'>
              <span className='text-xs font-medium'>
                {t('Recent requests')}
              </span>
              {recentQuery.isFetching && (
                <Loader2 className='text-muted-foreground size-3 animate-spin' />
              )}
            </div>
            <div className='max-h-52 overflow-y-auto lg:max-h-[340px]'>
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
                    className='h-7 text-xs'
                    onClick={() => void recentQuery.refetch()}
                    disabled={recentQuery.isFetching}
                  >
                    <RefreshCcw
                      className={cn(
                        'size-3',
                        recentQuery.isFetching && 'animate-spin'
                      )}
                    />
                    {t('Retry')}
                  </Button>
                </div>
              ) : recentQuery.data && !recentQuery.data.success ? (
                <p className='text-destructive p-3 text-xs'>
                  {recentQuery.data.message ||
                    t('Failed to load recent requests')}
                </p>
              ) : recentTraces.length === 0 ? (
                <div className='text-muted-foreground space-y-1 p-4 text-center text-xs'>
                  <p>{t('No recent requests for this group')}</p>
                  <p className='text-[11px]'>
                    {t('Execution traces are retained for 30 minutes')}
                  </p>
                </div>
              ) : (
                recentTraces.map((item) => (
                  <button
                    key={item.request_id}
                    type='button'
                    className={cn(
                      'hover:bg-muted/60 flex w-full min-w-0 flex-col gap-1 border-b px-3 py-2.5 text-left last:border-b-0',
                      !searchedRequestID &&
                        selectedRequestID === item.request_id &&
                        'bg-muted'
                    )}
                    onClick={() => {
                      setSearchedRequestID('')
                      setSelectedRequestID(item.request_id)
                    }}
                  >
                    <div className='flex w-full min-w-0 items-center gap-2'>
                      <StatusBadge
                        variant={traceStatusVariant(item.status)}
                        pulse={item.status === 'running'}
                        size='sm'
                        copyable={false}
                      >
                        {t(traceStatusLabel(item.status))}
                      </StatusBadge>
                      <span className='text-muted-foreground ml-auto font-mono text-[11px] tabular-nums'>
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

          <div className='min-w-0 p-3 sm:p-4'>
            {searchedRequestID && traceQuery.isFetching ? (
              <div className='text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm'>
                <Loader2 className='size-4 animate-spin' />
                {t('Loading execution trace...')}
              </div>
            ) : traceSearchError ? (
              <p className='text-destructive py-3 text-sm'>
                {traceSearchError}
              </p>
            ) : trace ? (
              <div className='space-y-3'>
                <div className='space-y-2.5 border-b pb-3'>
                  <div className='flex flex-wrap items-center gap-2'>
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
                  <div className='bg-muted/35 rounded-md px-3 py-2.5'>
                    <div className='mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5'>
                      <span className='text-xs font-medium'>
                        {t('Request matching context')}
                      </span>
                      <span className='text-muted-foreground text-[11px]'>
                        {t(
                          'Route affinity uses the same group, model, and path to find the last successful channel'
                        )}
                      </span>
                    </div>
                    <dl className='grid gap-2 sm:grid-cols-3'>
                      {[
                        [t('Group'), trace.group],
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
                      {trace.route_groups && trace.route_groups.length > 1 ? (
                        <div className='min-w-0 sm:col-span-3'>
                          <dt className='text-muted-foreground text-[11px]'>
                            {t('Group route chain')}
                          </dt>
                          <dd className='truncate font-mono text-xs font-medium'>
                            {trace.route_groups.join(' → ')}
                          </dd>
                        </div>
                      ) : null}
                      {trace.route_group_statuses?.length ? (
                        <div className='min-w-0 sm:col-span-3'>
                          <dt className='text-muted-foreground text-[11px]'>
                            {t('Group route status')}
                          </dt>
                          <dd className='flex flex-wrap gap-1.5 pt-1'>
                            {trace.route_group_statuses.map((item) => (
                              <StatusBadge
                                key={item.group}
                                variant={routeGroupStatusVariant(item.status)}
                                size='sm'
                                copyable={false}
                              >
                                <span className='font-mono'>{item.group}</span>
                                <span className='text-[11px]'>
                                  {t(routeGroupStatusLabel(item.status))}
                                </span>
                              </StatusBadge>
                            ))}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                </div>
                <div className='space-y-3'>
                  <div className='flex flex-wrap items-center gap-2'>
                    {trace.compact ? (
                      <StatusBadge variant='neutral' size='sm' copyable={false}>
                        {t('Execution summary')}
                      </StatusBadge>
                    ) : null}
                    {standbyChannelIds.length > 0 ? (
                      <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
                        <span className='text-muted-foreground text-xs'>
                          {t('Standby channels')}
                        </span>
                        {standbyChannelIds.map((channelID) => (
                          <StatusBadge
                            key={channelID}
                            variant='neutral'
                            size='sm'
                            copyable={false}
                          >
                            <span className='font-mono'>#{channelID}</span>
                            {channelNames.get(channelID) ||
                              t('Unknown channel')}
                          </StatusBadge>
                        ))}
                        <span className='text-muted-foreground text-[11px]'>
                          {t(
                            'Not executed; used only if the current channel fails'
                          )}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <ChannelExecutionTimelineList
                    items={executionTimeline}
                    executionGroup={trace.group}
                  />
                </div>
              </div>
            ) : searchedRequestID && traceQuery.isLoading ? (
              <div className='text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm'>
                <Loader2 className='size-4 animate-spin' />
                {t('Loading execution trace...')}
              </div>
            ) : (
              <div className='text-muted-foreground flex h-full min-h-40 items-center justify-center px-4 text-center text-sm'>
                {t('Select a recent request to view its execution trace')}
              </div>
            )}
          </div>
        </div>
      </section>
    </Dialog>
  )
}
