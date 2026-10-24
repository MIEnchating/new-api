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
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

import { EmptyState } from '@/components/empty-state'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import type { CacheChartPoint } from './cache-series'

const METRICS = ['success', 'cache', 'score', 'ttft'] as const

export const ChannelTrend = memo(function ChannelTrend(props: {
  points: Pick<
    CacheChartPoint,
    'ts' | 'health' | 'cache_hit_rate' | 'has_data'
  >[]
}) {
  const { t } = useTranslation()
  const [visibleMetrics, setVisibleMetrics] = useState<string[]>([...METRICS])
  const data = useMemo(
    () =>
      props.points.map((point) => ({
        ts: point.ts,
        success:
          point.health?.error_rate_percent == null
            ? null
            : 100 - point.health.error_rate_percent,
        cache: point.has_data ? point.cache_hit_rate : null,
        score: point.health?.score ?? null,
        ttft:
          point.health?.avg_ttft_ms == null
            ? null
            : point.health.avg_ttft_ms / 1000,
      })),
    [props.points]
  )
  const config = useMemo(
    () => ({
      success: { label: t('Success rate'), color: 'var(--success)', unit: '%' },
      cache: { label: t('Cache rate'), color: 'var(--chart-1)', unit: '%' },
      score: {
        label: t('Health score'),
        color: 'var(--warning)',
        unit: '/100',
      },
      ttft: { label: t('Average TTFT'), color: 'var(--chart-4)', unit: 's' },
    }),
    [t]
  )
  const hasData = data.some((point) =>
    [point.success, point.cache, point.score, point.ttft].some(
      (value) => value != null && Number.isFinite(value)
    )
  )
  const hasVisibleData = data.some((point) =>
    METRICS.some(
      (key) =>
        visibleMetrics.includes(key) &&
        point[key] != null &&
        Number.isFinite(point[key])
    )
  )
  return (
    <div
      role='region'
      aria-label={t('Overall channel trend')}
      className='flex h-full min-h-96 min-w-0 flex-col gap-4 overflow-hidden'
    >
      {!hasData ? (
        <EmptyState
          title={t('No data or insufficient samples')}
          className='h-full min-h-56'
        />
      ) : (
        <>
          <ToggleGroup
            multiple
            value={visibleMetrics}
            onValueChange={(values) => {
              if (values.length > 0) setVisibleMetrics(values)
            }}
            aria-label={t('Overall channel trend')}
            variant='outline'
            size='sm'
            spacing={2}
            className='w-full shrink-0 flex-wrap justify-start'
          >
            {METRICS.map((key) => (
              <ToggleGroupItem
                key={key}
                value={key}
                aria-label={config[key].label}
                disabled={
                  visibleMetrics.length === 1 && visibleMetrics.includes(key)
                }
                className='aria-[pressed=false]:text-muted-foreground gap-2 text-xs aria-[pressed=false]:opacity-60'
              >
                <span
                  aria-hidden='true'
                  className='w-4 shrink-0 border-t-2'
                  style={{
                    borderColor: config[key].color,
                    borderStyle: key === 'ttft' ? 'dashed' : 'solid',
                  }}
                />
                {config[key].label}
                <span className='text-muted-foreground text-[10px]'>
                  {config[key].unit}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {!hasVisibleData ? (
            <EmptyState
              title={t('No data or insufficient samples')}
              className='min-h-64 flex-1'
            />
          ) : (
            <ChartContainer
              config={config}
              className='aspect-auto min-h-64 w-full flex-1'
            >
              <LineChart
                data={data}
                margin={{ top: 24, right: 4, left: 0, bottom: 4 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke='var(--border)'
                  strokeDasharray='3 5'
                  strokeOpacity={0.6}
                />
                <XAxis
                  dataKey='ts'
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                  tickMargin={12}
                  height={36}
                  padding={{ left: 8, right: 8 }}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(value) =>
                    new Date(Number(value) * 1000).toLocaleTimeString(
                      undefined,
                      {
                        hour: '2-digit',
                        minute: '2-digit',
                        hourCycle: 'h23',
                      }
                    )
                  }
                />
                <YAxis
                  yAxisId='rate'
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  width={40}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  label={{
                    value: '0–100',
                    position: 'top',
                    offset: 12,
                    fill: 'var(--muted-foreground)',
                    fontSize: 10,
                  }}
                />
                <YAxis
                  yAxisId='latency'
                  orientation='right'
                  width={48}
                  domain={[0, 'auto']}
                  includeHidden
                  hide={!visibleMetrics.includes('ttft')}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(value) => `${value} s`}
                />
                <ChartTooltip
                  cursor={{
                    stroke: 'var(--muted-foreground)',
                    strokeDasharray: '4 4',
                    strokeOpacity: 0.5,
                  }}
                  content={
                    <ChartTooltipContent
                      className='max-w-[calc(100vw-2rem)] min-w-56 gap-3 rounded-xl px-3 py-3 shadow-lg'
                      labelClassName='border-b pb-2'
                      labelFormatter={(value) =>
                        new Date(Number(value) * 1000).toLocaleString()
                      }
                      formatter={(value, name) => {
                        const key = String(name) as keyof typeof config
                        return (
                          <div className='flex w-full items-center gap-2'>
                            <span
                              aria-hidden='true'
                              className='size-2 shrink-0 rounded-full'
                              style={{ backgroundColor: config[key]?.color }}
                            />
                            <span className='text-muted-foreground'>
                              {config[key]?.label}
                            </span>
                            <span className='ml-auto pl-4 font-medium whitespace-nowrap tabular-nums'>
                              {Number(value).toFixed(1)}
                              {key === 'ttft' ? ' ' : ''}
                              {config[key]?.unit}
                            </span>
                          </div>
                        )
                      }}
                    />
                  }
                />
                {METRICS.map((key) => (
                  <Line
                    key={key}
                    dataKey={key}
                    hide={!visibleMetrics.includes(key)}
                    yAxisId={key === 'ttft' ? 'latency' : 'rate'}
                    stroke={`var(--color-${key})`}
                    type='linear'
                    strokeWidth={2.5}
                    strokeDasharray={key === 'ttft' ? '6 4' : undefined}
                    dot={{ r: 2, fill: `var(--color-${key})`, strokeWidth: 0 }}
                    activeDot={{
                      r: 5,
                      stroke: 'var(--background)',
                      strokeWidth: 2,
                    }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          )}
        </>
      )}
    </div>
  )
})
