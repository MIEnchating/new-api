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
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Database,
  Gauge,
  GripVertical,
  Save,
  Settings2,
  Target,
  Zap,
} from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatThroughput } from '@/features/performance-metrics/lib/format'
import { useIsAdmin } from '@/hooks/use-admin'
import { cn } from '@/lib/utils'

import { updateCacheHitRateBaseline, updateCacheMonitorGroups } from './api'
import { buildCacheChartSeries } from './cache-series'
import type { CacheMetricGroup, CacheMetricsResponse } from './types'

const DEFAULT_BASELINE = 85
const CACHE_GROUP_DRAG_MODIFIERS = [
  restrictToVerticalAxis,
  restrictToParentElement,
]

function formatPercent(value: number) {
  return `${Math.max(0, Math.min(100, value)).toFixed(2)}%`
}

function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(
    Math.max(0, value)
  )
}

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

function estimateAxisLabelWidth(value: string) {
  return [...value].reduce(
    (width, character) =>
      width + ((character.codePointAt(0) ?? 0) <= 0x7f ? 7 : 12),
    0
  )
}

function CacheMetric(props: {
  icon: typeof Gauge
  label: string
  value: string
}) {
  const Icon = props.icon
  return (
    <div className='min-w-0 border-b py-3 sm:border-r sm:border-b-0 sm:px-4 sm:first:pl-0 sm:last:border-r-0'>
      <div className='text-muted-foreground flex items-center gap-1.5 text-xs'>
        <Icon className='size-3.5 shrink-0' />
        <span className='truncate'>{props.label}</span>
      </div>
      <div className='mt-1 truncate text-lg font-semibold tabular-nums'>
        {props.value}
      </div>
    </div>
  )
}

function CacheTrend(props: {
  group: CacheMetricGroup
  baseline: number
  bucketSeconds: number
  rangeStart?: number
  rangeEnd?: number
}) {
  const { t } = useTranslation()
  const data = useMemo(
    () =>
      buildCacheChartSeries(
        props.group.series,
        props.bucketSeconds,
        props.rangeStart,
        props.rangeEnd
      ).map((point) => ({
        ...point,
        time: formatTime(point.ts),
        fullTime: new Date(point.ts * 1000).toLocaleString(undefined, {
          hourCycle: 'h23',
        }),
      })),
    [props.bucketSeconds, props.group.series, props.rangeEnd, props.rangeStart]
  )
  const config = {
    cache_hit_rate: {
      label: t('Cache hit rate'),
      color: 'var(--chart-2)',
    },
    avg_tps: {
      label: t('Throughput'),
      color: 'var(--chart-1)',
    },
  }

  if (data.length === 0) {
    return (
      <div className='text-muted-foreground flex h-56 items-center justify-center text-sm sm:h-64'>
        {t('No data')}
      </div>
    )
  }

  return (
    <ChartContainer config={config} className='aspect-auto h-56 w-full sm:h-64'>
      <LineChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray='3 3' />
        <XAxis
          dataKey='time'
          tickLine={false}
          axisLine={false}
          minTickGap={32}
        />
        <YAxis
          yAxisId='rate'
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          width={42}
          tickFormatter={(value) => `${Math.round(Number(value))}%`}
        />
        <YAxis
          yAxisId='throughput'
          orientation='right'
          domain={[0, 'auto']}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(value) =>
            new Intl.NumberFormat(undefined, {
              notation: 'compact',
              maximumFractionDigits: 1,
            }).format(Number(value))
          }
        />
        <ReferenceLine
          yAxisId='rate'
          y={props.baseline}
          stroke='var(--muted-foreground)'
          strokeDasharray='4 4'
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                payload?.[0]?.payload?.fullTime ?? '--'
              }
              formatter={(value, name) => (
                <div className='flex flex-1 items-center justify-between gap-4'>
                  <span className='text-muted-foreground'>
                    {name === 'avg_tps' ? t('Throughput') : t('Cache hit rate')}
                  </span>
                  <span className='font-mono font-medium tabular-nums'>
                    {name === 'avg_tps'
                      ? formatThroughput(Number(value))
                      : formatPercent(Number(value))}
                  </span>
                </div>
              )}
            />
          }
        />
        <Line
          yAxisId='rate'
          type='monotone'
          dataKey='cache_hit_rate'
          stroke='var(--color-cache_hit_rate)'
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId='throughput'
          type='monotone'
          dataKey='avg_tps'
          stroke='var(--color-avg_tps)'
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  )
}

