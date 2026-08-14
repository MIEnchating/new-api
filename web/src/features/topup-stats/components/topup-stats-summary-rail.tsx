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
import { Button } from '@/components/ui/button'
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
        accent='bg-emerald-500/70'
        loading={props.loading}
      />
      <TypeQuotaBadge
        label={t('Redemption Code')}
        value={props.typeQuotas.redemption}
        accent='bg-sky-500/70'
        loading={props.loading}
      />
      <TypeQuotaBadge
        label={t('Admin Adjustment')}
        value={props.typeQuotas.admin_adjustment}
        accent='bg-amber-500/70'
        loading={props.loading}
      />
      <TypeQuotaBadge
        label={t('Lottery amount')}
        value={props.lotteryQuota}
        accent='bg-pink-500/70'
        loading={props.loading}
      />
      <TypeQuotaBadge
        label={t('Total Quota')}
        value={props.totalQuota}
        accent='bg-foreground/60'
        loading={props.loading}
      />
    </div>
  )
}

type TopUpStatsSummaryDialogProps = TopUpStatsSummaryRailProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
  dailyStats: TopUpStatsDailyStat[]
  dailyStatsLoading: boolean
  statisticsRange: { start: Date; end: Date }
  onStatisticsRangeChange: (range: { start?: Date; end?: Date }) => void
}

export function TopUpStatsSummaryDialog(props: TopUpStatsSummaryDialogProps) {
  const { t } = useTranslation()
  const chartConfig = useMemo<ChartConfig>(
    () => ({
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
        color: 'var(--foreground)',
      },
    }),
    [t]
  )
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Top-up Stats')}
      showCloseButton
      contentClassName='sm:max-w-2xl'
      footer={
        <Button
          type='button'
          variant='outline'
          onClick={() => props.onOpenChange(false)}
        >
          {t('Close')}
        </Button>
      }
    >
      <div className='space-y-5' data-statistics-chart>
        <div className='flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between'>
          <div className='space-y-1'>
            <div className='text-muted-foreground text-xs'>
              {t('Quota trend')}
            </div>
            <p className='text-sm font-medium'>{t('Daily quota changes')}</p>
          </div>
          <CompactDateTimeRangePicker
            start={props.statisticsRange.start}
            end={props.statisticsRange.end}
            onChange={props.onStatisticsRangeChange}
            className='w-full sm:w-[21rem]'
          />
        </div>

        {props.dailyStatsLoading ? (
          <Skeleton className='h-60 w-full' />
        ) : (
          <ChartContainer
            config={chartConfig}
            className='aspect-auto h-60 w-full [&_.recharts-surface]:outline-none! [&_.recharts-wrapper]:outline-none!'
          >
            <LineChart
              accessibilityLayer={false}
              data={props.dailyStats}
              margin={{ top: 8, right: 18, bottom: 4, left: 8 }}
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
                width={74}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatQuota(Number(value))}
              />
              <ReferenceLine y={0} stroke='var(--border)' />
              <ChartTooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.45 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => String(value)}
                    formatter={(value, name) => (
                      <div className='flex min-w-36 items-center justify-between gap-4'>
                        <span className='text-muted-foreground'>
                          {chartConfig[String(name)]?.label ?? String(name)}
                        </span>
                        <span className='font-mono font-semibold tabular-nums'>
                          {formatQuota(Number(value))}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <ChartLegend
                verticalAlign='top'
                align='right'
                content={<ChartLegendContent />}
              />
              <Line
                dataKey='online_topup'
                name={t('Online payment')}
                stroke='var(--color-online_topup)'
                strokeWidth={2}
                type='monotone'
                dot={false}
              />
              <Line
                dataKey='redemption'
                name={t('Redemption Code')}
                stroke='var(--color-redemption)'
                strokeWidth={2}
                type='monotone'
                dot={false}
              />
              <Line
                dataKey='admin_adjustment'
                name={t('Admin Adjustment')}
                stroke='var(--color-admin_adjustment)'
                strokeWidth={2}
                type='monotone'
                dot={false}
              />
              <Line
                dataKey='lottery'
                name={t('Lottery amount')}
                stroke='var(--color-lottery)'
                strokeWidth={2}
                type='monotone'
                dot={false}
              />
              <Line
                dataKey='total'
                name={t('Total Quota')}
                stroke='var(--color-total)'
                strokeWidth={2.5}
                strokeDasharray='5 4'
                type='monotone'
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        )}
      </div>
    </Dialog>
  )
}

function TypeQuotaBadge(props: {
  label: string
  value: number
  accent: string
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
        <span className='text-foreground/85 font-mono font-semibold tabular-nums'>
          {formatQuota(props.value)}
        </span>
      )}
    </span>
  )
}
