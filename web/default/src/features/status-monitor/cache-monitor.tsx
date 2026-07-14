import { Database, Gauge, Save, Target, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
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
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useIsAdmin } from '@/hooks/use-admin'

import { updateCacheHitRateBaseline } from './api'
import type { CacheMetricGroup, CacheMetricsResponse } from './types'

const ALL_CACHE_GROUPS = 'all'
const DEFAULT_BASELINE = 85

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

function CacheTrend(props: { group: CacheMetricGroup; baseline: number }) {
  const { t } = useTranslation()
  const data = useMemo(
    () =>
      props.group.series.map((point) => ({
        ...point,
        time: formatTime(point.ts),
        fullTime: new Date(point.ts * 1000).toLocaleString(undefined, {
          hourCycle: 'h23',
        }),
      })),
    [props.group.series]
  )
  const config = {
    cache_hit_rate: {
      label: t('Cache hit rate'),
      color: 'var(--chart-2)',
    },
  }

  if (data.length === 0) {
    return (
      <div className='text-muted-foreground flex h-48 items-center justify-center border-y border-dashed text-sm sm:h-56'>
        {t('No data')}
      </div>
    )
  }

  return (
    <ChartContainer config={config} className='aspect-auto h-48 w-full sm:h-56'>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray='3 3' />
        <XAxis
          dataKey='time'
          tickLine={false}
          axisLine={false}
          minTickGap={32}
        />
        <YAxis
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          width={42}
          tickFormatter={(value) => `${Math.round(Number(value))}%`}
        />
        <ReferenceLine
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
              formatter={(value) => (
                <span className='font-mono font-medium tabular-nums'>
                  {formatPercent(Number(value))}
                </span>
              )}
            />
          }
        />
        <Line
          type='monotone'
          dataKey='cache_hit_rate'
          stroke='var(--color-cache_hit_rate)'
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

function CacheRequestTrend(props: { group: CacheMetricGroup }) {
  const { t } = useTranslation()
  const data = useMemo(
    () =>
      props.group.series.map((point) => ({
        ...point,
        time: formatTime(point.ts),
        fullTime: new Date(point.ts * 1000).toLocaleString(undefined, {
          hourCycle: 'h23',
        }),
      })),
    [props.group.series]
  )
  const config = {
    request_count: {
      label: t('Cache requests'),
      color: 'var(--chart-1)',
    },
    hit_count: {
      label: t('Cache hits'),
      color: 'var(--chart-2)',
    },
  }

  if (data.length === 0) {
    return (
      <div className='text-muted-foreground flex h-48 items-center justify-center border-y border-dashed text-sm sm:h-56'>
        {t('No data')}
      </div>
    )
  }

  return (
    <ChartContainer config={config} className='aspect-auto h-48 w-full sm:h-56'>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray='3 3' />
        <XAxis
          dataKey='time'
          tickLine={false}
          axisLine={false}
          minTickGap={32}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                payload?.[0]?.payload?.fullTime ?? '--'
              }
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey='request_count'
          fill='var(--color-request_count)'
          radius={[3, 3, 0, 0]}
          maxBarSize={24}
          isAnimationActive={false}
        />
        <Bar
          dataKey='hit_count'
          fill='var(--color-hit_count)'
          radius={[3, 3, 0, 0]}
          maxBarSize={24}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  )
}

export function CacheMonitor(props: {
  response: CacheMetricsResponse | null
  loading: boolean
  failed: boolean
}) {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const [activeGroup, setActiveGroup] = useState(ALL_CACHE_GROUPS)
  const [baseline, setBaseline] = useState(DEFAULT_BASELINE)
  const [baselineDraft, setBaselineDraft] = useState(DEFAULT_BASELINE)
  const [savingBaseline, setSavingBaseline] = useState(false)
  const groups = useMemo(
    () => props.response?.data.groups ?? [],
    [props.response]
  )
  const selectedGroup =
    activeGroup === ALL_CACHE_GROUPS
      ? props.response?.data.total
      : groups.find((group) => group.group === activeGroup)

  useEffect(() => {
    const nextBaseline = props.response?.data.baseline ?? DEFAULT_BASELINE
    setBaseline(nextBaseline)
    setBaselineDraft(nextBaseline)
  }, [props.response?.data.baseline])

  useEffect(() => {
    if (
      activeGroup !== ALL_CACHE_GROUPS &&
      !groups.some((group) => group.group === activeGroup)
    ) {
      setActiveGroup(ALL_CACHE_GROUPS)
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
      </div>
    )
  } else if (props.failed) {
    content = (
      <div className='text-muted-foreground mt-4 border-y border-dashed py-12 text-center text-sm'>
        {t('Cache monitoring unavailable')}
      </div>
    )
  } else if (selectedGroup && selectedGroup.request_count > 0) {
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
        <div className='mt-5 grid min-w-0 gap-5 xl:grid-cols-2'>
          <div className='min-w-0'>
            <div className='mb-3 text-sm font-medium'>
              {t('Cache hit trend (last 24h)')}
            </div>
            <CacheTrend group={selectedGroup} baseline={baseline} />
          </div>
          <div className='min-w-0'>
            <div className='mb-3 text-sm font-medium'>
              {t('Cache request trend (last 24h)')}
            </div>
            <CacheRequestTrend group={selectedGroup} />
          </div>
        </div>
      </div>
    )
  } else {
    content = (
      <div className='text-muted-foreground mt-4 border-y border-dashed py-12 text-center text-sm'>
        {t('No data')}
      </div>
    )
  }

  return (
    <section className='min-w-0 border-y py-4 sm:py-5'>
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

        <div className='flex w-full items-center justify-end gap-3 sm:w-auto'>
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
          className='mt-4'
        >
          <TabsList className='max-w-full [scrollbar-width:none] flex-nowrap justify-start overflow-x-auto group-data-horizontal/tabs:h-auto [&::-webkit-scrollbar]:hidden'>
            <TabsTrigger value={ALL_CACHE_GROUPS}>{t('All')}</TabsTrigger>
            {groups.map((group) => (
              <TabsTrigger key={group.group} value={group.group}>
                <span className='max-w-32 truncate'>{group.group}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {content}
    </section>
  )
}