function CacheGroupStats(props: {
  groups: CacheMetricGroup[]
  baseline: number
  onSelect: (group: string) => void
}) {
  const { t } = useTranslation()
  const data = useMemo(
    () =>
      props.groups.map((group) => ({
        ...group,
        cache_hit_rate: group.request_count > 0 ? group.cache_hit_rate : 0,
      })),
    [props.groups]
  )
  const config = {
    cache_hit_rate: {
      label: t('Hit Rate'),
      color: 'var(--chart-2)',
    },
  }
  const longestGroupLabelWidth = data.reduce(
    (longest, group) => Math.max(longest, estimateAxisLabelWidth(group.group)),
    0
  )
  const categoryAxisWidth = Math.min(
    280,
    Math.max(112, longestGroupLabelWidth + 20)
  )
  const chartHeight = Math.max(256, data.length * 36 + 48)

  if (data.length === 0) {
    return (
      <div className='text-muted-foreground flex h-56 items-center justify-center text-sm sm:h-64'>
        {t('No data')}
      </div>
    )
  }

  return (
    <ChartContainer
      config={config}
      className='aspect-auto w-full [&_.recharts-surface]:outline-none! [&_.recharts-wrapper]:outline-none!'
      style={{ height: chartHeight }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <BarChart
        accessibilityLayer={false}
        data={data}
        layout='vertical'
        margin={{ top: 8, right: 28, bottom: 0, left: 0 }}
      >
        <CartesianGrid horizontal={false} strokeDasharray='3 3' />
        <XAxis
          type='number'
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `${Math.round(Number(value))}%`}
        />
        <YAxis
          type='category'
          dataKey='group'
          width={categoryAxisWidth}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={0}
        />
        <ReferenceLine
          x={props.baseline}
          stroke='var(--muted-foreground)'
          strokeDasharray='4 4'
        />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.45 }}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_, payload) =>
                String(payload?.[0]?.payload?.group ?? '')
              }
              formatter={(_, __, item) => {
                const group = item.payload as CacheMetricGroup
                const hasData = group.request_count > 0
                return (
                  <div className='grid min-w-44 gap-1.5'>
                    <div className='flex items-center justify-between gap-4'>
                      <span className='text-muted-foreground'>
                        {t('Hit Rate')}
                      </span>
                      <span className='font-mono font-medium tabular-nums'>
                        {hasData ? formatPercent(group.cache_hit_rate) : '--'}
                      </span>
                    </div>
                    <div className='flex items-center justify-between gap-4'>
                      <span className='text-muted-foreground'>
                        {t('Hits / Requests')}
                      </span>
                      <span className='font-mono font-medium tabular-nums'>
                        {formatCount(group.hit_count)} /{' '}
                        {formatCount(group.request_count)}
                      </span>
                    </div>
                    <div className='flex items-center justify-between gap-4'>
                      <span className='text-muted-foreground'>
                        {t('Cached tokens')}
                      </span>
                      <span className='font-mono font-medium tabular-nums'>
                        {formatCount(group.cached_tokens)}
                      </span>
                    </div>
                  </div>
                )
              }}
            />
          }
        />
        <Bar dataKey='cache_hit_rate' maxBarSize={24} radius={[0, 4, 4, 0]}>
          {data.map((group) => {
            let fill = 'var(--muted-foreground)'
            if (group.request_count > 0) {
              fill =
                group.cache_hit_rate >= props.baseline
                  ? 'var(--success)'
                  : 'var(--warning)'
            }
            return (
              <Cell
                key={group.group}
                fill={fill}
                className='cursor-pointer transition-[filter] hover:brightness-105'
                onClick={() => props.onSelect(group.group)}
              />
            )
          })}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

