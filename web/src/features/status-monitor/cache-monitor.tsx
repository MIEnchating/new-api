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
import { Activity, DatabaseZap, Timer, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { CacheGroupStats } from './cache-group-stats'
import { formatMonitorPercent, formatMonitorLatency } from './monitor-health'
import type {
  CacheMetricGroup,
  CacheMetricsResponse,
  MonitorHealth,
} from './types'

function MonitorMetric(props: {
  label: string
  value: string
  description: string
  icon: LucideIcon
  status?: MonitorHealth['overall']
}) {
  const { t } = useTranslation()
  const status = props.status ?? 'unknown'
  const Icon = props.icon
  const tone: IconBadgeTone = {
    healthy: 'success' as const,
    warning: 'warning' as const,
    critical: 'destructive' as const,
    unknown: 'neutral' as const,
  }[status]
  const badgeVariant: StatusVariant = tone === 'destructive' ? 'danger' : tone
  const statusLabel = {
    healthy: t('Healthy'),
    warning: t('Warning'),
    critical: t('Critical'),
    unknown: t('No data or insufficient samples'),
  }[status]
  return (
    <Card
      data-card-hover='false'
      role='article'
      aria-label={props.label}
      className='relative min-w-0 gap-2 rounded-xl py-3 shadow-none ring-inset sm:gap-4 sm:py-5'
    >
      <CardHeader className='flex min-w-0 flex-row items-start justify-between gap-2 px-3 sm:items-center sm:px-5'>
        <CardTitle className='text-muted-foreground flex min-h-8 items-start gap-1.5 text-[11px] leading-4 font-medium sm:min-h-0 sm:text-sm'>
          <span
            role='img'
            aria-label={statusLabel}
            className={cn(
              'mt-1 size-1.5 shrink-0 rounded-full sm:hidden',
              status === 'healthy' && 'bg-success',
              status === 'warning' && 'bg-warning',
              status === 'critical' && 'bg-destructive',
              status === 'unknown' && 'bg-muted-foreground/40'
            )}
          />
          {props.label}
        </CardTitle>
        <IconBadge tone={tone} size='sm' className='hidden sm:flex'>
          <Icon />
        </IconBadge>
      </CardHeader>
      <CardContent className='flex min-w-0 flex-col gap-2 px-3 sm:gap-3 sm:px-5'>
        <p
          className={cn(
            'text-xl leading-none font-semibold tracking-tight tabular-nums sm:text-3xl',
            status === 'healthy' && 'text-success',
            status === 'warning' && 'text-warning',
            status === 'critical' && 'text-destructive',
            status === 'unknown' && 'text-muted-foreground'
          )}
        >
          {props.value}
        </p>
        <div className='flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1'>
          <p className='text-muted-foreground sr-only text-[10px] leading-4 sm:not-sr-only sm:text-xs'>
            {props.description}
          </p>
          <StatusBadge
            label={statusLabel}
            variant={badgeVariant}
            type='text'
            copyable={false}
            showDot
            className='hidden text-xs sm:inline-flex'
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function CacheMonitor(props: {
  response: CacheMetricsResponse | null
  loading: boolean
  failed: boolean
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const groups = useMemo(() => {
    const groupMap = new Map(
      (props.response?.data.groups ?? []).map((group) => [group.group, group])
    )
    return (props.response?.data.display_groups ?? []).map(
      (name): CacheMetricGroup =>
        groupMap.get(name) ?? {
          group: name,
          cached_tokens: 0,
          cache_hit_rate: 0,
          avg_tps: 0,
          has_data: false,
          series: [],
        }
    )
  }, [props.response])
  const summary = props.response?.data.summary
  const errorRate = summary?.health.error_rate_percent
  if (props.loading) {
    return (
      <section
        className='flex h-full min-h-0 flex-col gap-5 overflow-hidden'
        aria-busy='true'
      >
        <div className='grid shrink-0 grid-cols-3 gap-2 sm:gap-4'>
          {['success', 'ttft', 'cache'].map((key) => (
            <Skeleton key={key} className='h-24 rounded-xl sm:h-40' />
          ))}
        </div>
        <Skeleton className='min-h-0 flex-1 rounded-2xl' />
      </section>
    )
  }
  if (props.failed && props.response == null) {
    return (
      <ErrorState
        title={t('Cache monitoring unavailable')}
        onRetry={props.onRefresh}
      />
    )
  }
  if (groups.length === 0) return <EmptyState title={t('No data')} />
  return (
    <section className='flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden py-1 sm:gap-4 [@media(max-height:700px)]:overflow-y-auto'>
      {props.failed ? (
        <Alert className='shrink-0' variant='destructive'>
          <AlertDescription>
            {t('Refresh failed. Showing the last available data.')}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className='grid shrink-0 grid-cols-3 gap-2 sm:gap-4'>
        <MonitorMetric
          icon={Activity}
          label={t('Success rate')}
          value={formatMonitorPercent(
            errorRate == null ? null : 100 - errorRate
          )}
          description={`${t('Error rate')} ${formatMonitorPercent(errorRate)}`}
          status={summary?.health.error_rate}
        />
        <MonitorMetric
          icon={Timer}
          label={t('Average TTFT')}
          value={formatMonitorLatency(summary?.health.avg_ttft_ms)}
          description={t('Time to first token')}
          status={summary?.health.ttft}
        />
        <MonitorMetric
          icon={DatabaseZap}
          label={t('Cache rate')}
          value={formatMonitorPercent(
            summary?.has_data ? summary.cache_hit_rate : null
          )}
          description={t('Cache read share')}
          status={summary?.health.cache}
        />
      </div>
      <CacheGroupStats
        groups={groups}
        summarySeries={summary?.series}
        countsVisible={props.response?.data.counts_visible ?? false}
        bucketSeconds={props.response?.data.bucket_seconds ?? 3600}
        rangeStart={props.response?.data.start_ts}
        rangeEnd={props.response?.data.end_ts}
      />
    </section>
  )
}
