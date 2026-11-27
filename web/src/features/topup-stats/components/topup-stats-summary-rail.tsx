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
import { ChartLine } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'

import { CompactDateTimeRangePicker } from '@/components/compact-date-time-range-picker'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQuota } from '@/lib/format'

import type { TopUpStatsDailyStat, TopUpStatsItem } from '../types'

type TopUpStatsSummaryRailProps = {
  typeQuotas: Record<TopUpStatsItem['type'], number>
  lotteryQuota: number
  totalQuota: number
  loading: boolean
}

export function TopUpStatsSummaryRail(props: TopUpStatsSummaryRailProps) {
  const { t } = useTranslation()

  return (
    <div
      data-mobile-summary-rail
      className='no-scrollbar -mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-0.5 sm:mx-0 sm:flex-1 sm:flex-wrap sm:items-center sm:overflow-visible sm:px-0 sm:pb-0'
    >
      <TypeQuotaBadge
        label={t('Online payment')}
        value={props.typeQuotas.online_topup}
        accent='bg-success'
        tone='text-success'
        loading={props.loading}
      />
      <TypeQuotaBadge
        label={t('Redemption Code')}
        value={props.typeQuotas.redemption}
        accent='bg-chart-2'
        tone='text-chart-2'
        loading={props.loading}
      />
      <TypeQuotaBadge
        label={t('Admin Adjustment')}
        value={props.typeQuotas.admin_adjustment}
        accent='bg-warning'
        tone='text-warning'
        loading={props.loading}
      />
      <TypeQuotaBadge
        label={t('Lottery amount')}
        value={props.lotteryQuota}
        accent='bg-chart-5'
        tone='text-chart-5'
        loading={props.loading}
      />
      <TypeQuotaBadge
        label={t('Total Quota')}
        value={props.totalQuota}
        accent='bg-primary'
        tone='text-primary'
        loading={props.loading}
      />
    </div>
  )
}

type TopUpStatsSummaryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  dailyStats: TopUpStatsDailyStat[]
  dailyStatsLoading: boolean
  dailyStatsError: boolean
  onRetry: () => void
  statisticsRange: { start: Date; end: Date }
  onStatisticsRangeChange: (range: { start?: Date; end?: Date }) => void
}

export function TopUpStatsSummaryDialog(props: TopUpStatsSummaryDialogProps) {
  const { t } = useTranslation()
  const chartHeadingId = useId()
  const chartHeight = 'h-64 sm:h-80'
  const chartConfig = {
    online_topup: {
      label: t('Online payment'),
      color: 'var(--success)',
    },
    redemption: {
      label: t('Redemption Code'),
      color: 'var(--chart-2)',
    },
    admin_adjustment: {
      label: t('Admin Adjustment'),
      color: 'var(--warning)',
    },
    lottery: {
      label: t('Lottery amount'),
      color: 'var(--chart-5)',
    },
    total: {
      label: t('Total Quota'),
      color: 'var(--primary)',
    },
  } satisfies ChartConfig

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <>
          <ChartLine
            aria-hidden='true'
            className='text-primary size-5 shrink-0'
          />
          {t('Top-up Stats')}
        </>
      }
      contentClassName='gap-3 overflow-hidden sm:max-w-4xl'
      headerClassName='border-b pb-3 pe-8 sm:pb-4'
      titleClassName='flex min-w-0 items-center gap-2.5 text-lg leading-snug font-semibold'
    >
      <section aria-labelledby={chartHeadingId} className='min-w-0 space-y-3'>
        <div className='flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between'>
          <h3 id={chartHeadingId} className='text-sm font-semibold'>
            {t('Daily quota changes')}
          </h3>
          <CompactDateTimeRangePicker
            start={props.statisticsRange.start}
            end={props.statisticsRange.end}
            onChange={props.onStatisticsRangeChange}
            className='bg-background h-auto min-h-9 min-w-0 py-1.5 sm:w-auto sm:max-w-full [&>span]:text-start [&>span]:whitespace-normal'
          />
        </div>

        <div className='border-border/70 rounded-lg border px-1.5 pt-2 pb-1 sm:px-4 sm:pt-3 sm:pb-2'>
          {props.dailyStatsLoading ? (
            <div role='status' className={chartHeight}>
              <span className='sr-only'>{t('Loading...')}</span>
              <Skeleton className='h-full w-full motion-reduce:animate-none' />
            </div>
          ) : props.dailyStatsError ? (
            <ErrorState
              className={`${chartHeight} min-h-0`}
              title={t('Failed to load top-up stats')}
              onRetry={props.onRetry}
            />
          ) : props.dailyStats.length === 0 ? (
            <EmptyState
              className={`${chartHeight} min-h-0`}
              icon={ChartLine}
              title={t('No data available')}
            />
          ) : (
            <ChartContainer
              config={chartConfig}
              className={`${chartHeight} aspect-auto w-full`}
            >
              <LineChart
                data={props.dailyStats}
                margin={{ top: 8, right: 10, bottom: 4, left: 0 }}
              >
                <CartesianGrid vertical={false} strokeDasharray='3 3' />
                <XAxis
                  dataKey='date'
                  tickLine={false}
                  axisLine={false}
                  minTickGap={22}
                  tickFormatter={(value) => String(value).slice(5)}
                />
                <YAxis
                  width='auto'
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                  tickFormatter={(value) => formatQuota(Number(value))}
                />
                <ReferenceLine y={0} stroke='var(--border)' />
                <ChartTooltip
                  cursor={{
                    stroke: 'var(--muted-foreground)',
                    strokeOpacity: 0.35,
                  }}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => String(value)}
                      formatter={(value, name, item) => (
                        <div className='flex w-full items-center gap-2'>
                          <span
                            aria-hidden='true'
                            className='size-2 shrink-0 rounded-sm'
                            style={{ backgroundColor: item.color }}
                          />
                          <span className='text-muted-foreground min-w-0 flex-1'>
                            {name}
                          </span>
                          <span className='ms-2 font-semibold tabular-nums'>
                            {formatQuota(Number(value))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <ChartLegend
                  verticalAlign='bottom'
                  content={
                    <ChartLegendContent className='flex-wrap gap-x-4 gap-y-1.5' />
                  }
                />
                {Object.entries(chartConfig).map(([key, series]) => (
                  <Line
                    key={key}
                    dataKey={key}
                    name={series.label}
                    stroke={`var(--color-${key})`}
                    strokeWidth={key === 'total' ? 2.5 : 2}
                    strokeDasharray={key === 'total' ? '5 4' : undefined}
                    type='monotone'
                    dot={props.dailyStats.length === 1 ? { r: 3 } : false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          )}
        </div>
      </section>
    </Dialog>
  )
}

function TypeQuotaBadge(props: {
  label: string
  value: number
  accent: string
  tone: string
  loading: boolean
}) {
  return (
    <span
      data-summary-item
      className='border-border/60 bg-muted/25 inline-flex h-8 min-w-[8.5rem] shrink-0 items-center gap-2 rounded-md border px-2.5 text-xs shadow-xs sm:h-9 sm:min-w-0 sm:shrink'
    >
      <span className={`h-4 w-0.5 shrink-0 rounded-full ${props.accent}`} />
      <span className='text-muted-foreground min-w-0 flex-1 truncate'>
        {props.label}
      </span>
      {props.loading ? (
        <Skeleton className='h-3.5 w-7' />
      ) : (
        <span
          data-summary-value
          className={`font-mono font-semibold tabular-nums ${props.tone}`}
        >
          {formatQuota(props.value)}
        </span>
      )}
    </span>
  )
}
