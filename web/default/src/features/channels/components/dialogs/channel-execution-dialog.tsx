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
  type LucideIcon,
  CheckCircle2,
  CircleDot,
  Clock3,
  GitBranch,
  Loader2,
  RefreshCcw,
  Search,
  SkipForward,
  Snowflake,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
import { cn } from '@/lib/utils'

import {
  getChannelExecutionPlan,
  getChannelExecutionOptions,
  getRecentChannelExecutionTraces,
  getChannelExecutionTrace,
  type ChannelExecutionEvent,
} from '../../api'

type ChannelExecutionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const eventAppearance: Record<
  ChannelExecutionEvent['state'],
  { icon: LucideIcon; variant: StatusVariant; label: string }
> = {
  active: { icon: CircleDot, variant: 'info', label: 'Executing' },
  affinity_hit: { icon: GitBranch, variant: 'purple', label: 'Affinity hit' },
  same_channel_retry: {
    icon: RefreshCcw,
    variant: 'warning',
    label: 'Same-channel retry',
  },
  success: { icon: CheckCircle2, variant: 'success', label: 'Succeeded' },
  failed: { icon: XCircle, variant: 'danger', label: 'Failed' },
  cooling: { icon: Snowflake, variant: 'warning', label: 'Cooling' },
  skipped: { icon: SkipForward, variant: 'neutral', label: 'Skipped' },
  finished: { icon: Clock3, variant: 'neutral', label: 'Finished' },
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

function eventReasonLabel(reason?: string) {
  switch (reason) {
    case 'route_affinity':
      return 'Route affinity'
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
    refetchInterval: 1500,
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
  const recentTraces = useMemo(
    () => recentQuery.data?.data ?? [],
    [recentQuery.data?.data]
  )
  const selectedRecentTrace = recentTraces.find(
    (item) => item.request_id === selectedRequestID
  )
  const trace = traceQuery.data?.data ?? selectedRecentTrace
  const submitRequestID = () => {
    const nextRequestID = requestID.trim()
    setSearchedRequestID(nextRequestID)
    setSelectedRequestID(nextRequestID)
  }

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
        ) : planQuery.data && !planQuery.data.success ? (
          <p className='text-destructive py-4 text-sm'>
            {planQuery.data.message || t('Failed to load execution plan')}
          </p>
        ) : plan?.pools.length ? (
          <div className='divide-y overflow-hidden rounded-md border'>
            {plan.pools.map((pool, index) => (
              <div
                key={pool.priority}
                className='grid min-w-0 gap-2 px-3 py-2.5 sm:grid-cols-[2rem_7rem_minmax(0,1fr)] sm:items-center'
              >
                <span className='bg-muted flex size-7 items-center justify-center rounded-full font-mono text-xs'>
                  {index + 1}
                </span>
                <div className='min-w-0'>
                  <div className='text-sm font-medium'>
                    {t('Priority')} {pool.priority}
                  </div>
                  <div className='text-muted-foreground text-xs'>
                    {pool.candidates.length > 1
                      ? t('Weighted candidate pool')
                      : t('Single candidate')}
                  </div>
                </div>
                <div className='flex min-w-0 flex-wrap gap-1.5'>
                  {pool.candidates.map((candidate) => (
                    <StatusBadge
                      key={candidate.channel_id}
                      variant={
                        candidate.state === 'cooling' ? 'warning' : 'neutral'
                      }
                      copyable={false}
                    >
                      #{candidate.channel_id} {candidate.channel_name}
                      {pool.candidates.length > 1 && (
                        <span className='opacity-70'>w{candidate.weight}</span>
                      )}
                      {candidate.state === 'cooling' && (
                        <Snowflake className='size-3' />
                      )}
                    </StatusBadge>
                  ))}
                </div>
              </div>
            ))}
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
              ) : recentQuery.data && !recentQuery.data.success ? (
                <p className='text-destructive p-3 text-xs'>
                  {recentQuery.data.message ||
                    t('Failed to load recent requests')}
                </p>
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
                      !searchedRequestID &&
                        selectedRequestID === item.request_id &&
                        'bg-muted'
                    )}
                    onClick={() => {
                      setSearchedRequestID('')
                      setRequestID('')
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
            {traceQuery.data && !traceQuery.data.success ? (
              <p className='text-destructive py-3 text-sm'>
                {traceQuery.data.message || t('Execution trace not found')}
              </p>
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
                  <span className='text-muted-foreground text-xs'>
                    {trace.group} / {trace.model} / {trace.request_path}
                  </span>
                  <span className='text-muted-foreground ml-auto font-mono text-[11px] break-all'>
                    {trace.request_id}
                  </span>
                </div>
                <div>
                  {trace.events.map((event, index) => {
                    const appearance = eventAppearance[event.state]
                    const Icon = appearance.icon
                    return (
                      <div
                        key={`${event.sequence}-${event.timestamp}`}
                        className='relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-4 last:pb-0'
                      >
                        {index < trace.events.length - 1 && (
                          <span className='bg-border absolute top-7 bottom-0 left-[13px] w-px' />
                        )}
                        <span
                          className={cn(
                            'bg-background z-10 flex size-7 items-center justify-center rounded-full border',
                            event.state === 'active' &&
                              trace.status === 'running'
                              ? 'border-info text-info'
                              : 'text-muted-foreground'
                          )}
                        >
                          <Icon
                            className={cn(
                              'size-3.5',
                              event.state === 'active' &&
                                trace.status === 'running' &&
                                'animate-pulse'
                            )}
                          />
                        </span>
                        <div className='min-w-0 pt-0.5'>
                          <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                            <StatusBadge
                              variant={appearance.variant}
                              size='sm'
                              copyable={false}
                            >
                              {t(appearance.label)}
                            </StatusBadge>
                            {event.group && (
                              <span className='font-mono text-xs'>
                                {event.group}
                              </span>
                            )}
                            {event.channel_id ? (
                              <span className='text-xs font-medium'>
                                #{event.channel_id} {event.channel_name}
                              </span>
                            ) : null}
                            <span className='text-muted-foreground ml-auto font-mono text-xs tabular-nums'>
                              {formatEventTime(event.timestamp)}
                            </span>
                          </div>
                          {(event.reason || event.next_ids?.length) && (
                            <p className='text-muted-foreground mt-1 text-xs break-all'>
                              {event.reason
                                ? t(eventReasonLabel(event.reason))
                                : null}
                              {event.reason && event.next_ids?.length
                                ? ' · '
                                : null}
                              {event.next_ids?.length
                                ? `${t('Next candidate pool')}: ${event.next_ids.map((id) => `#${id}`).join(', ')}`
                                : null}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
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
