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
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
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

function cacheGroupDotClass(group: CacheMetricGroup, baseline: number) {
  if (!group.has_data) return 'bg-muted-foreground/40'
  return group.cache_hit_rate >= baseline ? 'bg-success' : 'bg-warning'
}

function cachePulseClass(hasData: boolean, rate: number, baseline: number) {
  if (!hasData) return 'bg-muted-foreground/20'
  if (rate >= Math.max(baseline + 8, 92)) return 'bg-success'
  if (rate >= baseline) return 'bg-success/70'
  if (rate >= Math.max(50, baseline - 20)) return 'bg-warning'
  return 'bg-destructive/75'
}

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
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

function CacheGroupStats(props: {
  groups: CacheMetricGroup[]
  baseline: number
  countsVisible: boolean
  bucketSeconds: number
  rangeStart?: number
  rangeEnd?: number
  onSelect: (group: string) => void
}) {
  const { t } = useTranslation()
  const timeline = useMemo(() => {
    const timestamps = props.groups.flatMap((group) =>
      group.series.map((point) => point.ts)
    )
    if (timestamps.length > 0) {
      const start = Math.min(...timestamps)
      const end = Math.max(...timestamps)
      return buildCacheChartSeries(
        [
          {
            ts: start,
            cached_tokens: 0,
            cache_hit_rate: 0,
            avg_tps: 0,
            has_data: false,
          },
        ],
        props.bucketSeconds,
        start,
        end
      ).map((point) => ({ ...point, has_data: false }))
    }
    const rangeStart = props.rangeStart
    const rangeEnd = props.rangeEnd
    if (
      typeof rangeStart !== 'number' ||
      typeof rangeEnd !== 'number' ||
      !Number.isFinite(rangeStart) ||
      !Number.isFinite(rangeEnd) ||
      rangeStart >= rangeEnd
    ) {
      return []
    }
    const points = []
    for (
      let ts =
        Math.floor(rangeStart / props.bucketSeconds) * props.bucketSeconds;
      ts <= rangeEnd;
      ts += props.bucketSeconds
    ) {
      points.push({
        ts,
        request_count: null,
        hit_count: null,
        cached_tokens: null,
        cache_hit_rate: null,
        avg_tps: null,
        has_data: false,
        missing: true,
      })
    }
    return points
  }, [props.bucketSeconds, props.groups, props.rangeEnd, props.rangeStart])
  const rows = useMemo(() => {
    return props.groups.map((group) => {
      const first = timeline[0]?.ts
      const last = timeline.at(-1)?.ts
      const points =
        first != null && last != null
          ? buildCacheChartSeries(
              group.series,
              props.bucketSeconds,
              first,
              last
            )
          : []
      const pointsByTime = new Map(points.map((point) => [point.ts, point]))
      return {
        group,
        points: timeline.map(
          (point) => pointsByTime.get(point.ts) ?? { ...point }
        ),
      }
    })
  }, [props.bucketSeconds, props.groups, timeline])

  if (rows.length === 0) {
    return (
      <div className='text-muted-foreground flex h-56 items-center justify-center text-sm sm:h-64'>
        {t('No data')}
      </div>
    )
  }

  return (
    <>
      <div className='bg-muted/10 overflow-x-auto rounded-xl border'>
        <div className='min-w-[760px]'>
          <div className='bg-muted/30 text-muted-foreground grid grid-cols-[minmax(160px,1.25fr)_80px_84px_100px_minmax(260px,3fr)] items-center gap-3 border-b px-3 py-2 text-[11px] font-medium'>
            <span>{t('Group')}</span>
            <span>{t('Hit Rate')}</span>
            <span>t/s</span>
            <span>{t('Cached tokens')}</span>
            <span className='flex justify-between gap-3'>
              <span>{timeline[0] ? formatTime(timeline[0].ts) : '--'}</span>
              <span>
                {timeline.at(-1)?.ts != null
                  ? formatTime(timeline.at(-1)?.ts ?? 0)
                  : '--'}
              </span>
            </span>
          </div>
          {rows.map(({ group, points }) => (
            <div
              key={group.group}
              className={cn(
                'grid grid-cols-[minmax(160px,1.25fr)_80px_84px_100px_minmax(260px,3fr)] items-center gap-3 border-b px-3 py-2 last:border-b-0',
                'hover:bg-muted/20 cursor-pointer'
              )}
              onClick={() => props.onSelect(group.group)}
            >
              <div className='flex min-w-0 items-center gap-2'>
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    cacheGroupDotClass(group, props.baseline)
                  )}
                />
                <button
                  type='button'
                  className='min-w-0 truncate text-left text-xs font-semibold hover:underline'
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onSelect(group.group)
                  }}
                  title={group.group}
                >
                  {group.group}
                </button>
              </div>
              <span className='text-xs tabular-nums'>
                {group.has_data ? formatPercent(group.cache_hit_rate) : '--'}
              </span>
              <span className='text-xs tabular-nums'>
                {group.has_data ? formatThroughput(group.avg_tps) : '--'}
              </span>
              <span className='text-xs tabular-nums'>
                {group.has_data ? formatCount(group.cached_tokens) : '--'}
              </span>
              <div
                className='grid min-w-0 items-stretch gap-1'
                style={{
                  gridTemplateColumns: `repeat(${Math.max(1, points.length)}, minmax(8px, 1fr))`,
                }}
              >
                {points.map((point) => {
                  const hasData = point.has_data && !point.missing
                  const rate = point.cache_hit_rate ?? 0
                  const tone = cachePulseClass(hasData, rate, props.baseline)
                  const tooltip = hasData
                    ? `${formatTime(point.ts)}\n${t('Hit Rate')}: ${formatPercent(rate)}\nt/s: ${formatThroughput(point.avg_tps ?? 0)}\n${t('Cached tokens')}: ${formatCount(point.cached_tokens ?? 0)}${props.countsVisible ? `\n${t('Hits / Requests')}: ${formatCount(point.hit_count ?? 0)} / ${formatCount(point.request_count ?? 0)}` : ''}`
                    : `${formatTime(point.ts)}\n${t('No data')}`
                  return (
                    <span
                      key={point.ts}
                      className={cn('h-4 min-w-0 rounded-sm', tone)}
                      title={tooltip}
                      aria-label={tooltip}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className='text-muted-foreground mt-3 flex flex-wrap items-center gap-4 text-[11px]'>
        <span className='shrink-0'>{t('Cache hit rate')}</span>
        <span className='flex items-center gap-1.5'>
          <i className='bg-success size-2 rounded-full' />
          {t('Meets baseline')}
        </span>
        <span className='flex items-center gap-1.5'>
          <i className='bg-warning size-2 rounded-full' />
          {t('Below baseline')}
        </span>
        <span className='flex items-center gap-1.5'>
          <i className='bg-muted-foreground/30 size-2 rounded-full' />
          {t('No data')}
        </span>
      </div>
    </>
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
  const countsVisible = props.response?.data.counts_visible ?? isAdmin
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
          has_data: false,
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
        <div
          className={cn(
            'grid grid-cols-2 gap-x-4',
            countsVisible ? 'sm:grid-cols-5' : 'sm:grid-cols-3'
          )}
        >
          {(countsVisible
            ? ['rate', 'hits', 'throughput', 'tokens', 'requests']
            : ['rate', 'throughput', 'tokens']
          ).map((key) => (
            <Skeleton key={key} className='h-14 w-full' />
          ))}
        </div>
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
        <div
          className={cn(
            'grid grid-cols-2 gap-x-4',
            countsVisible ? 'sm:grid-cols-5' : 'sm:grid-cols-3'
          )}
        >
          <CacheMetric
            icon={Gauge}
            label={t('Hit Rate')}
            value={formatPercent(selectedGroup.cache_hit_rate)}
          />
          {countsVisible ? (
            <CacheMetric
              icon={Target}
              label={t('Cache hits')}
              value={formatCount(selectedGroup.hit_count ?? 0)}
            />
          ) : null}
          <CacheMetric
            icon={Zap}
            label={t('Throughput')}
            value={formatThroughput(selectedGroup.avg_tps)}
          />
          <CacheMetric
            icon={Database}
            label={t('Cached tokens')}
            value={formatCount(selectedGroup.cached_tokens)}
          />
          {countsVisible ? (
            <CacheMetric
              icon={Gauge}
              label={t('Cache requests')}
              value={formatCount(selectedGroup.request_count ?? 0)}
            />
          ) : null}
        </div>
        <div className='mt-5 min-w-0'>
          <h3 className='mb-3 text-base font-semibold'>
            {t('Displayed group cache statistics (last 24h)')}
          </h3>
          <CacheGroupStats
            groups={groups}
            baseline={baseline}
            countsVisible={countsVisible}
            bucketSeconds={props.response?.data.bucket_seconds ?? 3600}
            rangeStart={props.response?.data.start_ts}
            rangeEnd={props.response?.data.end_ts}
            onSelect={setActiveGroup}
          />
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
              {selectedGroup && selectedGroup.has_data ? (
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
