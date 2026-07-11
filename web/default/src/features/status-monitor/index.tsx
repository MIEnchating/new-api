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
  CircleDashed,
  Clock3,
  RotateCw,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getUptimeStatus } from '@/features/dashboard/api'
import type {
  UptimeHeartbeat,
  UptimeGroupResult,
  UptimeMonitor,
} from '@/features/dashboard/types'
import { cn } from '@/lib/utils'

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
  return date.toLocaleString()
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
      <div className='mt-2 text-2xl font-semibold tabular-nums'>
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
    <StatusBadge variant={meta.variant} className='min-w-24'>
      <Icon data-icon='inline-start' />
      {t(meta.label)}
    </StatusBadge>
  )
}

function HeartbeatTimeline(props: { heartbeats?: UptimeHeartbeat[] }) {
  const { t } = useTranslation()
  const heartbeats = useMemo(
    () => [...(props.heartbeats ?? [])].reverse().slice(-72),
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
    <div
      className='grid h-12 min-w-0 items-end gap-1'
      style={{
        gridTemplateColumns: `repeat(${heartbeats.length}, minmax(3px, 1fr))`,
      }}
      aria-label={t('Heartbeat timeline')}
    >
      {heartbeats.map((heartbeat) => {
        const meta = getStatusMeta(heartbeat.status)
        const titleParts = [
          t(meta.label),
          formatDateTime(heartbeat.time),
          formatPing(heartbeat.ping),
          heartbeat.msg,
        ].filter(Boolean)

        return (
          <span
            key={`${heartbeat.time ?? 'heartbeat'}-${heartbeat.status}-${heartbeat.ping ?? 'na'}-${heartbeat.msg ?? ''}`}
            title={titleParts.join(' · ')}
            className={cn(
              'block min-h-4 rounded-sm',
              heartbeat.status === 1 ? 'h-12' : 'h-8',
              meta.dotClassName
            )}
          />
        )
      })}
    </div>
  )
}

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

function MonitorRow(props: { monitor: UptimeMonitor }) {
  const { t } = useTranslation()
  const meta = getStatusMeta(props.monitor.status)

  return (
    <article className='bg-background/80 rounded-lg border p-3 sm:p-4'>
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
        <MonitorStatusBadge status={props.monitor.status} />
      </div>

      <div className='mt-4 grid min-w-0 gap-2 sm:grid-cols-2'>
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
  const [groups, setGroups] = useState<UptimeGroupResult[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [refreshCountdown, setRefreshCountdown] = useState(AUTO_REFRESH_SECONDS)
  const [activeGroupKey, setActiveGroupKey] = useState(ALL_GROUP_KEY)

  const fetchStatus = useCallback((mode: 'initial' | 'refresh') => {
    if (mode === 'initial') {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    setFailed(false)
    setRefreshCountdown(AUTO_REFRESH_SECONDS)

    return getUptimeStatus()
      .then((response) => {
        setGroups(response?.data ?? [])
        setLastUpdated(new Date())
      })
      .catch(() => {
        setGroups([])
        setFailed(true)
      })
      .finally(() => {
        setLoading(false)
        setRefreshing(false)
      })
  }, [])

  useEffect(() => {
    fetchStatus('initial')
  }, [fetchStatus])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRefreshCountdown((current) => {
        if (current <= 1) {
          void fetchStatus('refresh')
          return AUTO_REFRESH_SECONDS
        }

        return current - 1
      })
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
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

  const lastUpdatedText = lastUpdated
    ? t('Updated {{time}}', {
        time: lastUpdated.toLocaleTimeString(),
      })
    : ''

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
          <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto sm:group-data-horizontal/tabs:h-auto'>
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
          <div className='grid min-w-0 gap-3 md:grid-cols-2'>
            {visibleMonitorItems.map((item) => (
              <MonitorRow key={item.key} monitor={item.monitor} />
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
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Status Monitor')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <div className='flex min-w-0 items-center gap-2 max-[360px]:w-[calc(100vw-1.5rem)] max-[360px]:justify-between'>
          {lastUpdatedText ? (
            <div className='text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs'>
              <Clock3 className='size-3.5 shrink-0' />
              <span className='truncate whitespace-nowrap'>
                {lastUpdatedText}
              </span>
            </div>
          ) : null}
          <Button
            type='button'
            variant='outline'
            onClick={handleManualRefresh}
            disabled={loading || refreshing}
            className='gap-2'
          >
            <RotateCw className={cn('size-4', refreshing && 'animate-spin')} />
            {t('Refresh')}
            {!loading ? (
              <span className='border-border min-w-8 border-l pl-2 text-right tabular-nums'>
                {refreshCountdown}s
              </span>
            ) : null}
          </Button>
        </div>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex min-w-0 flex-col gap-4'>
          <div className='grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
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
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