function SortableCacheGroupRow(props: {
  group: string
  selected: boolean
  checkboxDisabled: boolean
  dragDisabled: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const checkboxId = useId()
  const sortable = useSortable({
    id: props.group,
    disabled: props.dragDisabled,
    transition: {
      duration: 220,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
  })

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
        zIndex: sortable.isDragging ? 10 : undefined,
      }}
      className={cn(
        'hover:bg-accent relative flex items-center gap-2 rounded px-2 py-1 transition-[background-color,box-shadow,opacity]',
        sortable.isDragging && 'bg-accent z-10 opacity-70 shadow-md'
      )}
    >
      <label
        htmlFor={checkboxId}
        className='flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1'
      >
        <Checkbox
          id={checkboxId}
          checked={props.selected}
          disabled={props.checkboxDisabled}
          onCheckedChange={props.onToggle}
        />
        <span className='min-w-0 flex-1 text-sm [overflow-wrap:anywhere] break-words'>
          {props.group}
        </span>
      </label>
      <button
        type='button'
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        disabled={props.dragDisabled}
        className='text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 shrink-0 touch-none items-center justify-center rounded-md enabled:cursor-grab enabled:active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30'
        aria-label={t('Drag to reorder')}
        title={t('Drag to reorder')}
      >
        <GripVertical className='size-4' />
      </button>
    </div>
  )
}

