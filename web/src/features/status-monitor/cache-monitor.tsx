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
import { Alert, AlertDescription } from '@/components/ui/alert'
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
      className='min-w-0 gap-1.5 rounded-xl py-3 shadow-none ring-inset sm:gap-2 sm:py-4'
    >
      <CardHeader className='relative px-2.5 pl-5 sm:pl-8'>
        <span
          aria-label={statusLabel}
          role='img'
          className={cn(
            'absolute left-2.5 top-1 size-1.5 rounded-full sm:left-4',
            status === 'healthy' && 'bg-success',
            status === 'warning' && 'bg-warning',
            status === 'critical' && 'bg-destructive',
            status === 'unknown' && 'bg-muted-foreground/40'
          )}
        />
        <CardTitle className='text-muted-foreground min-h-8 text-[11px] leading-4 font-medium min-[360px]:min-h-0 sm:text-xs'>
          {props.label}
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-1 px-2.5 sm:pl-8'>
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
        <p className='text-muted-foreground sr-only text-[10px] leading-4 sm:not-sr-only sm:text-xs'>
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
        <div className='grid shrink-0 grid-cols-3 gap-2 sm:gap-3'>
          {['success', 'ttft', 'cache'].map((key) => (
            <Skeleton key={key} className='h-24 rounded-xl' />
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
    <section className='flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden py-1 max-[359px]:gap-2'>
      {props.failed ? (
        <Alert className='shrink-0' variant='destructive'>
          <AlertDescription>
            {t('Refresh failed. Showing the last available data.')}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className='grid shrink-0 grid-cols-3 gap-2 sm:gap-3'>
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
