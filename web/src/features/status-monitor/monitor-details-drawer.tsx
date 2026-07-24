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
import { Activity, Clock3, Gauge, X } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

import { sideDrawerContentClassName } from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import {
  ChartContainer,
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
import type { UptimeHeartbeat, UptimeMonitor } from '@/features/dashboard/types'
import { useMediaQuery } from '@/hooks'

import { getOrderedHeartbeats } from './monitor-utils'

type MonitorDetailsDrawerProps = {
  open: boolean
  monitor: UptimeMonitor | null
  onOpenChange: (open: boolean) => void
}

type MonitorChartPoint = {
  time: string
  fullTime: string
  latency: number | null
  availability: number
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${(Math.max(0, value) * 100).toFixed(2)}%`
}

function formatPing(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${Math.round(value)} ms`
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
  let successfulChecks = 0

  return heartbeats.map((heartbeat, index) => {
    if (heartbeat.status === 1) successfulChecks += 1

    return {
      time: formatChartTime(heartbeat.time, {
        hour: '2-digit',
        minute: '2-digit',
      }),
      fullTime: formatChartTime(heartbeat.time),
      latency:
        typeof heartbeat.ping === 'number' && Number.isFinite(heartbeat.ping)
          ? heartbeat.ping
          : null,
      availability: (successfulChecks / (index + 1)) * 100,
    }
  })
}

function DrawerMetric(props: {
  icon: typeof Activity
  label: string
  value: string
}) {
  const Icon = props.icon
  return (
    <div className='min-w-0 border-b py-3 sm:border-r sm:border-b-0 sm:px-4 sm:last:border-r-0'>
      <div className='text-muted-foreground flex items-center gap-1.5 text-xs'>
        <Icon className='size-3.5' />
        <span className='truncate'>{props.label}</span>
      </div>
      <div className='mt-1 text-lg font-semibold tabular-nums'>
        {props.value}
      </div>
    </div>
  )
}

function TrendChart(props: {
  title: string
  data: MonitorChartPoint[]
  dataKey: 'latency' | 'availability'
  color: string
  domain?: [number | 'auto', number | 'auto']
  unit: string
}) {
  const { t } = useTranslation()
  const domain =
    props.dataKey === 'availability' && props.data.length > 0
      ? ([
          Math.max(
            0,
            Math.floor(
              Math.min(...props.data.map((point) => point.availability)) - 1
            )
          ),
          100,
        ] as [number, number])
      : props.domain
  const config = {
    [props.dataKey]: {
      label: props.title,
      color: props.color,
    },
  }

  return (
    <section className='min-w-0 border-t pt-4 first:border-t-0 first:pt-0'>
      <h3 className='mb-3 text-sm font-medium'>{props.title}</h3>
      {props.data.length > 0 ? (
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
              domain={domain}
              tickLine={false}
              axisLine={false}
              width={54}
              tickFormatter={(value) => {
                const numeric = Number(value)
                if (props.dataKey === 'latency') {
                  return numeric >= 1000
                    ? `${(numeric / 1000).toFixed(numeric >= 10_000 ? 0 : 1)}s`
                    : `${Math.round(numeric)}ms`
                }
                return `${Math.round(numeric)}%`
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
                      {Number(value).toFixed(
                        props.dataKey === 'latency' ? 0 : 2
                      )}
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
          <div className='grid grid-cols-2 sm:grid-cols-3'>
            <DrawerMetric
              icon={Gauge}
              label={t('Latency')}
              value={formatPing(props.monitor?.ping)}
            />
            <DrawerMetric
              icon={Activity}
              label={t('30-minute uptime')}
              value={formatPercent(props.monitor?.uptime30m)}
            />
            <DrawerMetric
              icon={Activity}
              label={t('1-hour uptime')}
              value={formatPercent(props.monitor?.uptime1h)}
            />
            <DrawerMetric
              icon={Activity}
              label={t('24-hour uptime')}
              value={formatPercent(
                props.monitor?.uptime24 ?? props.monitor?.uptime
              )}
            />
            <DrawerMetric
              icon={Activity}
              label={t('7-day uptime')}
              value={formatPercent(props.monitor?.uptime7)}
            />
            <DrawerMetric
              icon={Clock3}
              label={t('Last check')}
              value={formatChartTime(props.monitor?.lastChecked, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            />
          </div>

          <div className='mt-5 space-y-6'>
            <TrendChart
              title={t('Latency trend (last 24h)')}
              data={chartData}
              dataKey='latency'
              color='var(--chart-1)'
              domain={[0, 'auto']}
              unit=' ms'
            />
            <TrendChart
              title={t('Availability (last 24h)')}
              data={chartData}
              dataKey='availability'
              color='var(--chart-2)'
              domain={[0, 100]}
              unit='%'
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
