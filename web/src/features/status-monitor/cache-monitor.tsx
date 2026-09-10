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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
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
  status?: MonitorHealth['overall']
}) {
  const { t } = useTranslation()
  const status = props.status ?? 'unknown'
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
      className='min-w-0 gap-2 rounded-xl py-3 shadow-none ring-inset sm:rounded-2xl sm:py-5'
    >
      <CardHeader className='relative px-3 pl-6 sm:pl-10'>
        <span
          aria-label={statusLabel}
          role='img'
          className={cn(
            'absolute left-3 top-0.5 size-1.5 sm:left-4 sm:size-2 rounded-full',
            status === 'healthy' && 'bg-success',
            status === 'warning' && 'bg-warning',
            status === 'critical' && 'bg-destructive',
            status === 'unknown' && 'bg-muted-foreground/40'
          )}
        />
        <CardTitle className='text-muted-foreground min-h-7 text-[10px] font-semibold sm:min-h-0 sm:text-[11px]'>
          {props.label}
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-1 px-3 sm:pl-10'>
        <p
          className={cn(
            'text-lg font-semibold tracking-tight tabular-nums sm:text-2xl',
            status === 'healthy' && 'text-success',
            status === 'warning' && 'text-warning',
            status === 'critical' && 'text-destructive',
            status === 'unknown' && 'text-muted-foreground'
          )}
        >
          {props.value}
        </p>
        <p className='text-muted-foreground min-h-7 text-[10px] sm:min-h-0 sm:text-[11px]'>
          {props.description}
        </p>
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
        <div className='grid shrink-0 grid-cols-3 gap-2 sm:gap-3 xl:max-w-[1200px]'>
          {['success', 'ttft', 'cache'].map((key) => (
            <Skeleton key={key} className='h-28 rounded-2xl' />
          ))}
        </div>
        <Skeleton className='min-h-0 flex-1 rounded-2xl' />
      </section>
    )
  }
  if (props.failed) {
    return (
      <ErrorState
        title={t('Cache monitoring unavailable')}
        onRetry={props.onRefresh}
      />
    )
  }
  if (groups.length === 0) return <EmptyState title={t('No data')} />
  return (
    <section className='flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden py-1 sm:gap-5'>
      <div className='grid shrink-0 grid-cols-3 gap-2 sm:gap-3 xl:max-w-[1200px]'>
        <MonitorMetric
          label={t('Success rate')}
          value={formatMonitorPercent(
            errorRate == null ? null : 100 - errorRate
          )}
          description={`${t('Error rate')} ${formatMonitorPercent(errorRate)}`}
          status={summary?.health.error_rate}
        />
        <MonitorMetric
          label={t('Average TTFT')}
          value={formatMonitorLatency(summary?.health.avg_ttft_ms)}
          description={t('Time to first token')}
          status={summary?.health.ttft}
        />
        <MonitorMetric
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
