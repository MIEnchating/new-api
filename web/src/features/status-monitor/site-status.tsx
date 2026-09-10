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
  Radio,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { PublicLayout } from '@/components/layout'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getUptimeStatus } from '@/features/dashboard/api'
import type {
  RecentRequestStats,
  UptimeGroupResult,
  UptimeHeartbeat,
  UptimeMonitor,
} from '@/features/dashboard/types'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { getOfficialProviderStatuses } from './api'
import { MonitorDetailsDrawer } from './monitor-details-drawer'
import { getOrderedHeartbeats, getMonitorRequestStats } from './monitor-utils'
import { OfficialProviderStatuses } from './official-provider-status'
import { RefreshControl } from './refresh-control'

type MonitorStatusMeta = {
  label: string
  icon: LucideIcon
  dotClassName: string
  textClassName: string
  variant: StatusVariant
}

const STATUS_META: Record<number, MonitorStatusMeta> = {
  1: {
    label: 'Operational',
    icon: CheckCircle2,
    dotClassName: 'bg-success',
    textClassName: 'text-status-success',
    variant: 'success',
  },
  0: {
    label: 'Down',
    icon: AlertTriangle,
    dotClassName: 'bg-destructive',
    textClassName: 'text-destructive',
    variant: 'danger',
  },
  2: {
    label: 'Retry',
    icon: CircleDashed,
    dotClassName: 'bg-warning',
    textClassName: 'text-status-warning',
    variant: 'warning',
  },
  3: {
    label: 'Maintenance',
    icon: Wrench,
    dotClassName: 'bg-info',
    textClassName: 'text-info',
    variant: 'info',
  },
}

const UNKNOWN_STATUS_META: MonitorStatusMeta = {
  label: 'Unknown',
  icon: CircleDashed,
  dotClassName: 'bg-muted-foreground/40',
  textClassName: 'text-background/70',
  variant: 'neutral',
}

const ALL_GROUP_KEY = 'all'
type FetchMode = 'initial' | 'refresh'

function getStatusMeta(status: number) {
  return STATUS_META[status] ?? UNKNOWN_STATUS_META
}

