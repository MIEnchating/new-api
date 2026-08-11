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
import { X } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts'

import { sideDrawerContentClassName } from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type {
  RecentRequestStats,
  UptimeHeartbeat,
  UptimeMonitor,
} from '@/features/dashboard/types'
import { useMediaQuery } from '@/hooks'

import { getOrderedHeartbeats } from './monitor-utils'

type MonitorDetailsDrawerProps = {
  open: boolean
  monitor: UptimeMonitor | null
  requestStats: RecentRequestStats | null
  onOpenChange: (open: boolean) => void
}

type MonitorChartPoint = {
  time: string
  fullTime: string
  latency: number | null
}

function formatChartTime(
  value: string | undefined,
  options?: Intl.DateTimeFormatOptions
) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    ...options,
    hourCycle: 'h23',
  })
}

function buildChartData(heartbeats: UptimeHeartbeat[]): MonitorChartPoint[] {
  return heartbeats.map((heartbeat) => ({
    time: formatChartTime(heartbeat.time, {
      hour: '2-digit',
      minute: '2-digit',
    }),
    fullTime: formatChartTime(heartbeat.time),
    latency:
      typeof heartbeat.ping === 'number' && Number.isFinite(heartbeat.ping)
        ? heartbeat.ping
        : null,
  }))
}

function RealRequestChart(props: { stats: RecentRequestStats | null }) {
  const { t } = useTranslation()
  const data = [
    { window: t('5 minutes'), stats: props.stats?.['5m'] },
    { window: t('30 minutes'), stats: props.stats?.['30m'] },
    { window: t('1 hour'), stats: props.stats?.['1h'] },
  ].map(({ window, stats }) => ({
    window,
    successRate: stats?.has_data ? stats.success_rate : 0,
    failureRate: stats?.has_data ? Math.max(0, 100 - stats.success_rate) : 0,
    hasData: stats?.has_data ?? false,
  }))
  const hasData = data.some((item) => item.hasData)
  const config = {
    successRate: {
      label: t('Success'),
      color: 'var(--chart-2)',
    },
    failureRate: {
      label: t('Failed'),
      color: 'var(--destructive)',
    },
  }

  return (
    <section className='min-w-0 border-t pt-4'>
      <h3 className='mb-3 text-sm font-medium'>
        {t('Real request statistics')}
      </h3>
      {hasData ? (
        <ChartContainer
          config={config}
          className='aspect-auto h-52 w-full sm:h-60'
        >
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray='3 3' />
            <XAxis dataKey='window' tickLine={false} axisLine={false} />
            <YAxis
              domain={[0, 100]}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={54}
              tickFormatter={(value) => `${Math.round(Number(value))}%`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.window ?? '--'
                  }
                  formatter={(value, name) => (
                    <div className='flex flex-1 items-center justify-between gap-4'>
                      <span className='text-muted-foreground'>
                        {name === 'successRate' ? t('Success') : t('Failed')}
                      </span>
                      <span className='font-mono font-medium tabular-nums'>
                        {Number(value).toFixed(2)}%
                      </span>
                    </div>
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey='successRate'
              stackId='requests'
              fill='var(--color-successRate)'
              radius={[3, 3, 3, 3]}
              isAnimationActive={false}
            />
            <Bar
              dataKey='failureRate'
              stackId='requests'
              fill='var(--color-failureRate)'
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
      ) : (
        <div className='text-muted-foreground flex h-52 items-center justify-center border border-dashed text-sm'>
          {t('No data')}
        </div>
      )}
    </section>
  )
}

function TrendChart(props: {
  title: string
  data: MonitorChartPoint[]
  dataKey: 'latency'
  color: string
  domain?: [number | 'auto', number | 'auto']
  unit: string
}) {
  const { t } = useTranslation()
  const hasData = props.data.some((item) => item[props.dataKey] !== null)
  const config = {
    [props.dataKey]: {
      label: props.title,
      color: props.color,
    },
  }

  return (
    <section className='min-w-0 border-t pt-4 first:border-t-0 first:pt-0'>
      <h3 className='mb-3 text-sm font-medium'>{props.title}</h3>
      {hasData ? (
        <ChartContainer
          config={config}
          className='aspect-auto h-52 w-full sm:h-60'
        >
          <LineChart
            data={props.data}
            margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray='3 3' />
            <XAxis
              dataKey='time'
              tickLine={false}
              axisLine={false}
              minTickGap={32}
            />
            <YAxis
              domain={props.domain}
              tickLine={false}
              axisLine={false}
              width={54}
              tickFormatter={(value) => {
                const numeric = Number(value)
                return numeric >= 1000
                  ? `${(numeric / 1000).toFixed(numeric >= 10_000 ? 0 : 1)}s`
                  : `${Math.round(numeric)}ms`
              }}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.fullTime ?? '--'
                  }
                  formatter={(value) => (
                    <span className='font-mono font-medium tabular-nums'>
                      {Number(value).toFixed(0)}
                      {props.unit}
                    </span>
                  )}
                />
              }
            />
            <Line
              type='monotone'
              dataKey={props.dataKey}
              stroke={`var(--color-${props.dataKey})`}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      ) : (
        <div className='text-muted-foreground flex h-52 items-center justify-center border border-dashed text-sm'>
          {t('No data')}
        </div>
      )}
    </section>
  )
}

export function MonitorDetailsDrawer(props: MonitorDetailsDrawerProps) {
  const { t } = useTranslation()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const heartbeats = useMemo(
    () => getOrderedHeartbeats(props.monitor?.heartbeats),
    [props.monitor?.heartbeats]
  )
  const chartData = useMemo(() => buildChartData(heartbeats), [heartbeats])

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        showCloseButton={false}
        className={sideDrawerContentClassName(
          isMobile ? 'h-[92dvh] max-h-[92dvh] rounded-t-xl' : 'sm:max-w-2xl'
        )}
      >
        <SheetHeader className='relative shrink-0 border-b pr-14 text-left'>
          <SheetTitle>{props.monitor?.name || t('Unnamed monitor')}</SheetTitle>
          <SheetDescription>
            {props.monitor?.group
              ? `${t('Group')}: ${props.monitor.group}`
              : t('Details')}
          </SheetDescription>
          <SheetClose
            render={
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='absolute top-3 right-3'
                aria-label={t('Close')}
              />
            }
          >
            <X className='size-4' />
          </SheetClose>
        </SheetHeader>

        <div className='min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6'>
          <div className='space-y-6 pt-4'>
            <TrendChart
              title={t('Latency trend (last 24h)')}
              data={chartData}
              dataKey='latency'
              color='var(--chart-1)'
              domain={[0, 'auto']}
              unit=' ms'
            />
            <RealRequestChart stats={props.requestStats} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
