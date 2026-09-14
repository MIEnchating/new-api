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
import {
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
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
  const [search, setSearch] = useState('')
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
  const query = search.trim().toLocaleLowerCase()
  const visibleRows = rows.filter(({ group }) =>
    group.group.toLocaleLowerCase().includes(query)
  )
  return (
    <Tabs
      value={view}
      onValueChange={setView}
      className='min-h-0 min-w-0 flex-1 overflow-hidden'
    >
      <Card
        data-card-hover='false'
        className='@container/trends min-h-0 min-w-0 flex-1 gap-3 overflow-hidden rounded-xl py-3 shadow-none ring-inset max-[359px]:gap-2 sm:py-4'
      >
        <CardHeader className='flex shrink-0 flex-row flex-wrap items-center justify-between gap-3 px-3 sm:px-4'>
          <div className='space-y-1'>
            <CardTitle className='flex items-center gap-2 text-sm'>
              <Grid2X2
                className='text-muted-foreground size-4 max-[359px]:hidden'
                aria-hidden='true'
              />
              <span className='max-[359px]:sr-only'>
                {t('Availability trends')}
              </span>
              <span className='bg-muted text-muted-foreground rounded-full px-2 py-1 text-[10px] font-normal sm:text-[11px]'>
                {t('{{minutes}} min intervals', {
                  minutes: props.bucketSeconds / 60,
                })}
              </span>
            </CardTitle>
            <CardDescription className='hidden text-xs @min-[60rem]/trends:block'>
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
          </div>
        </CardHeader>
        <CardContent className='@container flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden px-3 sm:px-4'>
          <TabsContent
            value='pulse'
            className='flex min-h-0 flex-1 flex-col gap-3 overflow-hidden max-[359px]:gap-2'
          >
            <div className='flex shrink-0 items-center gap-3'>
              <InputGroup className='min-w-0 flex-1 sm:max-w-64'>
                <InputGroupAddon>
                  <Search aria-hidden='true' />
                </InputGroupAddon>
                <InputGroupInput
                  type='search'
                  aria-label={t('Search groups...')}
                  placeholder={t('Search groups...')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </InputGroup>
              <span className='text-muted-foreground hidden shrink-0 text-xs tabular-nums @min-[30rem]/trends:inline'>
                {visibleRows.length} / {rows.length}
              </span>
              <div className='ml-auto shrink-0'>
                <ButtonGroup aria-label={t('Zoom')}>
                  <Button
                    size='icon-sm'
                    variant='outline'
                    aria-label={t('Earlier intervals')}
                    disabled={startIndex === 0}
                    onClick={() =>
                      setViewport((current) => ({
                        ...current,
                        anchor: Math.max(
                          0,
                          (startIndex - visibleCount) /
                            Math.max(1, length - visibleCount)
                        ),
                      }))
                    }
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    size='icon-sm'
                    variant='outline'
                    aria-label={t('Later intervals')}
                    disabled={startIndex + visibleCount >= length}
                    onClick={() =>
                      setViewport((current) => ({
                        ...current,
                        anchor: Math.min(
                          1,
                          (startIndex + visibleCount) /
                            Math.max(1, length - visibleCount)
                        ),
                      }))
                    }
                  >
                    <ChevronRight />
                  </Button>
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
                    <span className='sr-only @min-[60rem]/trends:not-sr-only'>
                      {t('Reset zoom')}
                    </span>
                  </Button>
                </ButtonGroup>
              </div>
            </div>
            <div
              className='min-h-0 flex-1 [scrollbar-width:thin] overflow-auto overscroll-contain rounded-xl'
              role='region'
              aria-label={t('Availability trends')}
              tabIndex={0}
            >
              {visibleRows.length === 0 ? (
                <EmptyState
                  title={t('No results found')}
                  className='min-h-40'
                />
              ) : (
                <div
                  role='table'
                  aria-label={t('Channel health')}
                  className='grid min-w-0 grid-cols-3 text-xs @min-[48rem]:grid-cols-[minmax(130px,1.2fr)_80px_95px_75px_minmax(180px,3fr)]'
                >
                  <div
                    role='row'
                    className='bg-muted text-muted-foreground z-20 col-span-3 grid grid-cols-subgrid items-center gap-x-3 px-3 py-3 text-[11px] font-medium max-[359px]:py-2 @min-[48rem]:sticky @min-[48rem]:top-0 @min-[48rem]:col-span-5'
                  >
                    <span
                      role='columnheader'
                      className='hidden @min-[48rem]:block'
                    >
                      {t('Group')}
                    </span>
                    <span
                      role='columnheader'
                      className='whitespace-nowrap max-[359px]:sr-only'
                    >
                      {t('Success rate')}
                    </span>
                    <span
                      role='columnheader'
                      className='whitespace-nowrap max-[359px]:sr-only'
                    >
                      {t('Average TTFT')}
                    </span>
                    <span
                      role='columnheader'
                      className='whitespace-nowrap max-[359px]:sr-only'
                    >
                      {t('Cache rate')}
                    </span>
                    <span
                      role='columnheader'
                      className='col-span-3 mt-2 flex justify-between gap-3 text-[10px] tabular-nums max-[359px]:mt-0 @min-[48rem]:col-span-1 @min-[48rem]:mt-0'
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
                  {visibleRows.map(({ group, points }) => (
                    <div
                      key={group.group}
                      role='row'
                      className='border-border/40 odd:bg-muted/15 hover:bg-muted/30 col-span-3 grid grid-cols-subgrid items-center gap-x-3 gap-y-2 border-b px-3 py-3 last:border-b-0 max-[359px]:py-2 @min-[48rem]:col-span-5 @min-[48rem]:py-2'
                    >
                      <div
                        role='cell'
                        className='col-span-3 flex min-w-0 items-center gap-2 font-semibold @min-[48rem]:col-span-1'
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
                        className='col-span-3 grid min-w-0 @min-[48rem]:col-span-1'
                        style={{
                          gridTemplateColumns: `repeat(${Math.max(1, visibleTimeline.length)}, minmax(0, 1fr))`,
                          columnGap: `min(2px, ${25 / Math.max(1, visibleTimeline.length)}%)`,
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
              )}
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
