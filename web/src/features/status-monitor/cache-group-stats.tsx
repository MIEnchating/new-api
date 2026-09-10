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
import { Grid2X2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { buildCacheChartSeries } from './cache-series'
import { ChannelTrend } from './channel-trend'
import {
  formatMonitorPercent,
  formatMonitorLatency,
  monitorScoreColor,
} from './monitor-health'
import type { CacheMetricGroup, CacheMetricsResponse } from './types'

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

export function CacheGroupStats(props: {
  groups: CacheMetricGroup[]
  summarySeries?: NonNullable<CacheMetricsResponse['data']['summary']>['series']
  countsVisible: boolean
  bucketSeconds: number
  rangeStart?: number
  rangeEnd?: number
}) {
  const { t } = useTranslation()
  const [view, setView] = useState('pulse')
  const [viewport, setViewport] = useState({ zoom: 1, anchor: 1 })
  const matrixRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => {
    const timeline = buildCacheChartSeries(
      props.groups.flatMap((group) => group.series),
      props.bucketSeconds,
      props.rangeStart,
      props.rangeEnd
    )
    return props.groups.map((group) => ({
      group,
      points: buildCacheChartSeries(
        group.series,
        props.bucketSeconds,
        timeline[0]?.ts,
        timeline.at(-1)?.ts
      ),
    }))
  }, [props.groups, props.bucketSeconds, props.rangeStart, props.rangeEnd])
  const timeline = rows[0]?.points ?? []
  const summaryPoints = useMemo(() => {
    const summaryByTime = new Map(
      (props.summarySeries ?? []).map((point) => [point.ts, point])
    )
    return (rows[0]?.points ?? []).map(
      (point) =>
        summaryByTime.get(point.ts) ?? {
          ts: point.ts,
          has_data: false,
          cache_hit_rate: null,
        }
    )
  }, [props.summarySeries, rows])
  const length = timeline.length
  const visibleCount = Math.max(1, Math.ceil(length / viewport.zoom))
  const startIndex = Math.round(
    Math.max(0, length - visibleCount) * viewport.anchor
  )
  const visibleTimeline = timeline.slice(startIndex, startIndex + visibleCount)
  const statusLabels = {
    healthy: t('Healthy'),
    warning: t('Warning'),
    critical: t('Critical'),
    unknown: t('No data or insufficient samples'),
  }
  useEffect(() => {
    const matrix = matrixRef.current
    if (!matrix) return
    const onWheel = (event: WheelEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-monitor-pulses]')
          : null
      if (
        !target ||
        event.deltaY === 0 ||
        length < 2 ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return
      }
      event.preventDefault()
      const bounds = target.getBoundingClientRect()
      const fraction = Math.max(
        0,
        Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))
      )
      setViewport((previous) => {
        const zoom = Math.max(
          1,
          Math.min(4, previous.zoom + (event.deltaY < 0 ? 1 : -1))
        )
        const previousCount = Math.ceil(length / previous.zoom)
        const nextCount = Math.ceil(length / zoom)
        const focus =
          (length - previousCount) * previous.anchor + fraction * previousCount
        const anchor =
          nextCount < length
            ? Math.max(
                0,
                Math.min(
                  1,
                  (focus - fraction * nextCount) / (length - nextCount)
                )
              )
            : 1
        return { zoom, anchor }
      })
    }
    matrix.addEventListener('wheel', onWheel, { passive: false })
    return () => matrix.removeEventListener('wheel', onWheel)
  }, [length, view])
  return (
    <Tabs
      value={view}
      onValueChange={setView}
      className='min-h-0 min-w-0 flex-1 overflow-hidden'
    >
      <Card
        data-card-hover='false'
        className='min-h-0 min-w-0 flex-1 gap-3 overflow-hidden rounded-2xl py-3 shadow-none ring-inset sm:gap-4 sm:py-5'
      >
        <CardHeader className='flex shrink-0 flex-col justify-between gap-3 px-4 sm:px-6 xl:flex-row xl:items-center'>
          <div className='space-y-1'>
            <CardTitle className='flex items-center gap-2 text-sm'>
              <Grid2X2 className='text-success size-4' />
              {t('Availability trends')}
            </CardTitle>
            <CardDescription className='text-xs'>
              {view === 'pulse'
                ? t(
                    'Each row is a monitored group. Each block is a time interval; hover or focus for details.'
                  )
                : t(
                    'Overall success rate, latency, cache rate, and health score over time.'
                  )}
            </CardDescription>
          </div>
          <div className='flex min-w-0 flex-wrap items-center gap-2 sm:gap-3'>
            <TabsList aria-label={t('View')}>
              <TabsTrigger value='pulse'>{t('Pulse matrix')}</TabsTrigger>
              <TabsTrigger value='line'>{t('Line chart')}</TabsTrigger>
            </TabsList>
            <span className='bg-muted text-muted-foreground rounded-full px-2 py-1 text-[11px]'>
              {t('{{minutes}} min intervals', {
                minutes: props.bucketSeconds / 60,
              })}
            </span>
            {view === 'pulse' ? (
              <>
                <span className='text-muted-foreground hidden text-[11px] 2xl:inline'>
                  {t('Scroll over blocks to zoom')}
                </span>
                <ButtonGroup aria-label={t('Zoom')}>
                  <Button
                    size='icon-sm'
                    variant='outline'
                    aria-label={t('Zoom out')}
                    disabled={viewport.zoom === 1}
                    onClick={() =>
                      setViewport((v) => ({
                        ...v,
                        zoom: Math.max(1, v.zoom - 1),
                      }))
                    }
                  >
                    <ZoomOut />
                  </Button>
                  <Button
                    size='icon-sm'
                    variant='outline'
                    aria-label={t('Zoom in')}
                    disabled={viewport.zoom === 4 || length < 2}
                    onClick={() =>
                      setViewport((v) => ({
                        ...v,
                        zoom: Math.min(4, v.zoom + 1),
                      }))
                    }
                  >
                    <ZoomIn />
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={viewport.zoom === 1}
                    onClick={() => setViewport({ zoom: 1, anchor: 1 })}
                  >
                    <RotateCcw className='size-3' />
                    {t('Reset zoom')}
                  </Button>
                </ButtonGroup>
              </>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className='flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden px-3 sm:gap-4 sm:px-6'>
          <TabsContent
            value='pulse'
            className='flex min-h-0 flex-1 flex-col overflow-hidden'
          >
            <div
              ref={matrixRef}
              className='min-h-0 flex-1 [scrollbar-width:thin] overflow-auto overscroll-contain rounded-xl'
              role='region'
              aria-label={t('Availability trends')}
              tabIndex={0}
            >
              <div
                role='table'
                aria-label={t('Channel health')}
                className='grid min-w-0 grid-cols-3 text-xs lg:min-w-[760px] lg:grid-cols-[minmax(160px,1.4fr)_90px_90px_90px_minmax(280px,3.5fr)]'
              >
                <div
                  role='row'
                  className='bg-muted text-muted-foreground sticky top-0 z-20 col-span-3 grid grid-cols-subgrid items-center gap-x-3 px-3 py-3 text-[11px] font-medium lg:col-span-5'
                >
                  <span role='columnheader' className='hidden lg:block'>
                    {t('Channel dimension')}
                  </span>
                  <span role='columnheader'>{t('Success rate')}</span>
                  <span role='columnheader'>{t('Average TTFT')}</span>
                  <span role='columnheader'>{t('Cache rate')}</span>
                  <span
                    role='columnheader'
                    className='col-span-3 mt-2 flex justify-between gap-3 text-[10px] tabular-nums lg:col-span-1 lg:mt-0'
                    aria-live='polite'
                  >
                    <span>
                      {visibleTimeline[0]
                        ? formatTime(visibleTimeline[0].ts)
                        : '--'}
                    </span>
                    <span>
                      {visibleTimeline.at(-1)
                        ? formatTime(visibleTimeline.at(-1)?.ts ?? 0)
                        : '--'}
                    </span>
                  </span>
                </div>
                {rows.map(({ group, points }) => (
                  <div
                    key={group.group}
                    role='row'
                    className='border-border/40 odd:bg-muted/15 hover:bg-muted/30 col-span-3 grid grid-cols-subgrid items-center gap-x-3 gap-y-2 border-b px-3 py-3 last:border-b-0 lg:col-span-5 lg:py-2'
                  >
                    <div
                      role='cell'
                      className='col-span-3 flex min-w-0 items-center gap-2 font-semibold lg:col-span-1'
                    >
                      <span
                        role='img'
                        aria-label={
                          statusLabels[group.health?.overall ?? 'unknown']
                        }
                        className='size-2 shrink-0 rounded-full'
                        style={{
                          backgroundColor: monitorScoreColor(
                            group.health?.score
                          ),
                        }}
                      />
                      <span className='truncate' title={group.group}>
                        {group.group}
                      </span>
                    </div>
                    <span role='cell' className='tabular-nums'>
                      {formatMonitorPercent(
                        group.health?.error_rate_percent == null
                          ? null
                          : 100 - group.health.error_rate_percent
                      )}
                    </span>
                    <span role='cell' className='tabular-nums'>
                      {formatMonitorLatency(group.health?.avg_ttft_ms)}
                    </span>
                    <span role='cell' className='tabular-nums'>
                      {formatMonitorPercent(
                        group.has_data ? group.cache_hit_rate : null
                      )}
                    </span>
                    <div
                      role='cell'
                      data-monitor-pulses
                      className='col-span-3 grid gap-[2px] lg:col-span-1'
                      style={{
                        gridTemplateColumns: `repeat(${Math.max(1, visibleTimeline.length)}, minmax(0, 1fr))`,
                      }}
                    >
                      {points
                        .slice(startIndex, startIndex + visibleCount)
                        .map((point) => {
                          const health = point.health
                          const status = health?.overall ?? 'unknown'
                          const score = health?.score
                          const success =
                            health?.error_rate_percent == null
                              ? null
                              : 100 - health.error_rate_percent
                          const details = [
                            formatTime(point.ts),
                            statusLabels[status],
                            `${t('Health score')}: ${score == null ? '--' : score.toFixed(1)}`,
                            `${t('Success rate')}: ${formatMonitorPercent(success)}`,
                            `${t('Average TTFT')}: ${formatMonitorLatency(health?.avg_ttft_ms)}`,
                            `${t('Cache rate')}: ${formatMonitorPercent(point.has_data ? point.cache_hit_rate : null)}`,
                          ]
                          if (props.countsVisible && !point.missing) {
                            details.push(
                              `${t('Hits / Requests')}: ${point.hit_count ?? 0} / ${point.request_count ?? 0}`
                            )
                          }
                          return (
                            <Tooltip key={point.ts}>
                              <TooltipTrigger
                                render={<span role='img' tabIndex={0} />}
                                aria-label={details.join('\n')}
                                className='focus-visible:outline-ring h-4 min-w-0 rounded-[2px] outline-offset-2 focus-visible:outline-2'
                                style={{
                                  backgroundColor: monitorScoreColor(score),
                                }}
                              />
                              <TooltipContent className='whitespace-pre-line'>
                                {details.join('\n')}
                              </TooltipContent>
                            </Tooltip>
                          )
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
          <TabsContent
            value='line'
            className='min-h-0 flex-1 overflow-auto overscroll-contain'
          >
            <ChannelTrend points={summaryPoints} />
          </TabsContent>
          {view === 'pulse' ? (
            <div className='text-muted-foreground shrink-0 space-y-2 text-[10px] sm:text-[11px]'>
              <div className='flex items-center gap-2' aria-hidden='true'>
                <span>{t('Poor')}</span>
                <div className='h-2 flex-1 rounded-full bg-[linear-gradient(to_right,var(--destructive),var(--warning)_50%,var(--success)_80%)]' />
                <span>{t('Good')}</span>
              </div>
              <div className='flex flex-wrap gap-x-4 gap-y-2'>
                <span className='flex items-center gap-1.5'>
                  <i className='bg-success size-2 rounded-full' />
                  {t('Healthy (≥80)')}
                </span>
                <span className='flex items-center gap-1.5'>
                  <i className='bg-warning size-2 rounded-full' />
                  {t('Needs attention (50–79)')}
                </span>
                <span className='flex items-center gap-1.5'>
                  <i className='bg-destructive size-2 rounded-full' />
                  {t('Unhealthy (<50)')}
                </span>
                <span className='flex items-center gap-1.5'>
                  <i className='bg-muted-foreground/25 size-2 rounded-full' />
                  {t('No data or insufficient samples')}
                </span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Tabs>
  )
}