export function CacheMonitor(props: {
  response: CacheMetricsResponse | null
  loading: boolean
  failed: boolean
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const [activeGroup, setActiveGroup] = useState('')
  const [baseline, setBaseline] = useState(DEFAULT_BASELINE)
  const [baselineDraft, setBaselineDraft] = useState(DEFAULT_BASELINE)
  const [savingBaseline, setSavingBaseline] = useState(false)
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [allGroupsDraft, setAllGroupsDraft] = useState(true)
  const [groupDraft, setGroupDraft] = useState<string[]>([])
  const [savingGroups, setSavingGroups] = useState(false)
  const groupDragSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  const groups = useMemo(() => {
    const responseGroups = props.response?.data.groups ?? []
    const groupMap = new Map(
      responseGroups.map((group) => [group.group, group])
    )
    return (props.response?.data.display_groups ?? []).map(
      (groupName): CacheMetricGroup =>
        groupMap.get(groupName) ?? {
          group: groupName,
          request_count: 0,
          hit_count: 0,
          cached_tokens: 0,
          cache_hit_rate: 0,
          avg_tps: 0,
          series: [],
        }
    )
  }, [props.response])
  const selectedGroup = groups.find((group) => group.group === activeGroup)

  useEffect(() => {
    const nextBaseline = props.response?.data.baseline ?? DEFAULT_BASELINE
    setBaseline(nextBaseline)
    setBaselineDraft(nextBaseline)
  }, [props.response?.data.baseline])

  useEffect(() => {
    if (!groups.some((group) => group.group === activeGroup)) {
      setActiveGroup(groups[0]?.group ?? '')
    }
  }, [activeGroup, groups])

  const handleSaveBaseline = () => {
    setSavingBaseline(true)
    return updateCacheHitRateBaseline(baselineDraft)
      .then((response) => {
        if (!response.success) return
        setBaseline(response.data.baseline)
        setBaselineDraft(response.data.baseline)
        toast.success(t('Setting updated successfully'))
      })
      .finally(() => {
        setSavingBaseline(false)
      })
  }

  const handleGroupsOpenChange = (open: boolean) => {
    setGroupsOpen(open)
    if (!open) return
    setAllGroupsDraft(props.response?.data.all_groups ?? true)
    setGroupDraft(props.response?.data.display_groups ?? [])
  }

  const handleToggleGroup = (group: string) => {
    setGroupDraft((current) => {
      if (current.includes(group)) {
        return current.filter((item) => item !== group)
      }
      return [...current, group]
    })
  }

  const handleGroupDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return

    setGroupDraft((current) => {
      const sourceIndex = current.indexOf(String(event.active.id))
      const targetIndex = current.indexOf(String(event.over?.id))
      if (sourceIndex < 0 || targetIndex < 0) return current
      return arrayMove(current, sourceIndex, targetIndex)
    })
  }

  const sortableGroups = useMemo(() => {
    const availableSet = new Set(props.response?.data.available_groups ?? [])
    return groupDraft.filter((group) => availableSet.has(group))
  }, [groupDraft, props.response?.data.available_groups])

  const orderedAvailableGroups = useMemo(() => {
    const availableGroups = props.response?.data.available_groups ?? []
    const selectedSet = new Set(sortableGroups)
    return [
      ...sortableGroups,
      ...availableGroups.filter((group) => !selectedSet.has(group)),
    ]
  }, [props.response?.data.available_groups, sortableGroups])

  const handleSaveGroups = () => {
    setSavingGroups(true)
    return updateCacheMonitorGroups(allGroupsDraft, groupDraft)
      .then((response) => {
        if (!response.success) return
        setGroupsOpen(false)
        toast.success(t('Setting updated successfully'))
        props.onRefresh()
      })
      .finally(() => setSavingGroups(false))
  }

  let content
  if (props.loading) {
    content = (
      <div className='mt-4 space-y-4'>
        <div className='grid grid-cols-2 gap-x-4 sm:grid-cols-4'>
          {['rate', 'hits', 'tokens', 'requests'].map((key) => (
            <Skeleton key={key} className='h-14 w-full' />
          ))}
        </div>
        <Skeleton className='h-48 w-full sm:h-56' />
        <Skeleton className='h-64 w-full sm:h-72' />
      </div>
    )
  } else if (props.failed) {
    content = (
      <div className='text-muted-foreground mt-4 py-12 text-center text-sm'>
        {t('Cache monitoring unavailable')}
      </div>
    )
  } else if (selectedGroup) {
    content = (
      <div className='mt-4'>
        <div className='grid grid-cols-2 gap-x-4 sm:grid-cols-4'>
          <CacheMetric
            icon={Gauge}
            label={t('Hit Rate')}
            value={formatPercent(selectedGroup.cache_hit_rate)}
          />
          <CacheMetric
            icon={Target}
            label={t('Cache hits')}
            value={formatCount(selectedGroup.hit_count)}
          />
          <CacheMetric
            icon={Zap}
            label={t('Cached tokens')}
            value={formatCount(selectedGroup.cached_tokens)}
          />
          <CacheMetric
            icon={Database}
            label={t('Cache requests')}
            value={formatCount(selectedGroup.request_count)}
          />
        </div>
        <div className='mt-5 grid min-w-0 gap-7'>
          <div className='min-w-0'>
            <div className='mb-3 flex flex-wrap items-end justify-between gap-2'>
              <h3 className='text-base font-semibold'>
                {t('Cache and throughput trend (last 24h)')}
              </h3>
              <div className='text-muted-foreground flex items-center gap-3 text-xs'>
                <span className='flex items-center gap-1.5'>
                  <span className='bg-chart-2 size-2 rounded-full' />
                  {t('Cache hit rate')}
                </span>
                <span className='flex items-center gap-1.5'>
                  <span className='bg-chart-1 size-2 rounded-full' />
                  t/s
                </span>
              </div>
            </div>
            <CacheTrend
              group={selectedGroup}
              baseline={baseline}
              bucketSeconds={props.response?.data.bucket_seconds ?? 3600}
              rangeStart={props.response?.data.start_ts}
              rangeEnd={props.response?.data.end_ts}
            />
          </div>
          <div className='min-w-0'>
            <h3 className='mb-3 text-base font-semibold'>
              {t('Displayed group cache statistics (last 24h)')}
            </h3>
            <CacheGroupStats
              groups={groups}
              baseline={baseline}
              onSelect={setActiveGroup}
            />
          </div>
        </div>
      </div>
    )
  } else {
    content = (
      <div className='text-muted-foreground mt-4 py-12 text-center text-sm'>
        {t('No data')}
      </div>
    )
  }

  return (
    <>
      <section className='min-w-0 py-1'>
        <div className='flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
          <div className='flex min-w-0 items-center gap-3'>
            <span className='bg-info/10 text-info flex size-9 shrink-0 items-center justify-center rounded-md'>
              <Database className='size-4' />
            </span>
            <div className='min-w-0'>
              <h2 className='truncate text-sm font-semibold'>
                {t('Cache hit rate')}
              </h2>
              {selectedGroup && selectedGroup.request_count > 0 ? (
                <StatusBadge
                  variant={
                    selectedGroup.cache_hit_rate >= baseline
                      ? 'success'
                      : 'warning'
                  }
                  copyable={false}
                  className='mt-1'
                >
                  {selectedGroup.cache_hit_rate >= baseline
                    ? t('Meets baseline')
                    : t('Below baseline')}
                </StatusBadge>
              ) : null}
            </div>
          </div>

          <div className='flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto'>
            {isAdmin ? (
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => handleGroupsOpenChange(true)}
              >
                <Settings2 />
                {t('Groups')}
              </Button>
            ) : null}
            <span className='text-muted-foreground shrink-0 text-xs'>
              {t('Baseline')}
            </span>
            {isAdmin ? (
              <Slider
                aria-label={t('Baseline')}
                className='min-w-28 flex-1 sm:w-40'
                min={0}
                max={100}
                step={1}
                value={[baselineDraft]}
                onValueChange={(value) => {
                  const next = Array.isArray(value) ? value[0] : value
                  setBaselineDraft(Number(next))
                }}
              />
            ) : null}
            <span className='w-10 shrink-0 text-right text-xs font-medium tabular-nums'>
              {isAdmin ? baselineDraft : baseline}%
            </span>
            {isAdmin ? (
              <Button
                size='sm'
                disabled={savingBaseline || baselineDraft === baseline}
                onClick={handleSaveBaseline}
              >
                <Save />
                {t('Save')}
              </Button>
            ) : null}
          </div>
        </div>

        {groups.length > 0 ? (
          <Tabs
            value={activeGroup}
            onValueChange={setActiveGroup}
            className='mt-4 min-w-0 [scrollbar-width:thin] overflow-x-auto pb-1'
          >
            <TabsList
              aria-label={t('Select group')}
              className='h-9 w-max min-w-full flex-nowrap justify-start gap-1 p-1 group-data-horizontal/tabs:h-9'
            >
              {groups.map((group) => (
                <TabsTrigger
                  key={group.group}
                  value={group.group}
                  className='h-7 flex-none px-3 py-1 whitespace-nowrap'
                >
                  <span>{group.group}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}

        {content}
      </section>

      {isAdmin ? (
        <Dialog open={groupsOpen} onOpenChange={handleGroupsOpenChange}>
          <DialogContent className='sm:max-w-md'>
            <DialogHeader>
              <DialogTitle>{t('Configure cache groups')}</DialogTitle>
              <DialogDescription>
                {t('Choose which groups are visible in cache analytics.')}
              </DialogDescription>
            </DialogHeader>

            <label className='hover:bg-accent flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5'>
              <Checkbox
                checked={allGroupsDraft}
                onCheckedChange={(checked) =>
                  setAllGroupsDraft(checked === true)
                }
              />
              <span className='min-w-0 text-sm font-medium'>
                {t('Automatically show all groups')}
              </span>
            </label>

            <DndContext
              sensors={groupDragSensors}
              collisionDetection={closestCenter}
              modifiers={CACHE_GROUP_DRAG_MODIFIERS}
              onDragEnd={handleGroupDragEnd}
            >
              <ScrollArea className='max-h-72 rounded-md border p-2'>
                <SortableContext
                  items={orderedAvailableGroups}
                  strategy={verticalListSortingStrategy}
                >
                  <div className='space-y-1'>
                    {orderedAvailableGroups.map((group) => {
                      const explicitlySelected = groupDraft.includes(group)
                      const selected = allGroupsDraft || explicitlySelected
                      return (
                        <SortableCacheGroupRow
                          key={group}
                          group={group}
                          selected={selected}
                          checkboxDisabled={allGroupsDraft}
                          dragDisabled={
                            allGroupsDraft ||
                            !explicitlySelected ||
                            sortableGroups.length <= 1
                          }
                          onToggle={() => handleToggleGroup(group)}
                        />
                      )
                    })}
                  </div>
                </SortableContext>
              </ScrollArea>
            </DndContext>

            <DialogFooter>
              <DialogClose render={<Button variant='outline' />}>
                {t('Cancel')}
              </DialogClose>
              <Button
                onClick={handleSaveGroups}
                disabled={
                  savingGroups || (!allGroupsDraft && groupDraft.length === 0)
                }
              >
                <Save />
                {savingGroups ? t('Saving...') : t('Save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
