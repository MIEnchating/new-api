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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getUptimeStatus } from '@/features/dashboard/api'
import type {
  UptimeHeartbeat,
  UptimeGroupResult,
  UptimeMonitor,
} from '@/features/dashboard/types'
import { cn } from '@/lib/utils'

import { getCacheMetrics, getOfficialProviderStatuses } from './api'
import { CacheMonitor } from './cache-monitor'
import {
  getOrderedHeartbeats,
  MonitorDetailsDrawer,
} from './monitor-details-drawer'
import { OfficialProviderStatuses } from './official-provider-status'
import type {
  CacheMetricsResponse,
  OfficialProviderStatusResponse,
} from './types'

type MonitorStatusMeta = {
  label: string
  icon: LucideIcon
  dotClassName: string
  variant: StatusVariant
}

const STATUS_META: Record<number, MonitorStatusMeta> = {
  1: {
    label: 'Operational',
    icon: CheckCircle2,
    dotClassName: 'bg-success',
    variant: 'success',
  },
  0: {
    label: 'Down',
    icon: AlertTriangle,
    dotClassName: 'bg-destructive',
    variant: 'danger',
  },
  2: {
    label: 'Pending',
    icon: CircleDashed,
    dotClassName: 'bg-warning',
    variant: 'warning',
  },
  3: {
    label: 'Maintenance',
    icon: Wrench,
    dotClassName: 'bg-info',
    variant: 'info',
  },
}

const UNKNOWN_STATUS_META: MonitorStatusMeta = {
  label: 'Unknown',
  icon: CircleDashed,
  dotClassName: 'bg-muted-foreground/40',
  variant: 'neutral',
}

const AUTO_REFRESH_SECONDS = 60
const ALL_GROUP_KEY = 'all'

