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
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  Database,
  Radio,
  RotateCw,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getUptimeStatus } from '@/features/dashboard/api'
import type {
  RecentRequestStats,
  RequestWindowStats,
  UptimeGroupResult,
  UptimeMonitor,
} from '@/features/dashboard/types'
import { cn } from '@/lib/utils'

import { getCacheMetrics, getOfficialProviderStatuses } from './api'
import { CacheMonitor } from './cache-monitor'
import { MonitorDetailsDrawer } from './monitor-details-drawer'
import {
  getLatestRequestWindow,
  getMonitorRequestStats,
  getRealRequestStatus,
} from './monitor-utils'
import { OfficialProviderStatuses } from './official-provider-status'
import type {
  CacheMetricsResponse,
  OfficialProviderStatusResponse,
} from './types'

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

const AUTO_REFRESH_SECONDS = 60
const ALL_GROUP_KEY = 'all'
type StatusMonitorTab = 'site-status' | 'cache-analytics' | 'official-status'
type FetchMode = 'initial' | 'refresh'

function getStatusMeta(status: number) {
  return STATUS_META[status] ?? UNKNOWN_STATUS_META
}

function formatPing(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${Math.round(value)} ms`
}

function formatRequestRate(value: RequestWindowStats | null | undefined) {
  if (!value?.has_data) return '--'
  return `${value.success_rate.toFixed(2)}%`
}

function formatRequestTime(
  value: number | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  if (!value) return '--'
  return getRelativeTime(new Date(value * 1000).toISOString(), t)
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { hourCycle: 'h23' })
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

function RefreshControl(props: {
  loading: boolean
  refreshing: boolean
  lastUpdated: Date | null
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const { loading, refreshing, lastUpdated, onRefresh } = props
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS)

  useEffect(() => {
    if (loading || refreshing) {
      setCountdown(AUTO_REFRESH_SECONDS)
      return
    }

    const timer = window.setInterval(() => {
      setCountdown((current) => Math.max(current - 1, 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [loading, refreshing])

  useEffect(() => {
    if (countdown !== 0 || loading || refreshing) return

    setCountdown(AUTO_REFRESH_SECONDS)
    onRefresh()
  }, [countdown, loading, onRefresh, refreshing])

  const lastUpdatedText = lastUpdated
    ? t('Updated {{time}}', {
        time: lastUpdated.toLocaleTimeString(undefined, {
          hourCycle: 'h23',
        }),
      })
    : ''

  return (
    <div className='flex w-full min-w-0 items-center justify-between gap-2 sm:w-auto sm:justify-start'>
      {lastUpdatedText ? (
        <div className='text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs'>
          <Clock3 className='size-3.5 shrink-0' />
          <span className='truncate whitespace-nowrap'>{lastUpdatedText}</span>
        </div>
      ) : null}
      <Button
        type='button'
        variant='outline'
        onClick={() => {
          setCountdown(AUTO_REFRESH_SECONDS)
          onRefresh()
        }}
        disabled={loading || refreshing}
        className='gap-2'
      >
        <RotateCw className={cn('size-4', refreshing && 'animate-spin')} />
        {t('Refresh')}
        {!loading ? (
          <span className='border-border min-w-8 border-l pl-2 text-right tabular-nums'>
            {countdown}s
          </span>
        ) : null}
      </Button>
    </div>
  )
}

function SummaryMetric(props: {
  label: string
  value: string
  icon: LucideIcon
  tone?: 'default' | 'success' | 'warning'
  className?: string
}) {
  const Icon = props.icon
  return (
    <div
      className={cn(
        'bg-card flex min-w-0 items-center gap-3 px-3 py-3 sm:px-4',
        props.className
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          props.tone === 'success' && 'bg-success/10 text-status-success',
          props.tone === 'warning' && 'bg-warning/10 text-status-warning',
          (!props.tone || props.tone === 'default') &&
            'bg-muted text-muted-foreground'
        )}
      >
        <Icon className='size-4' />
      </span>
      <div className='min-w-0'>
        <div className='truncate text-lg font-semibold tabular-nums'>
          {props.value}
        </div>
        <div className='text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs'>
          <span className='truncate'>{props.label}</span>
        </div>
      </div>
    </div>
  )
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
  requestStats: RecentRequestStats | null
  onSelect: (monitor: UptimeMonitor) => void
}) {
  const { t } = useTranslation()
  const status = getRealRequestStatus(props.requestStats)
  const meta = getStatusMeta(status)
  const latestWindow = getLatestRequestWindow(props.requestStats)

  return (
    <article className='bg-background/80 hover:border-foreground/20 overflow-hidden rounded-lg border transition-[box-shadow,border-color] duration-200 ease-out hover:shadow-md'>
      <button
        type='button'
        data-press-animation='none'
        onClick={() => props.onSelect(props.monitor)}
        className='hover:bg-muted/20 active:bg-muted/40 focus-visible:ring-ring w-full cursor-pointer p-3 text-left transition-colors duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-inset sm:p-4'
      >
        <div className='flex min-w-0 flex-wrap items-start justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-3'>
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
            <MonitorStatusBadge status={status} />
            <ChevronRight className='text-muted-foreground size-4' />
          </div>
        </div>

        <div className='bg-border mt-3 grid min-w-0 grid-cols-2 gap-px border-y sm:mt-4 sm:grid-cols-3'>
          <MetricItem
            label={`5 ${t('minutes')} · ${t('Success')}`}
            value={formatRequestRate(props.requestStats?.['5m'])}
          />
          <MetricItem
            label={`30 ${t('minutes')} · ${t('Success')}`}
            value={formatRequestRate(props.requestStats?.['30m'])}
          />
          <MetricItem
            label={`${t('1 hour')} · ${t('Success')}`}
            value={formatRequestRate(props.requestStats?.['1h'])}
          />
          <MetricItem
            label={`${t('1 hour')} · ${t('Requests')}`}
            value={String(props.requestStats?.['1h']?.request_count ?? 0)}
          />
          <MetricItem
            label={t('Average latency')}
            value={formatPing(latestWindow?.avg_latency_ms)}
          />
          <MetricItem
            label={t('Last check')}
            value={formatRequestTime(latestWindow?.last_request_at, t)}
          />
        </div>
      </button>

      <div className='px-3 py-3 sm:px-4 sm:py-4'>
        <RealRequestActivity stats={props.requestStats} />
      </div>
    </article>
  )
})

function RealRequestActivity(props: { stats: RecentRequestStats | null }) {
  const { t } = useTranslation()
  const windows = [
    { label: `5 ${t('minutes')}`, value: props.stats?.['5m'] },
    { label: `30 ${t('minutes')}`, value: props.stats?.['30m'] },
    { label: t('1 hour'), value: props.stats?.['1h'] },
  ]

  if (!windows.some((item) => item.value?.has_data)) {
    return (
      <div className='bg-muted/20 text-muted-foreground flex h-16 items-center justify-center rounded-md border border-dashed text-xs'>
        {t('No recent requests for this group')}
      </div>
    )
  }

  return (
    <div className='grid gap-2 sm:grid-cols-3'>
      {windows.map((item) => {
        const value = item.value
        const rate = value?.has_data ? value.success_rate : 0
        return (
          <div key={item.label} className='bg-muted/20 rounded-md border p-2.5'>
            <div className='flex items-center justify-between gap-2 text-xs'>
              <span className='text-muted-foreground'>{item.label}</span>
              <span className='font-medium tabular-nums'>
                {value?.has_data ? `${value.request_count ?? 0}` : '--'}
              </span>
            </div>
            <div className='bg-destructive/20 mt-2 h-1.5 overflow-hidden rounded-full'>
              <div
                className='bg-success h-full rounded-full transition-[width] duration-300'
                style={{ width: `${Math.max(0, Math.min(100, rate))}%` }}
              />
            </div>
            <div className='text-muted-foreground mt-1.5 flex items-center justify-between gap-2 text-[11px] tabular-nums'>
              <span>{formatRequestRate(value)}</span>
              <span>
                {t('Success')} {value?.success_count ?? 0} / {t('Failed')}{' '}
                {value?.failure_count ?? 0}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LoadingState() {
  return (
    <div className='space-y-3'>
      {['summary', 'primary', 'secondary'].map((key) => (
        <div key={key} className='rounded-lg border p-4'>
          <Skeleton className='h-5 w-36' />
          <div className='mt-4 space-y-3'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState(props: { title: string; description?: string }) {
  return (
    <div className='flex min-h-72 items-center justify-center rounded-lg border border-dashed p-6 text-center'>
      <div className='max-w-md'>
        <div className='bg-muted mx-auto flex size-10 items-center justify-center rounded-full'>
          <Activity className='text-muted-foreground size-5' />
        </div>
        <h3 className='mt-4 text-sm font-semibold'>{props.title}</h3>
        {props.description ? (
          <p className='text-muted-foreground mt-1 text-sm'>
            {props.description}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function StatusMonitor() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<StatusMonitorTab>('site-status')
  const [groups, setGroups] = useState<UptimeGroupResult[]>([])
  const [requestStats, setRequestStats] = useState<RecentRequestStats | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [cacheLoading, setCacheLoading] = useState(false)
  const [cacheRefreshing, setCacheRefreshing] = useState(false)
  const [cacheLoaded, setCacheLoaded] = useState(false)
  const [cacheFailed, setCacheFailed] = useState(false)
  const [providerStatusLoading, setProviderStatusLoading] = useState(false)
  const [providerStatusRefreshing, setProviderStatusRefreshing] =
    useState(false)
  const [providerStatusLoaded, setProviderStatusLoaded] = useState(false)
  const [providerStatusFailed, setProviderStatusFailed] = useState(false)
  const [cacheMetrics, setCacheMetrics] = useState<CacheMetricsResponse | null>(
    null
  )
  const [providerStatuses, setProviderStatuses] =
    useState<OfficialProviderStatusResponse | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [cacheLastUpdated, setCacheLastUpdated] = useState<Date | null>(null)
  const [providerStatusLastUpdated, setProviderStatusLastUpdated] =
    useState<Date | null>(null)
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
      const uptimeResult = await getUptimeStatus()
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

  const fetchCacheStatus = useCallback((mode: FetchMode) => {
    if (mode === 'initial') {
      setCacheLoading(true)
    } else {
      setCacheRefreshing(true)
    }
    setCacheFailed(false)
    return getCacheMetrics()
      .then((response) => {
        if (!response.success) {
          setCacheMetrics(null)
          setCacheFailed(true)
          return
        }
        setCacheMetrics(response)
        setCacheLastUpdated(new Date())
      })
      .catch(() => {
        setCacheMetrics(null)
        setCacheFailed(true)
      })
      .finally(() => {
        setCacheLoaded(true)
        setCacheLoading(false)
        setCacheRefreshing(false)
      })
  }, [])

  const fetchProviderStatus = useCallback((mode: FetchMode) => {
    if (mode === 'initial') {
      setProviderStatusLoading(true)
    } else {
      setProviderStatusRefreshing(true)
    }
    setProviderStatusFailed(false)
    return getOfficialProviderStatuses()
      .then((response) => {
        if (!response.success) {
          setProviderStatuses(null)
          setProviderStatusFailed(true)
          return
        }
        setProviderStatuses(response)
        setProviderStatusLastUpdated(new Date())
      })
      .catch(() => {
        setProviderStatuses(null)
        setProviderStatusFailed(true)
      })
      .finally(() => {
        setProviderStatusLoaded(true)
        setProviderStatusLoading(false)
        setProviderStatusRefreshing(false)
      })
  }, [])

  useEffect(() => {
    void fetchSiteStatus('initial')
  }, [fetchSiteStatus])

  useEffect(() => {
    if (activeTab === 'cache-analytics' && !cacheLoaded && !cacheLoading) {
      void fetchCacheStatus('initial')
    }
    if (
      activeTab === 'official-status' &&
      !providerStatusLoaded &&
      !providerStatusLoading
    ) {
      void fetchProviderStatus('initial')
    }
  }, [
    activeTab,
    cacheLoaded,
    cacheLoading,
    fetchCacheStatus,
    fetchProviderStatus,
    providerStatusLoaded,
    providerStatusLoading,
  ])

  const monitorItems = useMemo(() => {
    const items = groups.flatMap((group, sourceIndex) => {
      const sourceKey = getSourceKey(group, sourceIndex)

      return (group.monitors ?? []).map((monitor) => {
        const stats = getMonitorRequestStats(
          requestStats,
          monitor.name,
          monitor.group
        )
        return {
          key: getMonitorKey(sourceKey, monitor),
          groupKey: getUptimeGroupKey(monitor.group),
          groupLabel: monitor.group?.trim() || t('Ungrouped'),
          monitor,
          requestStats: stats,
        }
      })
    })

    const representedGroups = new Set(
      items.flatMap((item) =>
        [item.monitor.name, item.monitor.group]
          .map((name) => name?.trim())
          .filter((name): name is string => Boolean(name))
          .filter((name) => Boolean(requestStats?.by_group?.[name]))
      )
    )
    for (const [groupName, stats] of Object.entries(
      requestStats?.by_group ?? {}
    )) {
      if (!groupName.trim() || representedGroups.has(groupName)) continue
      const monitor: UptimeMonitor = {
        name: groupName,
        uptime: 0,
        status: -1,
      }
      items.push({
        key: `real-request-${groupName}`,
        groupKey: 'real-request-groups',
        groupLabel: t('Real request statistics'),
        monitor,
        requestStats: stats,
      })
    }

    return items
  }, [groups, requestStats, t])
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

  const summary = useMemo(() => {
    const total = visibleMonitorItems.length
    const statuses = visibleMonitorItems.map((item) =>
      getRealRequestStatus(item.requestStats)
    )
    const operational = statuses.filter((status) => status === 1).length
    const affected = statuses.filter(
      (status) => status === 0 || status === 2
    ).length
    const requestCount = visibleMonitorItems.reduce(
      (sum, item) => sum + (item.requestStats?.['1h']?.request_count ?? 0),
      0
    )
    const successCount = visibleMonitorItems.reduce(
      (sum, item) => sum + (item.requestStats?.['1h']?.success_count ?? 0),
      0
    )
    const average =
      requestCount > 0 ? (successCount / requestCount) * 100 : null

    return {
      total,
      operational,
      affected,
      average,
    }
  }, [visibleMonitorItems])

  const handleManualRefresh = useCallback(() => {
    switch (activeTab) {
      case 'cache-analytics':
        void fetchCacheStatus('refresh')
        break
      case 'official-status':
        void fetchProviderStatus('refresh')
        break
      case 'site-status':
        void fetchSiteStatus('refresh')
        break
    }
  }, [activeTab, fetchCacheStatus, fetchProviderStatus, fetchSiteStatus])

  const handleMonitorSelect = useCallback((monitor: UptimeMonitor) => {
    setSelectedMonitor(monitor)
    setMonitorDetailsOpen(true)
  }, [])

  let activeLoading = loading
  let activeRefreshing = refreshing
  let activeLastUpdated = lastUpdated
  if (activeTab === 'cache-analytics') {
    activeLoading = cacheLoading
    activeRefreshing = cacheRefreshing
    activeLastUpdated = cacheLastUpdated
  } else if (activeTab === 'official-status') {
    activeLoading = providerStatusLoading
    activeRefreshing = providerStatusRefreshing
    activeLastUpdated = providerStatusLastUpdated
  }

  let content = null
  if (loading) {
    content = <LoadingState />
  } else if (failed) {
    content = (
      <EmptyState
        title={t('Failed to load status monitoring data')}
        description={t('Check the configured Uptime Kuma URL and slug.')}
      />
    )
  } else if (monitorItems.length === 0) {
    content = <EmptyState title={t('No data available')} />
  } else {
    content = (
      <div className='space-y-3'>
        <Tabs
          value={activeGroupKey}
          onValueChange={(value) => {
            setActiveGroupKey(value || ALL_GROUP_KEY)
          }}
        >
          <TabsList className='max-w-full [scrollbar-width:none] flex-nowrap justify-start overflow-x-auto group-data-horizontal/tabs:h-auto sm:overflow-visible [&::-webkit-scrollbar]:hidden'>
            <TabsTrigger value={ALL_GROUP_KEY} className='gap-1.5'>
              <span>{t('All')}</span>
              <span className='text-muted-foreground text-xs tabular-nums'>
                {monitorItems.length}
              </span>
            </TabsTrigger>
            {groupOptions.map((group) => (
              <TabsTrigger
                key={group.key}
                value={group.key}
                className='gap-1.5'
              >
                <span className='max-w-32 truncate sm:max-w-48'>
                  {group.label}
                </span>
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {group.monitorItems.length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {visibleMonitorItems.length > 0 ? (
          <div className='grid min-w-0 gap-3 lg:grid-cols-2'>
            {visibleMonitorItems.map((item) => (
              <MonitorRow
                key={item.key}
                monitor={item.monitor}
                requestStats={item.requestStats}
                onSelect={handleMonitorSelect}
              />
            ))}
          </div>
        ) : (
          <div className='text-muted-foreground rounded-lg border border-dashed p-6 text-sm'>
            {t('No uptime data available')}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Status Monitor')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <RefreshControl
            key={activeTab}
            loading={activeLoading}
            refreshing={activeRefreshing}
            lastUpdated={activeLastUpdated}
            onRefresh={handleManualRefresh}
          />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              if (
                value === 'site-status' ||
                value === 'cache-analytics' ||
                value === 'official-status'
              ) {
                setActiveTab(value)
              }
            }}
            className='min-w-0 gap-4'
          >
            <TabsList className='grid w-full max-w-lg grid-cols-3'>
              <TabsTrigger value='site-status'>
                <Activity />
                {t('Site status')}
              </TabsTrigger>
              <TabsTrigger value='cache-analytics'>
                <Database />
                {t('Cache analytics')}
              </TabsTrigger>
              <TabsTrigger value='official-status'>
                <Radio />
                {t('Official status')}
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value='site-status'
              keepMounted
              className='min-w-0 space-y-4'
            >
              <div className='bg-border grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border lg:grid-cols-4'>
                <SummaryMetric
                  label={t('Total monitors')}
                  value={String(summary.total)}
                  icon={Activity}
                />
                <SummaryMetric
                  label={t('Operational')}
                  value={String(summary.operational)}
                  icon={CheckCircle2}
                  tone='success'
                />
                <SummaryMetric
                  label={t('Affected monitors')}
                  value={String(summary.affected)}
                  icon={AlertTriangle}
                  tone={summary.affected > 0 ? 'warning' : 'default'}
                />
                <SummaryMetric
                  label={`${t('1 hour')} · ${t('Success')}`}
                  value={
                    summary.average === null
                      ? '--'
                      : `${summary.average.toFixed(2)}%`
                  }
                  icon={CircleDashed}
                />
              </div>

              {content}
            </TabsContent>

            <TabsContent value='cache-analytics' className='min-w-0'>
              <CacheMonitor
                response={cacheMetrics}
                loading={cacheLoading}
                failed={cacheFailed}
                onRefresh={handleManualRefresh}
              />
            </TabsContent>

            <TabsContent value='official-status' className='min-w-0'>
              <OfficialProviderStatuses
                response={providerStatuses}
                loading={providerStatusLoading}
                failed={providerStatusFailed}
              />
            </TabsContent>
          </Tabs>
        </SectionPageLayout.Content>
      </SectionPageLayout>
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
