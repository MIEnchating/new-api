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
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'

import type { CacheChartPoint } from './cache-series'

export function ChannelTrend(props: {
  points: Pick<
    CacheChartPoint,
    'ts' | 'health' | 'cache_hit_rate' | 'has_data'
  >[]
}) {
  const { t } = useTranslation()
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
  const config = {
    success: { label: t('Success rate'), color: 'var(--success)' },
    cache: { label: t('Cache rate'), color: 'var(--primary)' },
    score: { label: t('Health score'), color: 'var(--warning)' },
    ttft: { label: t('Average TTFT'), color: 'var(--chart-4)' },
  }
  return (
    <div
      role='region'
      aria-label={t('Overall channel trend')}
      className='h-full min-h-56 min-w-0'
    >
      <ChartContainer
        config={config}
        className='aspect-auto h-full min-h-56 w-full'
      >
        <LineChart
          data={data}
          margin={{ top: 16, right: 4, left: 0, bottom: 4 }}
        >
          <CartesianGrid vertical={false} strokeDasharray='3 3' />
          <XAxis
            dataKey='ts'
            tickLine={false}
            axisLine={false}
            minTickGap={40}
            tickFormatter={(value) =>
              new Date(Number(value) * 1000).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
              })
            }
          />
          <YAxis
            yAxisId='rate'
            domain={[0, 100]}
            width={36}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId='latency'
            orientation='right'
            width={48}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `${value} s`}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) =>
                  new Date(Number(value) * 1000).toLocaleString()
                }
                formatter={(value, name) => {
                  const key = String(name) as keyof typeof config
                  let unit = '%'
                  if (key === 'ttft') unit = ' s'
                  if (key === 'score') unit = ''
                  return (
                    <span>
                      {config[key]?.label}: {Number(value).toFixed(1)}
                      {unit}
                    </span>
                  )
                }}
              />
            }
          />
          <ChartLegend
            content={
              <ChartLegendContent className='flex-wrap gap-x-4 gap-y-1 text-[10px] sm:text-xs' />
            }
          />
          {(['success', 'cache', 'score', 'ttft'] as const).map((key) => (
            <Line
              key={key}
              dataKey={key}
              yAxisId={key === 'ttft' ? 'latency' : 'rate'}
              stroke={`var(--color-${key})`}
              type='linear'
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  )
}