function getStatusMeta(status: number) {
  return STATUS_META[status] ?? UNKNOWN_STATUS_META
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

function formatPing(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${Math.round(value)} ms`
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

function flattenMonitors(groups: UptimeGroupResult[]) {
  return groups.flatMap((group) => group.monitors ?? [])
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
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS)

  useEffect(() => {
    if (props.loading || props.refreshing) {
      setCountdown(AUTO_REFRESH_SECONDS)
      return
    }

    const timer = window.setInterval(() => {
      setCountdown((current) => Math.max(current - 1, 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [props.loading, props.refreshing])

  useEffect(() => {
    if (countdown !== 0 || props.loading || props.refreshing) return

    setCountdown(AUTO_REFRESH_SECONDS)
    props.onRefresh()
  }, [countdown, props.loading, props.onRefresh, props.refreshing])

  const lastUpdatedText = props.lastUpdated
    ? t('Updated {{time}}', {
        time: props.lastUpdated.toLocaleTimeString(undefined, {
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
          props.onRefresh()
        }}
        disabled={props.loading || props.refreshing}
        className='gap-2'
      >
        <RotateCw
          className={cn('size-4', props.refreshing && 'animate-spin')}
        />
        {t('Refresh')}
        {!props.loading ? (
          <span className='border-border min-w-8 border-l pl-2 text-right tabular-nums'>
            {countdown}s
          </span>
        ) : null}
      </Button>
    </div>
  )
}

function SummaryTile(props: {
  label: string
  value: string
  icon: LucideIcon
  tone?: 'default' | 'success' | 'warning'
}) {
  const Icon = props.icon
  return (
    <div className='rounded-lg border p-3 sm:p-4'>
      <div className='flex items-center justify-between gap-3'>
        <span className='text-muted-foreground text-sm'>{props.label}</span>
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
      </div>
      <div className='mt-2 text-xl font-semibold tabular-nums sm:text-2xl'>
        {props.value}
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

const HeartbeatTimeline = memo(function HeartbeatTimeline(props: {
  heartbeats?: UptimeHeartbeat[]
}) {
  const { t } = useTranslation()
  const [activeHeartbeatIndex, setActiveHeartbeatIndex] = useState<
    number | null
  >(null)
  const hoverTimerRef = useRef<number | null>(null)
  const pendingHeartbeatIndexRef = useRef<number | null>(null)
  const heartbeats = useMemo(
    () => getOrderedHeartbeats(props.heartbeats).slice(-48),
    [props.heartbeats]
  )
  const activeHeartbeat =
    activeHeartbeatIndex === null
      ? null
      : (heartbeats[activeHeartbeatIndex] ?? null)
  const activeHeartbeatLeft =
    activeHeartbeatIndex === null
      ? 50
      : Math.min(
          90,
          Math.max(10, ((activeHeartbeatIndex + 0.5) / heartbeats.length) * 100)
        )

  useEffect(
    () => () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current)
      }
    },
    []
  )

  const cancelScheduledHeartbeat = () => {
    if (hoverTimerRef.current === null) return
    window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
    pendingHeartbeatIndexRef.current = null
  }

  const showHeartbeat = (index: number, delayed: boolean) => {
    if (
      index === activeHeartbeatIndex ||
      index === pendingHeartbeatIndexRef.current
    ) {
      return
    }
    cancelScheduledHeartbeat()
    if (!delayed) {
      setActiveHeartbeatIndex(index)
      return
    }
    pendingHeartbeatIndexRef.current = index
    hoverTimerRef.current = window.setTimeout(() => {
      setActiveHeartbeatIndex(index)
      hoverTimerRef.current = null
      pendingHeartbeatIndexRef.current = null
    }, 80)
  }

  if (heartbeats.length === 0) {
    return (
      <div className='bg-muted/30 text-muted-foreground flex h-12 items-center justify-center rounded-md border border-dashed text-xs'>
        {t('No heartbeat data')}
      </div>
    )
  }

  return (
    <>
      <div className='relative'>
        {activeHeartbeat ? (
          <div
            role='tooltip'
            className='bg-foreground text-background pointer-events-none absolute bottom-[calc(100%+4px)] z-20 flex w-max max-w-xs -translate-x-1/2 flex-col items-start gap-0.5 rounded-md px-3 py-1.5 text-xs shadow-md'
            style={{
              left: `${activeHeartbeatLeft}%`,
            }}
          >
            <span className='font-medium'>
              {formatPing(activeHeartbeat.ping)}
            </span>
            <span className='opacity-75'>
              {formatDateTime(activeHeartbeat.time)}
            </span>
            {activeHeartbeat.msg ? <span>{activeHeartbeat.msg}</span> : null}
          </div>
        ) : null}
        <div
          className='grid h-10 min-w-0 items-end gap-px sm:h-12 sm:gap-1'
          style={{
            gridTemplateColumns: `repeat(${heartbeats.length}, minmax(4px, 1fr))`,
          }}
          aria-label={t('Heartbeat timeline')}
          onClick={(event) => event.stopPropagation()}
          onPointerMove={(event) => {
            const target = (event.target as HTMLElement).closest<HTMLElement>(
              '[data-heartbeat-index]'
            )
            if (!target) return
            const index = Number(target.dataset.heartbeatIndex)
            if (index === activeHeartbeatIndex) return
            showHeartbeat(index, true)
          }}
          onPointerLeave={() => {
            cancelScheduledHeartbeat()
            setActiveHeartbeatIndex(null)
          }}
          onFocus={(event) => {
            const target = (event.target as HTMLElement).closest<HTMLElement>(
              '[data-heartbeat-index]'
            )
            if (target)
              showHeartbeat(Number(target.dataset.heartbeatIndex), false)
          }}
          onBlur={() => setActiveHeartbeatIndex(null)}
        >
          {heartbeats.map((heartbeat, index) => {
            const meta = getStatusMeta(heartbeat.status)
            const label = [
              t(meta.label),
              formatDateTime(heartbeat.time),
              formatPing(heartbeat.ping),
            ].join(' · ')

            return (
              <span
                key={`${heartbeat.time ?? 'heartbeat'}-${heartbeat.status}-${heartbeat.ping ?? 'na'}-${heartbeat.msg ?? ''}`}
                data-heartbeat-index={index}
                tabIndex={0}
                aria-label={label}
                className={cn(
                  'block min-h-3 cursor-default rounded-[2px] outline-none focus-visible:ring-2',
                  heartbeat.status === 1 ? 'h-10 sm:h-12' : 'h-7 sm:h-8',
                  meta.dotClassName
                )}
              />
            )
          })}
        </div>
      </div>
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
    <div className='min-w-0 rounded-md border px-3 py-2'>
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
    <article
      role='button'
      tabIndex={0}
      onClick={() => props.onSelect(props.monitor)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onSelect(props.monitor)
        }
      }}
      className='bg-background/80 hover:bg-muted/20 focus-visible:ring-ring cursor-pointer rounded-lg border p-3 transition-colors outline-none focus-visible:ring-2 sm:p-4'
    >
      <div className='flex min-w-0 flex-wrap items-start justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-3'>
          <span
            className={cn('size-2.5 shrink-0 rounded-full', meta.dotClassName)}
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

      <div className='mt-3 grid min-w-0 grid-cols-2 gap-2 sm:mt-4'>
        <MetricItem
          label={t('24-hour uptime')}
          value={formatUptime(props.monitor.uptime24 ?? props.monitor.uptime)}
        />
        <MetricItem
          label={t('7-day uptime')}
          value={formatOptionalUptime(
            props.monitor.uptime7 ??
              props.monitor.uptime24 ??
              props.monitor.uptime
          )}
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

      <div className='mt-4'>
        <HeartbeatTimeline heartbeats={props.monitor.heartbeats} />
      </div>
    </article>
  )
})

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
  const [groups, setGroups] = useState<UptimeGroupResult[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [cacheFailed, setCacheFailed] = useState(false)
  const [providerStatusFailed, setProviderStatusFailed] = useState(false)
  const [cacheMetrics, setCacheMetrics] = useState<CacheMetricsResponse | null>(
    null
  )
  const [providerStatuses, setProviderStatuses] =
    useState<OfficialProviderStatusResponse | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [activeGroupKey, setActiveGroupKey] = useState(ALL_GROUP_KEY)
  const [selectedMonitor, setSelectedMonitor] = useState<UptimeMonitor | null>(
    null
  )

  const fetchStatus = useCallback((mode: 'initial' | 'refresh') => {
    if (mode === 'initial') {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setFailed(false)
    setCacheFailed(false)
    setProviderStatusFailed(false)
    return Promise.allSettled([
      getUptimeStatus(),
      getCacheMetrics(),
      getOfficialProviderStatuses(),
    ])
      .then(([uptimeResult, cacheResult, providerStatusResult]) => {
        if (uptimeResult.status === 'fulfilled') {
          setGroups(uptimeResult.value?.data ?? [])
        } else {
          setGroups([])
          setFailed(true)
        }

        if (cacheResult.status === 'fulfilled' && cacheResult.value.success) {
          setCacheMetrics(cacheResult.value)
        } else {
          setCacheMetrics(null)
          setCacheFailed(true)
        }

        if (
          providerStatusResult.status === 'fulfilled' &&
          providerStatusResult.value.success
        ) {
          setProviderStatuses(providerStatusResult.value)
        } else {
          setProviderStatuses(null)
          setProviderStatusFailed(true)
        }
        setLastUpdated(new Date())
      })
      .finally(() => {
        setLoading(false)
        setRefreshing(false)
      })
  }, [])

  useEffect(() => {
    fetchStatus('initial')
  }, [fetchStatus])

  const monitors = useMemo(() => flattenMonitors(groups), [groups])
  const monitorItems = useMemo(
    () =>
      groups.flatMap((group, sourceIndex) => {
        const sourceKey = getSourceKey(group, sourceIndex)

        return (group.monitors ?? []).map((monitor) => ({
          key: getMonitorKey(sourceKey, monitor),
          groupKey: getUptimeGroupKey(monitor.group),
          monitor,
        }))
      }),
    [groups]
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
      const label = item.monitor.group?.trim() || t('Ungrouped')
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
  }, [monitorItems, t])
  const groupOptionMap = useMemo(
    () => new Map(groupOptions.map((group) => [group.key, group])),
    [groupOptions]
  )
  const visibleMonitorItems = useMemo(() => {
    if (activeGroupKey === ALL_GROUP_KEY) return monitorItems

    return groupOptionMap.get(activeGroupKey)?.monitorItems ?? []
  }, [activeGroupKey, groupOptionMap, monitorItems])
  const visibleMonitors = useMemo(
    () => visibleMonitorItems.map((item) => item.monitor),
    [visibleMonitorItems]
  )

  useEffect(() => {
    if (
      activeGroupKey !== ALL_GROUP_KEY &&
      !groupOptions.some((group) => group.key === activeGroupKey)
    ) {
      setActiveGroupKey(ALL_GROUP_KEY)
    }
  }, [activeGroupKey, groupOptions])

  const summary = useMemo(() => {
    const total = visibleMonitors.length
    const operational = visibleMonitors.filter(
      (monitor) => monitor.status === 1
    ).length
    const affected = total - operational
    const average =
      total === 0
        ? 0
        : visibleMonitors.reduce(
            (sum, monitor) => sum + (monitor.uptime ?? 0),
            0
          ) / total

    return {
      total,
      operational,
      affected,
      average,
    }
  }, [visibleMonitors])

  const handleManualRefresh = useCallback(() => {
    fetchStatus('refresh')
  }, [fetchStatus])

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
  } else if (!groups.length || monitors.length === 0) {
    content = <EmptyState title={t('No uptime monitoring configured')} />
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
                {monitors.length}
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

        {visibleMonitors.length > 0 ? (
          <div className='grid min-w-0 gap-3 lg:grid-cols-2'>
            {visibleMonitorItems.map((item) => (
              <MonitorRow
                key={item.key}
                monitor={item.monitor}
                onSelect={setSelectedMonitor}
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
            loading={loading}
            refreshing={refreshing}
            lastUpdated={lastUpdated}
            onRefresh={handleManualRefresh}
          />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <Tabs defaultValue='site-status' className='min-w-0 gap-4'>
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
              <div className='grid min-w-0 grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4'>
                <SummaryTile
                  label={t('Total monitors')}
                  value={String(summary.total)}
                  icon={Activity}
                />
                <SummaryTile
                  label={t('Operational')}
                  value={String(summary.operational)}
                  icon={CheckCircle2}
                  tone='success'
                />
                <SummaryTile
                  label={t('Affected monitors')}
                  value={String(summary.affected)}
                  icon={AlertTriangle}
                  tone={summary.affected > 0 ? 'warning' : 'default'}
                />
                <SummaryTile
                  label={t('Average uptime')}
                  value={formatUptime(summary.average)}
                  icon={CircleDashed}
                />
              </div>

              {content}
            </TabsContent>

            <TabsContent value='cache-analytics' className='min-w-0'>
              <CacheMonitor
                response={cacheMetrics}
                loading={loading}
                failed={cacheFailed}
                onRefresh={handleManualRefresh}
              />
            </TabsContent>

            <TabsContent value='official-status' className='min-w-0'>
              <OfficialProviderStatuses
                response={providerStatuses}
                loading={loading}
                failed={providerStatusFailed}
              />
            </TabsContent>
          </Tabs>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <MonitorDetailsDrawer
        monitor={selectedMonitor}
        onOpenChange={(open) => {
          if (!open) setSelectedMonitor(null)
        }}
      />
    </>
  )
}