function formatPing(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${Math.round(value)} ms`
}

function formatUptime(value: number | null | undefined) {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) return '0.00%'
  return `${(Math.max(0, numeric) * 100).toFixed(2)}%`
}

function formatOptionalUptime(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return formatUptime(value)
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { hourCycle: 'h23' })
}

function formatTimelineBoundary(value: string | null | undefined) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

function getRelativeTime(
  value: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return formatDateTime(value)
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 60_000) return t('Just now')

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) {
    return t('{{count}} minutes ago', { count: minutes })
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return t('{{count}} hours ago', { count: hours })
  }

  const days = Math.floor(hours / 24)
  return t('{{count}} days ago', { count: days })
}

function getSourceKey(group: UptimeGroupResult, index: number) {
  return `${group.categoryName || 'uptime-kuma'}-${index}`
}

function getUptimeGroupKey(group: string | undefined) {
  const name = group?.trim()
  return name ? `uptime-group:${name}` : 'uptime-group:__ungrouped__'
}

function getMonitorKey(sourceKey: string, monitor: UptimeMonitor) {
  return [
    sourceKey,
    monitor.group,
    monitor.name,
    monitor.lastChecked,
    monitor.heartbeats?.[0]?.time,
    monitor.status,
  ]
    .filter((part) => part !== undefined && part !== null && part !== '')
    .join('-')
}

function MonitorStatusBadge(props: { status: number }) {
  const { t } = useTranslation()
  const meta = getStatusMeta(props.status)
  const Icon = meta.icon

  return (
    <StatusBadge
      variant={meta.variant}
      className='sm:min-w-24'
      copyable={false}
    >
      <Icon data-icon='inline-start' />
      {t(meta.label)}
    </StatusBadge>
  )
}

const HeartbeatTimeline = memo(function HeartbeatTimeline(props: {
  heartbeats?: UptimeHeartbeat[]
}) {
  const { t } = useTranslation()
  const heartbeats = useMemo(
    () => getOrderedHeartbeats(props.heartbeats).slice(-48),
    [props.heartbeats]
  )

  if (heartbeats.length === 0) {
    return (
      <div className='bg-muted/30 text-muted-foreground flex h-12 items-center justify-center rounded-md border border-dashed text-xs'>
        {t('No heartbeat data')}
      </div>
    )
  }

  return (
    <>
      <TooltipProvider delay={0}>
        <div
          className='grid h-10 min-w-0 items-end gap-px sm:h-12 sm:gap-1'
          style={{
            gridTemplateColumns: `repeat(${heartbeats.length}, minmax(4px, 1fr))`,
          }}
          aria-label={t('Heartbeat timeline')}
        >
          {heartbeats.map((heartbeat) => {
            const meta = getStatusMeta(heartbeat.status)
            const hasPing =
              typeof heartbeat.ping === 'number' &&
              Number.isFinite(heartbeat.ping)
            let detail: string | null = null
            if (heartbeat.msg) {
              detail = heartbeat.msg
            } else if (hasPing) {
              detail = `${t('Latency')}: ${formatPing(heartbeat.ping)}`
            }
            const label = [
              `${t('Status')}: ${t(meta.label)}`,
              formatDateTime(heartbeat.time),
              detail,
            ]
              .filter(Boolean)
              .join(' · ')

            return (
              <Tooltip
                key={`${heartbeat.time ?? 'heartbeat'}-${heartbeat.status}-${heartbeat.ping ?? 'na'}-${heartbeat.msg ?? ''}`}
              >
                <TooltipTrigger
                  render={
                    <span
                      aria-label={label}
                      className={cn(
                        'block min-h-3 cursor-default rounded-full transition-[transform,filter,box-shadow] duration-150 ease-out hover:z-10 hover:-translate-y-1 hover:brightness-110 hover:shadow-sm',
                        heartbeat.status === 1 ? 'h-10 sm:h-12' : 'h-7 sm:h-8',
                        meta.dotClassName
                      )}
                    />
                  }
                />
                <TooltipContent
                  side='top'
                  sideOffset={6}
                  className='max-w-72 min-w-48 flex-col items-stretch gap-0 px-3 py-2.5'
                >
                  <span
                    className={cn(
                      'text-center text-sm font-semibold',
                      meta.textClassName
                    )}
                  >
                    {t(meta.label)}
                  </span>
                  <span className='mt-1 text-center text-xs tabular-nums opacity-75'>
                    {formatDateTime(heartbeat.time)}
                  </span>
                  {detail ? (
                    <span className='border-background/15 mt-2 border-t pt-2 text-xs leading-relaxed break-words'>
                      {detail}
                    </span>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </TooltipProvider>
      <div className='text-muted-foreground mt-1.5 flex items-center justify-between gap-3 text-[11px] tabular-nums'>
        <span className='truncate'>
          {formatTimelineBoundary(heartbeats[0]?.time)}
        </span>
        <span className='truncate text-right'>
          {formatTimelineBoundary(heartbeats.at(-1)?.time)}
        </span>
      </div>
    </>
  )
})

function MetricItem(props: { label: string; value: string }) {
  return (
    <div className='bg-card min-w-0 px-3 py-2.5 sm:px-3.5 sm:py-3'>
      <div className='text-muted-foreground truncate text-xs'>
        {props.label}
      </div>
      <div className='mt-1 truncate text-sm font-semibold tabular-nums'>
        {props.value}
      </div>
    </div>
  )
}

const MonitorRow = memo(function MonitorRow(props: {
  monitor: UptimeMonitor
  onSelect: (monitor: UptimeMonitor) => void
}) {
  const { t } = useTranslation()
  const meta = getStatusMeta(props.monitor.status)

  return (
    <article className='bg-card hover:border-foreground/20 min-w-0 overflow-hidden rounded-2xl border shadow-xs transition-[box-shadow,border-color] duration-200 hover:shadow-md'>
      <button
        type='button'
        data-press-animation='none'
        onClick={() => props.onSelect(props.monitor)}
        className='hover:bg-muted/20 active:bg-muted/40 focus-visible:ring-ring w-full cursor-pointer p-4 text-left transition-colors duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-inset sm:p-6'
      >
        <div className='flex min-w-0 items-start justify-between gap-3'>
          <div className='flex min-w-0 flex-1 items-center gap-3'>
            <span
              className={cn(
                'size-2.5 shrink-0 rounded-full',
                meta.dotClassName
              )}
            />
            <div className='min-w-0'>
              <div className='truncate text-sm font-semibold'>
                {props.monitor.name || t('Unnamed monitor')}
              </div>
              {props.monitor.group ? (
                <span className='bg-muted text-muted-foreground mt-1 inline-flex max-w-full rounded px-1.5 py-0.5 text-xs'>
                  <span className='truncate'>
                    {t('Group')}: {props.monitor.group}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
          <div className='flex shrink-0 items-center gap-1'>
            <MonitorStatusBadge status={props.monitor.status} />
            <ChevronRight className='text-muted-foreground size-4' />
          </div>
        </div>

        <div className='bg-muted/40 mt-5 grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-xl sm:grid-cols-3'>
          <MetricItem
            label={t('30-minute uptime')}
            value={formatOptionalUptime(props.monitor.uptime30m)}
          />
          <MetricItem
            label={t('1-hour uptime')}
            value={formatOptionalUptime(props.monitor.uptime1h)}
          />
          <MetricItem
            label={t('24-hour uptime')}
            value={formatUptime(props.monitor.uptime24 ?? props.monitor.uptime)}
          />
          <MetricItem
            label={t('7-day uptime')}
            value={formatOptionalUptime(props.monitor.uptime7)}
          />
          <MetricItem
            label={t('Latency')}
            value={formatPing(props.monitor.ping)}
          />
          <MetricItem
            label={t('Last check')}
            value={getRelativeTime(props.monitor.lastChecked, t)}
          />
        </div>
      </button>

      <div className='px-4 pt-0 pb-4 sm:px-6 sm:pb-6'>
        <HeartbeatTimeline heartbeats={props.monitor.heartbeats} />
      </div>
    </article>
  )
})

function LoadingState() {
  return (
    <div
      data-slot='site-status-skeleton'
      aria-hidden='true'
      className='flex h-full min-h-0 flex-col gap-6 overflow-clip'
    >
      <div className='flex min-h-0 flex-1 flex-col gap-5 overflow-clip'>
        <div className='shrink-0 border-b p-1 pb-3'>
          <Skeleton className='h-9 w-72 max-w-full rounded-lg' />
        </div>
        <div className='grid min-h-0 gap-5 overflow-clip md:grid-cols-2 xl:grid-cols-3'>
          {['first', 'second', 'third', 'fourth', 'fifth', 'sixth'].map(
            (key) => (
              <div
                key={key}
                className='space-y-5 rounded-2xl border p-4 sm:p-6'
              >
                <Skeleton className='h-5 w-36 max-w-full' />
                <Skeleton className='h-4 w-20' />
                <div className='grid grid-cols-2 gap-5 sm:grid-cols-3'>
                  {['30m', '1h', '24h', '7d', 'latency', 'checked'].map(
                    (metric) => (
                      <div key={metric} className='space-y-2'>
                        <Skeleton className='h-3 w-full' />
                        <Skeleton className='h-4 w-16 max-w-full' />
                      </div>
                    )
                  )}
                </div>
                <Skeleton className='h-12 w-full' />
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

export function SiteStatus() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('site-status')
  const officialQuery = useQuery({
    queryKey: ['official-provider-status'],
    queryFn: async () =>
      requireServerSuccess(await getOfficialProviderStatuses()),
    enabled: activeTab === 'official-status',
    staleTime: 60_000,
    retry: false,
    meta: { errorToast: false },
  })
  const { refetch: refetchOfficialStatus } = officialQuery
  const [groups, setGroups] = useState<UptimeGroupResult[]>([])
  const [requestStats, setRequestStats] = useState<RecentRequestStats | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [activeGroupKey, setActiveGroupKey] = useState(ALL_GROUP_KEY)
  const [selectedMonitor, setSelectedMonitor] = useState<UptimeMonitor | null>(
    null
  )
  const [monitorDetailsOpen, setMonitorDetailsOpen] = useState(false)
  const fetchSiteStatus = useCallback(async (mode: FetchMode) => {
    if (mode === 'initial') {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setFailed(false)
    try {
      const uptimeResult = requireServerSuccess(await getUptimeStatus())
      setGroups(uptimeResult?.data ?? [])
      setRequestStats(uptimeResult?.request_stats ?? null)
      setLastUpdated(new Date())
    } catch {
      setGroups([])
      setRequestStats(null)
      setFailed(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchSiteStatus('initial')
  }, [fetchSiteStatus])

  const monitors = useMemo(
    () => groups.flatMap((group) => group.monitors ?? []),
    [groups]
  )
  const monitorItems = useMemo(
    () =>
      groups.flatMap((group, sourceIndex) => {
        const sourceKey = getSourceKey(group, sourceIndex)
        return (group.monitors ?? []).map((monitor) => ({
          key: getMonitorKey(sourceKey, monitor),
          groupKey: getUptimeGroupKey(monitor.group),
          groupLabel: monitor.group?.trim() || t('Ungrouped'),
          monitor,
        }))
      }),
    [groups, t]
  )
  const groupOptions = useMemo(() => {
    const optionMap = new Map<
      string,
      {
        key: string
        label: string
        monitorItems: typeof monitorItems
      }
    >()

    for (const item of monitorItems) {
      const label = item.groupLabel
      const option = optionMap.get(item.groupKey)

      if (option) {
        option.monitorItems.push(item)
      } else {
        optionMap.set(item.groupKey, {
          key: item.groupKey,
          label,
          monitorItems: [item],
        })
      }
    }

    return [...optionMap.values()]
  }, [monitorItems])
  const groupOptionMap = useMemo(
    () => new Map(groupOptions.map((group) => [group.key, group])),
    [groupOptions]
  )
  const visibleMonitorItems = useMemo(() => {
    if (activeGroupKey === ALL_GROUP_KEY) return monitorItems

    return groupOptionMap.get(activeGroupKey)?.monitorItems ?? []
  }, [activeGroupKey, groupOptionMap, monitorItems])
  useEffect(() => {
    if (
      activeGroupKey !== ALL_GROUP_KEY &&
      !groupOptions.some((group) => group.key === activeGroupKey)
    ) {
      setActiveGroupKey(ALL_GROUP_KEY)
    }
  }, [activeGroupKey, groupOptions])

  const handleManualRefresh = useCallback(() => {
    if (activeTab === 'official-status') {
      void refetchOfficialStatus()
    } else {
      void fetchSiteStatus('refresh')
    }
  }, [activeTab, fetchSiteStatus, refetchOfficialStatus])

  const handleMonitorSelect = useCallback((monitor: UptimeMonitor) => {
    setSelectedMonitor(monitor)
    setMonitorDetailsOpen(true)
  }, [])

  let content = null
  if (loading) {
    content = <LoadingState />
  } else if (failed) {
    content = <EmptyState title={t('Failed to load status monitoring data')} />
  } else if (!groups.length || monitors.length === 0) {
    content = <EmptyState title={t('No uptime monitoring configured')} />
  } else {
    content = (
      <Tabs
        className='min-h-0 flex-1 gap-5 overflow-hidden'
        value={activeGroupKey}
        onValueChange={(value) => {
          setActiveGroupKey(value || ALL_GROUP_KEY)
        }}
      >
        <TabsList className='w-full max-w-full shrink-0 [scrollbar-width:none] flex-nowrap justify-start gap-1.5 overflow-x-auto rounded-none border-b bg-transparent p-1 pb-3 group-data-horizontal/tabs:h-auto [&::-webkit-scrollbar]:hidden'>
          {[
            { key: ALL_GROUP_KEY, label: t('All'), monitorItems },
            ...groupOptions,
          ].map((group) => (
            <TabsTrigger
              key={group.key}
              value={group.key}
              aria-label={`${group.label} ${group.monitorItems.length}`}
              className='group/group-tab hover:bg-muted/60 data-active:border-primary/20 data-active:bg-primary/10 data-active:text-primary dark:data-active:border-primary/25 dark:data-active:bg-primary/15 dark:data-active:text-primary h-9 flex-none gap-2 rounded-lg px-3 py-1.5 group-data-[variant=default]/tabs-list:data-active:shadow-none'
            >
              <span
                className='max-w-32 truncate sm:max-w-48'
                title={group.label}
              >
                {group.label}
              </span>
              <Badge
                variant='secondary'
                className='bg-muted text-muted-foreground group-data-active/group-tab:bg-primary/15 group-data-active/group-tab:text-primary h-5 min-w-5 rounded-md px-1.5 text-[11px] tabular-nums'
              >
                {group.monitorItems.length}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent
          key={activeGroupKey}
          value={activeGroupKey}
          className='min-h-0 overflow-y-auto overscroll-contain pb-2'
        >
          {visibleMonitorItems.length > 0 ? (
            <div className='grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-3'>
              {visibleMonitorItems.map((item) => (
                <MonitorRow
                  key={item.key}
                  monitor={item.monitor}
                  onSelect={handleMonitorSelect}
                />
              ))}
            </div>
          ) : (
            <div className='text-muted-foreground rounded-lg border border-dashed p-6 text-sm'>
              {t('No uptime data available')}
            </div>
          )}
        </TabsContent>
      </Tabs>
    )
  }

  let refreshLoading = loading
  let refreshInProgress = refreshing
  let refreshedAt = lastUpdated
  if (activeTab === 'official-status') {
    refreshLoading = officialQuery.isPending
    refreshInProgress = officialQuery.isFetching && !officialQuery.isPending
    refreshedAt = officialQuery.dataUpdatedAt
      ? new Date(officialQuery.dataUpdatedAt)
      : null
  }

  return (
    <>
      <PublicLayout showMainContainer={false}>
        <div className='h-dvh overflow-hidden pt-16'>
          <main
            aria-label={t('Site status')}
            aria-busy={refreshLoading}
            className='h-full min-h-0 overflow-hidden'
          >
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                if (value) setActiveTab(value)
              }}
              className='mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8'
            >
              <div className='flex shrink-0 flex-col justify-between gap-3 sm:flex-row sm:items-center'>
                <TabsList className='shrink-0 gap-1 p-1 group-data-horizontal/tabs:h-auto'>
                  <TabsTrigger value='site-status' className='h-9 gap-2 px-3'>
                    <Activity className='size-4' />
                    {t('Site status')}
                  </TabsTrigger>
                  <TabsTrigger
                    value='official-status'
                    className='h-9 gap-2 px-3'
                  >
                    <Radio className='size-4' />
                    {t('Official status')}
                  </TabsTrigger>
                </TabsList>
                <RefreshControl
                  key={activeTab}
                  loading={refreshLoading}
                  refreshing={refreshInProgress}
                  lastUpdated={refreshedAt}
                  onRefresh={handleManualRefresh}
                />
              </div>
              <TabsContent
                value='site-status'
                className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
              >
                {loading || failed || monitors.length === 0 ? (
                  <div
                    className={cn(
                      'min-h-0 flex-1',
                      loading ? 'overflow-clip' : 'overflow-y-auto'
                    )}
                  >
                    {content}
                  </div>
                ) : (
                  content
                )}
              </TabsContent>
              <TabsContent
                value='official-status'
                className={cn(
                  'min-h-0 overscroll-contain pb-2',
                  officialQuery.isPending ? 'overflow-clip' : 'overflow-y-auto'
                )}
              >
                <OfficialProviderStatuses
                  response={officialQuery.data ?? null}
                  loading={officialQuery.isPending}
                  failed={officialQuery.isError}
                  compact
                />
              </TabsContent>
            </Tabs>
          </main>
        </div>
      </PublicLayout>
      <MonitorDetailsDrawer
        open={monitorDetailsOpen}
        monitor={selectedMonitor}
        requestStats={getMonitorRequestStats(
          requestStats,
          selectedMonitor?.name,
          selectedMonitor?.group
        )}
        onOpenChange={setMonitorDetailsOpen}
      />
    </>
  )
}
