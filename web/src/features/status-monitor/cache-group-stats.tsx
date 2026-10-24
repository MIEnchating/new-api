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
  ChartNoAxesCombined,
  Grid2X2,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardFooter,
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
      className='min-h-0 min-w-0 flex-1 overflow-hidden [@media(max-height:700px)]:min-h-[28rem]'
    >
      <Card
        data-card-hover='false'
        className='@container/trends min-h-0 min-w-0 flex-1 gap-0 overflow-hidden rounded-xl py-0 shadow-none ring-inset'
      >
        <CardHeader className='flex shrink-0 flex-row flex-wrap items-center justify-between gap-3 border-b px-3 py-3 sm:px-5 sm:py-4'>
          <div className='flex min-w-0 flex-col gap-1.5'>
            <CardTitle className='flex flex-wrap items-center gap-2 text-sm font-semibold'>
              {t('Availability trends')}
              <Badge
                variant='secondary'
                className='text-[10px] font-normal sm:text-xs'
              >
                {t('{{minutes}} min intervals', {
                  minutes: props.bucketSeconds / 60,
                })}
              </Badge>
            </CardTitle>
            <CardDescription className='hidden text-xs sm:block'>
              {view === 'pulse'
                ? t(
                    'Each row is a monitored group. Each block is a time interval; hover or focus for details.'
                  )
                : t(
                    'Overall success rate, latency, cache rate, and health score over time.'
                  )}
            </CardDescription>
          </div>
          <div className='flex min-w-0 shrink-0 items-center gap-2'>
            <TabsList aria-label={t('View')}>
              <TabsTrigger value='pulse' className='gap-2 px-3'>
                <Grid2X2 aria-hidden='true' />
                {t('Pulse matrix')}
              </TabsTrigger>
              <TabsTrigger value='line' className='gap-2 px-3'>
                <ChartNoAxesCombined aria-hidden='true' />
                {t('Line chart')}
              </TabsTrigger>
            </TabsList>
          </div>
        </CardHeader>
        <CardContent className='@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-0'>
          <TabsContent
            value='pulse'
            className='flex min-h-0 flex-1 flex-col overflow-hidden'
          >
            <div
              data-monitor-toolbar
              className='flex shrink-0 flex-wrap items-center gap-2.5 px-3 py-3 sm:gap-3 sm:px-5'
            >
              <InputGroup className='min-w-0 flex-1 sm:max-w-72'>
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
              <Badge variant='secondary' className='tabular-nums'>
                {visibleRows.length} / {rows.length} {t('Groups')}
              </Badge>
              <div className='flex w-full shrink-0 items-center justify-end sm:ml-auto sm:w-auto'>
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
              className='min-h-0 flex-1 [scrollbar-width:thin] overflow-auto overscroll-contain border-t'
              role='region'
              aria-label={t('Availability trends')}
              tabIndex={0}
            >
              {visibleRows.length === 0 ? (
                <EmptyState
                  title={t('No results found')}
                  className='min-h-40'
                  action={
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setSearch('')}
                    >
                      {t('Clear search')}
                    </Button>
                  }
                />
              ) : (
                <div
                  role='table'
                  aria-label={t('Channel health')}
                  className='grid min-w-0 grid-cols-3 text-xs @min-[48rem]:grid-cols-[minmax(130px,1.2fr)_90px_100px_85px_minmax(180px,3fr)]'
                >
                  <div
                    role='row'
                    className='bg-muted text-muted-foreground z-20 col-span-3 grid grid-cols-subgrid items-center gap-x-4 px-3 py-2.5 text-[11px] font-medium sm:px-5 @min-[48rem]:sticky @min-[48rem]:top-0 @min-[48rem]:col-span-5'
                  >
                    <span
                      role='columnheader'
                      className='hidden @min-[48rem]:block'
                    >
                      {t('Group')}
                    </span>
                    <span
                      role='columnheader'
                      className='hidden whitespace-nowrap @min-[48rem]:block'
                    >
                      {t('Success rate')}
                    </span>
                    <span
                      role='columnheader'
                      className='hidden whitespace-nowrap @min-[48rem]:block'
                    >
                      {t('Average TTFT')}
                    </span>
                    <span
                      role='columnheader'
                      className='hidden whitespace-nowrap @min-[48rem]:block'
                    >
                      {t('Cache rate')}
                    </span>
                    <span
                      role='columnheader'
                      className='col-span-3 flex justify-between gap-3 text-[10px] tabular-nums @min-[48rem]:col-span-1'
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
                      className='border-border/60 hover:bg-muted/30 col-span-3 grid grid-cols-subgrid items-center gap-x-4 gap-y-3 border-b px-3 py-4 transition-colors last:border-b-0 sm:px-5 @min-[48rem]:col-span-5'
                    >
                      <div
                        role='cell'
                        className='col-span-3 flex min-w-0 items-center gap-2.5 text-sm font-medium @min-[48rem]:col-span-1'
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
                      <div
                        role='cell'
                        className='flex min-w-0 flex-col gap-1 tabular-nums'
                      >
                        <span className='text-muted-foreground text-[10px] @min-[48rem]:hidden'>
                          {t('Success rate')}
                        </span>
                        <span className='font-medium'>
                          {formatMonitorPercent(
                            group.health?.error_rate_percent == null
                              ? null
                              : 100 - group.health.error_rate_percent
                          )}
                        </span>
                      </div>
                      <div
                        role='cell'
                        className='flex min-w-0 flex-col gap-1 tabular-nums'
                      >
                        <span className='text-muted-foreground text-[10px] @min-[48rem]:hidden'>
                          {t('Average TTFT')}
                        </span>
                        <span className='font-medium'>
                          {formatMonitorLatency(group.health?.avg_ttft_ms)}
                        </span>
                      </div>
                      <div
                        role='cell'
                        className='flex min-w-0 flex-col gap-1 tabular-nums'
                      >
                        <span className='text-muted-foreground text-[10px] @min-[48rem]:hidden'>
                          {t('Cache rate')}
                        </span>
                        <span className='font-medium'>
                          {formatMonitorPercent(
                            group.has_data ? group.cache_hit_rate : null
                          )}
                        </span>
                      </div>
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
                                  className='focus-visible:outline-ring h-6 min-w-0 rounded-[3px] outline-offset-2 transition-opacity hover:opacity-75 focus-visible:outline-2'
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
            className='min-h-0 flex-1 overflow-auto overscroll-contain p-3 sm:p-5'
          >
            <ChannelTrend points={summaryPoints} />
          </TabsContent>
        </CardContent>
        {view === 'pulse' ? (
          <CardFooter className='text-muted-foreground shrink-0 px-3 py-3 text-[10px] sm:px-5 sm:text-[11px]'>
            <div className='flex flex-wrap gap-x-5 gap-y-2'>
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
          </CardFooter>
        ) : null}
      </Card>
    </Tabs>
  )
}
