import dayjs from 'dayjs'
import {
  CalendarDays,
  CircleCheck,
  Dices,
  Flame,
  Gift,
  Loader2,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Trophy,
  Undo2,
} from 'lucide-react'
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Main } from '@/components/layout'
import {
  CardStaggerContainer,
  CardStaggerItem,
} from '@/components/page-transition'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useIsAdmin } from '@/hooks/use-admin'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  drawLottery,
  getAllLotteryDraws,
  getLotteryStatus,
  getUserLotteryDraws,
  revokeLotteryReward,
} from './api'
import { LotterySettingsDialog } from './lottery-settings-dialog'
import type {
  LotteryAdminDraw,
  LotteryDraw,
  LotteryDrawFilters,
  LotteryStatus,
} from './types'

const ADMIN_PAGE_SIZE = 20
const USER_PAGE_SIZE = 10
const MYSTERY_BOX_COUNT = 3
const DRAW_REVEAL_DELAY_MS = 1100
const EMPTY_DRAW_FILTERS: LotteryDrawFilters = { user: '', result: '' }

function drawResultLabel(
  draw: LotteryDraw,
  t: ReturnType<typeof useTranslation>['t']
) {
  return draw.quota > 0
    ? t('Won {{amount}}', { amount: formatQuota(draw.quota) })
    : t('No prize')
}

function percent(value: number, target: number) {
  if (target <= 0) return 0
  return Math.min(100, Math.max(0, (value / target) * 100))
}

function resultFilterLabel(
  value: 'all' | 'won' | 'none',
  t: ReturnType<typeof useTranslation>['t']
) {
  if (value === 'won') return t('Won')
  if (value === 'none') return t('No prize')
  return t('All results')
}

function normalizedDrawStatus(draw: LotteryDraw) {
  if (draw.status === 'revoked' || draw.revoked_at > 0) return 'revoked'
  if (draw.quota > 0) return 'awarded'
  return 'no_prize'
}

function drawStatusConfig(
  status: ReturnType<typeof normalizedDrawStatus>,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (status === 'revoked') {
    return { label: t('Reversed'), variant: 'warning' as const }
  }
  if (status === 'awarded') {
    return { label: t('Awarded'), variant: 'success' as const }
  }
  return { label: t('No prize'), variant: 'neutral' as const }
}

export function Lottery() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const [status, setStatus] = useState<LotteryStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [drawing, setDrawing] = useState(false)
  const [selectedBox, setSelectedBox] = useState<number | null>(null)
  const [latestDraw, setLatestDraw] = useState<LotteryDraw | null>(null)
  const [pendingDraw, setPendingDraw] = useState<LotteryDraw | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recordScope, setRecordScope] = useState<'mine' | 'all'>('mine')
  const [displayedRecordScope, setDisplayedRecordScope] = useState<
    'mine' | 'all'
  >('mine')
  const [adminDraws, setAdminDraws] = useState<LotteryAdminDraw[]>([])
  const [adminDrawsLoading, setAdminDrawsLoading] = useState(false)
  const [hasLoadedAdminDraws, setHasLoadedAdminDraws] = useState(false)
  const [adminPage, setAdminPage] = useState(1)
  const [adminTotal, setAdminTotal] = useState(0)
  const [userDraws, setUserDraws] = useState<LotteryDraw[]>([])
  const [userDrawsLoading, setUserDrawsLoading] = useState(true)
  const [hasLoadedUserDraws, setHasLoadedUserDraws] = useState(false)
  const [userDrawPage, setUserDrawPage] = useState(1)
  const [userDrawTotal, setUserDrawTotal] = useState(0)
  const [drawUserKeyword, setDrawUserKeyword] = useState('')
  const [drawResultFilter, setDrawResultFilter] = useState<
    'all' | 'won' | 'none'
  >('all')
  const [appliedDrawFilters, setAppliedDrawFilters] =
    useState<LotteryDrawFilters>(EMPTY_DRAW_FILTERS)
  const adminDrawRequestId = useRef(0)
  const userDrawRequestId = useRef(0)
  const [revokeDraw, setRevokeDraw] = useState<LotteryAdminDraw | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [revoking, setRevoking] = useState(false)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getLotteryStatus()
      if (!response.success || !response.data) {
        toast.error(t(response.message || 'Failed to load lottery status'))
        return
      }
      setStatus(response.data)
    } catch {
      toast.error(t('Failed to load lottery status'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const loadUserDraws = useCallback(async () => {
    const requestId = ++userDrawRequestId.current
    setUserDrawsLoading(true)
    try {
      const response = await getUserLotteryDraws(userDrawPage, USER_PAGE_SIZE)
      if (requestId !== userDrawRequestId.current) return
      if (!response.success || !response.data) {
        toast.error(t(response.message || 'Failed to load lottery records'))
        return
      }
      setUserDraws(response.data.items || [])
      setUserDrawTotal(response.data.total || 0)
      setHasLoadedUserDraws(true)
    } catch {
      if (requestId === userDrawRequestId.current) {
        toast.error(t('Failed to load lottery records'))
      }
    } finally {
      if (requestId === userDrawRequestId.current) {
        setUserDrawsLoading(false)
      }
    }
  }, [t, userDrawPage])

  useEffect(() => {
    void loadUserDraws()
  }, [loadUserDraws])

  const loadAdminDraws = useCallback(async () => {
    if (!isAdmin || recordScope !== 'all') return
    const requestId = ++adminDrawRequestId.current
    setAdminDrawsLoading(true)
    try {
      const response = await getAllLotteryDraws(
        adminPage,
        ADMIN_PAGE_SIZE,
        appliedDrawFilters
      )
      if (requestId !== adminDrawRequestId.current) return
      if (!response.success || !response.data) {
        toast.error(t(response.message || 'Failed to load lottery records'))
        return
      }
      setAdminDraws(response.data.items || [])
      setAdminTotal(response.data.total || 0)
      setDisplayedRecordScope('all')
      setHasLoadedAdminDraws(true)
    } catch {
      if (requestId === adminDrawRequestId.current) {
        toast.error(t('Failed to load lottery records'))
      }
    } finally {
      if (requestId === adminDrawRequestId.current) {
        setAdminDrawsLoading(false)
      }
    }
  }, [adminPage, appliedDrawFilters, isAdmin, recordScope, t])

  useEffect(() => {
    void loadAdminDraws()
  }, [loadAdminDraws])

  const handleDrawSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAdminPage(1)
    setAppliedDrawFilters({
      user: drawUserKeyword.trim(),
      result: drawResultFilter === 'all' ? '' : drawResultFilter,
    })
  }

  const handleResetDrawSearch = () => {
    setDrawUserKeyword('')
    setDrawResultFilter('all')
    setAdminPage(1)
    setAppliedDrawFilters({ ...EMPTY_DRAW_FILTERS })
  }

  const activity = useMemo(() => {
    const byDate = new Map(
      (status?.recent_activity || []).map((item) => [item.date, item])
    )
    return Array.from({ length: 7 }, (_, index) => {
      const date = dayjs()
        .subtract(6 - index, 'day')
        .format('YYYY-MM-DD')
      return (
        byDate.get(date) || {
          id: 0,
          date,
          quota: 0,
          active: false,
        }
      )
    })
  }, [status?.recent_activity])

  const handleDraw = async (boxIndex: number) => {
    if (!status || status.available_chances <= 0 || drawing) return
    setDrawing(true)
    setSelectedBox(boxIndex)
    setLatestDraw(null)
    setPendingDraw(null)
    try {
      const response = await drawLottery()
      if (!response.success || !response.data) {
        toast.error(t(response.message || 'Lottery draw failed'))
        setDrawing(false)
        setSelectedBox(null)
        return
      }
      const result = response.data
      setPendingDraw(result.draw)
      setStatus(result.status)
      if (userDrawPage === 1) {
        setUserDraws((current) =>
          [result.draw, ...current].slice(0, USER_PAGE_SIZE)
        )
        setUserDrawTotal((current) => current + 1)
      }
    } catch {
      toast.error(t('Lottery draw failed'))
      setDrawing(false)
      setSelectedBox(null)
    }
  }

  useEffect(() => {
    if (!pendingDraw) return
    const timer = window.setTimeout(() => {
      setLatestDraw(pendingDraw)
      setPendingDraw(null)
      setDrawing(false)
      if (pendingDraw.prize === 'none') {
        toast.info(t('No prize this time'))
        return
      }
      toast.success(
        t('Congratulations! You won {{prize}}', {
          prize: formatQuota(pendingDraw.quota),
        })
      )
    }, DRAW_REVEAL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [pendingDraw, t])

  const handleRevokeReward = async () => {
    if (!revokeDraw) return
    const reason = revokeReason.trim()
    if (reason.length < 2) {
      toast.error(t('Please enter a reversal reason'))
      return
    }
    setRevoking(true)
    try {
      const response = await revokeLotteryReward(revokeDraw.id, reason)
      if (!response.success) {
        toast.error(t(response.message || 'Failed to reverse lottery reward'))
        return
      }
      toast.success(t('Lottery reward reversed'))
      setRevokeDraw(null)
      setRevokeReason('')
      await loadAdminDraws()
      if (userDrawPage === 1) {
        await loadUserDraws()
      }
    } catch {
      toast.error(t('Failed to reverse lottery reward'))
    } finally {
      setRevoking(false)
    }
  }

  const weeklyProgress = percent(
    status?.weekly_spend_quota || 0,
    status?.weekly_target_quota || 0
  )
  const dailyProgress = percent(
    status?.today_spend_quota || 0,
    status?.daily_active_quota || 0
  )
  const showingAllRecords = isAdmin && displayedRecordScope === 'all'
  const visibleDraws: Array<LotteryDraw | LotteryAdminDraw> = showingAllRecords
    ? adminDraws
    : userDraws
  const recordsLoading = showingAllRecords
    ? adminDrawsLoading && !hasLoadedAdminDraws
    : userDrawsLoading && !hasLoadedUserDraws
  const recordTotal = showingAllRecords ? adminTotal : userDrawTotal
  const recordsRefreshing = showingAllRecords
    ? adminDrawsLoading
    : userDrawsLoading
  const adminTotalPages = Math.max(1, Math.ceil(adminTotal / ADMIN_PAGE_SIZE))
  const userTotalPages = Math.max(1, Math.ceil(userDrawTotal / USER_PAGE_SIZE))
  const recordColumnCount = showingAllRecords ? 7 : 4

  return (
    <Main>
      <div className='min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-6'>
        <CardStaggerContainer className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-6'>
          <CardStaggerItem>
            <div className='flex items-start justify-between gap-3'>
              <div className='flex min-w-0 flex-col gap-1'>
                <h1 className='flex items-center gap-2 text-xl font-semibold'>
                  <Dices className='text-primary size-5' aria-hidden='true' />
                  {t('Lottery Center')}
                </h1>
                <p className='text-muted-foreground text-sm'>
                  {t(
                    'Earn chances through weekly usage and activity streaks, then draw quota rewards.'
                  )}
                </p>
              </div>
              {isAdmin ? (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={loading || (status?.prizes.length || 0) !== 4}
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings aria-hidden='true' />
                  {t('Lottery settings')}
                </Button>
              ) : null}
            </div>
          </CardStaggerItem>

          <div className='grid min-w-0 items-stretch gap-4 lg:grid-cols-[minmax(360px,0.82fr)_minmax(0,1.18fr)]'>
            <CardStaggerItem className='h-full'>
              <Card
                data-card-hover='false'
                className='h-full gap-0 overflow-hidden py-0'
                data-testid='lottery-mystery-card'
              >
                <CardHeader className='flex-row items-center justify-between space-y-0 border-b py-4'>
                  <CardTitle className='flex items-center gap-2 text-base'>
                    <Gift className='text-primary size-4' aria-hidden='true' />
                    {t('Mystery gifts')}
                  </CardTitle>
                  <div className='flex items-center gap-2 text-sm'>
                    <Sparkles
                      className='text-warning size-4'
                      aria-hidden='true'
                    />
                    <span className='text-muted-foreground hidden sm:inline'>
                      {t('Available chances')}
                    </span>
                    {loading ? (
                      <Skeleton className='h-6 w-10' />
                    ) : (
                      <strong className='text-lg tabular-nums'>
                        {status?.available_chances || 0}
                      </strong>
                    )}
                  </div>
                </CardHeader>
                <CardContent className='flex flex-1 flex-col items-center justify-center px-4 py-7 sm:px-7'>
                  <div className='grid w-full max-w-md grid-cols-3 gap-3 sm:gap-4'>
                    {Array.from(
                      { length: MYSTERY_BOX_COUNT },
                      (_, boxIndex) => {
                        const selected = selectedBox === boxIndex
                        const revealed = selected && latestDraw !== null
                        const subdued = latestDraw !== null && !selected
                        return (
                          <button
                            key={boxIndex}
                            type='button'
                            data-testid='lottery-mystery-box'
                            data-state={
                              selected && drawing
                                ? 'drawing'
                                : revealed
                                  ? 'revealed'
                                  : 'idle'
                            }
                            aria-label={t('Mystery box {{index}}', {
                              index: boxIndex + 1,
                            })}
                            disabled={
                              loading ||
                              drawing ||
                              (status?.available_chances || 0) <= 0
                            }
                            onClick={() => void handleDraw(boxIndex)}
                            className={cn(
                              'group bg-background relative isolate flex aspect-square min-w-0 items-center justify-center overflow-hidden rounded-md border p-3 transition-[border-color,background-color,box-shadow,opacity] duration-300 outline-none',
                              'hover:border-primary/45 hover:bg-primary/[0.03] hover:shadow-sm focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2',
                              'disabled:pointer-events-none disabled:cursor-not-allowed',
                              selected &&
                                drawing &&
                                'border-primary/60 bg-primary/[0.04] shadow-primary/10 motion-safe:animate-pulse shadow-md',
                              revealed &&
                                'border-success/45 bg-success/[0.04] shadow-success/10 shadow-md',
                              subdued && 'opacity-30'
                            )}
                          >
                            <span className='relative z-10 flex min-h-16 items-center justify-center'>
                              {selected && drawing ? (
                                <span className='bg-primary/8 flex size-14 items-center justify-center rounded-full'>
                                  <Loader2
                                    className='text-primary size-7 animate-spin'
                                    aria-hidden='true'
                                  />
                                </span>
                              ) : revealed ? (
                                <span className='flex flex-col items-center gap-1 text-center'>
                                  <span className='bg-success/10 flex size-10 items-center justify-center rounded-full'>
                                    <Sparkles
                                      className='text-success size-5'
                                      aria-hidden='true'
                                    />
                                  </span>
                                  <strong className='text-sm leading-tight tabular-nums sm:text-base'>
                                    {latestDraw.quota > 0
                                      ? formatQuota(latestDraw.quota)
                                      : t('No prize')}
                                  </strong>
                                </span>
                              ) : (
                                <span className='bg-muted group-hover:bg-primary/8 flex size-14 items-center justify-center rounded-full transition-colors duration-300'>
                                  <Gift
                                    className='text-muted-foreground group-hover:text-primary size-7 transition-colors duration-300'
                                    aria-hidden='true'
                                  />
                                </span>
                              )}
                            </span>
                          </button>
                        )
                      }
                    )}
                  </div>
                  <div className='mt-5 min-h-6 text-center text-sm font-medium'>
                    {latestDraw
                      ? drawResultLabel(latestDraw, t)
                      : t('One chance is consumed per draw')}
                  </div>
                </CardContent>
              </Card>
            </CardStaggerItem>

            <div
              className='grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2'
              data-testid='lottery-rules-grid'
            >
              <CardStaggerItem className='h-full'>
                <Card data-card-hover='false' className='h-full gap-0 py-0'>
                  <CardHeader className='border-b py-4'>
                    <CardTitle className='flex items-center gap-2 text-base'>
                      <Trophy className='text-chart-2 size-4' />
                      {t('Weekly lottery chances')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-3 py-4'>
                    <div className='flex items-end justify-between gap-3'>
                      <div>
                        <p className='text-muted-foreground text-xs'>
                          {t('Weekly spending')}
                        </p>
                        <div className='mt-1 text-lg font-semibold tabular-nums'>
                          {loading ? (
                            <Skeleton className='h-7 w-28' />
                          ) : (
                            formatQuota(status?.weekly_spend_quota || 0)
                          )}
                        </div>
                      </div>
                      <StatusBadge variant='info' size='lg'>
                        {t('{{earned}} / {{limit}} chances', {
                          earned: status?.weekly_earned_chances || 0,
                          limit: status?.weekly_chance_limit || 5,
                        })}
                      </StatusBadge>
                    </div>
                    <Progress value={weeklyProgress} />
                    <p className='text-muted-foreground text-xs leading-5'>
                      {t(
                        'Earn 1 chance for every 50.00 Yuan spent each week, up to 5 chances.'
                      )}
                    </p>
                  </CardContent>
                </Card>
              </CardStaggerItem>

              <CardStaggerItem className='h-full'>
                <Card data-card-hover='false' className='h-full gap-0 py-0'>
                  <CardHeader className='border-b py-4'>
                    <CardTitle className='flex items-center gap-2 text-base'>
                      <CalendarDays className='text-chart-3 size-4' />
                      {t('Daily activity')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-3 py-4'>
                    <div className='flex items-center justify-between gap-3'>
                      <div>
                        <p className='text-muted-foreground text-xs'>
                          {t('Today spent')}
                        </p>
                        <div className='mt-1 font-semibold tabular-nums'>
                          {loading ? (
                            <Skeleton className='h-6 w-24' />
                          ) : (
                            formatQuota(status?.today_spend_quota || 0)
                          )}
                        </div>
                      </div>
                      <StatusBadge
                        variant={status?.today_active ? 'success' : 'neutral'}
                        size='lg'
                      >
                        {status?.today_active
                          ? t('Active today')
                          : t('Not active yet')}
                      </StatusBadge>
                    </div>
                    <Progress value={dailyProgress} />
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        'Spend 20.00 Yuan in a single day to mark that day as active.'
                      )}
                    </p>
                  </CardContent>
                </Card>
              </CardStaggerItem>

              <CardStaggerItem className='h-full xl:col-span-2'>
                <Card data-card-hover='false' className='h-full gap-0 py-0'>
                  <CardHeader className='flex-row items-center justify-between space-y-0 border-b py-4'>
                    <CardTitle className='flex items-center gap-2 text-base'>
                      <Flame
                        className='text-warning size-4'
                        aria-hidden='true'
                      />
                      {t('Activity streak')}
                    </CardTitle>
                    <div
                      className='flex items-baseline gap-1'
                      data-testid='lottery-current-streak'
                    >
                      <strong className='text-lg tabular-nums'>
                        {status?.current_streak || 0}
                      </strong>
                      <span className='text-muted-foreground text-xs'>
                        {(status?.current_streak || 0) === 1
                          ? t('day')
                          : t('days')}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className='flex flex-1 flex-col gap-4 py-4'>
                    <p className='text-muted-foreground text-xs'>
                      {t('Current streak')}
                    </p>
                    <div className='grid grid-cols-7 gap-2'>
                      {activity.map((day) => (
                        <div
                          key={day.date}
                          className='flex min-w-0 flex-col items-center gap-1.5'
                          title={day.date}
                        >
                          <div
                            className={cn(
                              'flex size-7 items-center justify-center rounded-full border',
                              day.active
                                ? 'border-success/30 bg-success/10 text-success'
                                : 'text-muted-foreground'
                            )}
                          >
                            {day.active ? (
                              <CircleCheck className='size-4' />
                            ) : (
                              <span className='size-1.5 rounded-full bg-current opacity-40' />
                            )}
                          </div>
                          <span className='text-muted-foreground text-[10px]'>
                            {day.date.slice(5)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className='mt-auto grid divide-y border-t sm:grid-cols-2 sm:divide-x sm:divide-y-0'>
                      <div className='pt-3 sm:pr-4'>
                        <span className='text-sm font-medium'>
                          {t('3-day streak')}
                        </span>
                        <p className='text-muted-foreground mt-0.5 text-xs'>
                          {t('Reward: 1 lottery chance')}
                        </p>
                      </div>
                      <div className='pt-3 sm:pl-4'>
                        <span className='text-sm font-medium'>
                          {t('7-day streak')}
                        </span>
                        <p className='text-muted-foreground mt-0.5 text-xs'>
                          {t('Reward: 3 lottery chances')}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </CardStaggerItem>
            </div>
          </div>

          <CardStaggerItem>
            <Card data-card-hover='false' className='gap-0 py-0'>
              <CardHeader className='flex-row flex-wrap items-center justify-between gap-3 border-b py-4'>
                <CardTitle className='text-base'>
                  {t('Lottery records')}
                </CardTitle>
                <div className='flex items-center gap-3'>
                  {isAdmin ? (
                    <Tabs
                      value={recordScope}
                      onValueChange={(value) => {
                        const nextScope = value as 'mine' | 'all'
                        setRecordScope(nextScope)
                        if (
                          (nextScope === 'mine' && hasLoadedUserDraws) ||
                          (nextScope === 'all' && hasLoadedAdminDraws)
                        ) {
                          setDisplayedRecordScope(nextScope)
                        }
                        if (nextScope === 'all') {
                          setAdminPage(1)
                        } else {
                          setUserDrawPage(1)
                        }
                      }}
                    >
                      <TabsList>
                        <TabsTrigger value='mine'>
                          {t('My records')}
                        </TabsTrigger>
                        <TabsTrigger value='all'>
                          {t('All records')}
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  ) : null}
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {recordsRefreshing ? (
                      <Loader2
                        className='mr-1 inline size-3.5 animate-spin'
                        aria-label={t('Loading')}
                      />
                    ) : null}
                    {t('{{count}} records', { count: recordTotal })}
                  </span>
                </div>
              </CardHeader>
              <CardContent className='p-0'>
                {isAdmin && recordScope === 'all' ? (
                  <form
                    className='grid gap-2 border-b p-3 sm:grid-cols-[minmax(220px,1fr)_180px_auto]'
                    onSubmit={handleDrawSearch}
                  >
                    <Input
                      value={drawUserKeyword}
                      onChange={(event) =>
                        setDrawUserKeyword(event.target.value)
                      }
                      placeholder={t('Search user by username or ID')}
                      aria-label={t('Search user by username or ID')}
                      data-testid='lottery-user-search'
                    />
                    <Select
                      value={drawResultFilter}
                      onValueChange={(value) =>
                        setDrawResultFilter(value as 'all' | 'won' | 'none')
                      }
                    >
                      <SelectTrigger aria-label={t('Result')}>
                        <SelectValue>
                          {resultFilterLabel(drawResultFilter, t)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectItem value='all'>{t('All results')}</SelectItem>
                        <SelectItem value='won'>{t('Won')}</SelectItem>
                        <SelectItem value='none'>{t('No prize')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className='flex gap-2'>
                      <Button
                        type='submit'
                        size='sm'
                        disabled={adminDrawsLoading}
                      >
                        <Search aria-hidden='true' />
                        {t('Search')}
                      </Button>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        disabled={adminDrawsLoading}
                        onClick={handleResetDrawSearch}
                      >
                        <RotateCcw aria-hidden='true' />
                        {t('Reset')}
                      </Button>
                    </div>
                  </form>
                ) : null}
                <Table>
                  <TableHeader>
                    <TableRow>
                      {showingAllRecords ? (
                        <TableHead>{t('User')}</TableHead>
                      ) : null}
                      <TableHead>{t('Result')}</TableHead>
                      <TableHead>{t('Reward')}</TableHead>
                      <TableHead>{t('Status')}</TableHead>
                      {showingAllRecords ? (
                        <TableHead>{t('Reference')}</TableHead>
                      ) : null}
                      <TableHead>{t('Time')}</TableHead>
                      {showingAllRecords ? (
                        <TableHead className='text-right'>
                          {t('Actions')}
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recordsLoading ? (
                      <TableRow>
                        <TableCell colSpan={recordColumnCount}>
                          <Skeleton
                            className='h-8 w-full'
                            data-testid='lottery-records-skeleton'
                          />
                        </TableCell>
                      </TableRow>
                    ) : visibleDraws.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={recordColumnCount} className='p-0'>
                          <Empty className='min-h-44 rounded-none py-8'>
                            <EmptyHeader>
                              <EmptyMedia variant='icon'>
                                <Trophy className='size-4' aria-hidden='true' />
                              </EmptyMedia>
                              <EmptyTitle className='tracking-normal'>
                                {t('No lottery results yet')}
                              </EmptyTitle>
                              <EmptyDescription>
                                {t(
                                  'Your lottery results will appear here after each draw.'
                                )}
                              </EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        </TableCell>
                      </TableRow>
                    ) : (
                      visibleDraws.map((draw) => {
                        const drawStatus = normalizedDrawStatus(draw)
                        const statusConfig = drawStatusConfig(drawStatus, t)
                        const adminDraw = draw as LotteryAdminDraw
                        return (
                          <TableRow key={draw.id}>
                            {showingAllRecords ? (
                              <TableCell>
                                <div className='font-medium'>
                                  {adminDraw.username || '-'}
                                </div>
                                <div className='text-muted-foreground text-xs tabular-nums'>
                                  ID: {adminDraw.user_id}
                                </div>
                              </TableCell>
                            ) : null}
                            <TableCell>
                              <StatusBadge
                                variant={
                                  draw.prize === 'none' ? 'neutral' : 'success'
                                }
                              >
                                {draw.prize === 'none'
                                  ? t('No prize')
                                  : t('Won')}
                              </StatusBadge>
                            </TableCell>
                            <TableCell className='font-medium tabular-nums'>
                              {draw.quota > 0 ? formatQuota(draw.quota) : '-'}
                            </TableCell>
                            <TableCell>
                              <StatusBadge variant={statusConfig.variant}>
                                {statusConfig.label}
                              </StatusBadge>
                            </TableCell>
                            {showingAllRecords ? (
                              <TableCell>
                                <code
                                  className='text-muted-foreground block max-w-52 truncate text-xs'
                                  title={adminDraw.event_reference}
                                >
                                  {adminDraw.event_reference || '-'}
                                </code>
                                {drawStatus === 'revoked' ? (
                                  <div
                                    className='text-muted-foreground mt-1 max-w-52 truncate text-xs'
                                    title={adminDraw.revoke_reason}
                                  >
                                    {adminDraw.revoke_reason}
                                  </div>
                                ) : null}
                              </TableCell>
                            ) : null}
                            <TableCell className='text-muted-foreground'>
                              {formatTimestampToDate(draw.created_at)}
                            </TableCell>
                            {showingAllRecords ? (
                              <TableCell className='text-right'>
                                {draw.quota > 0 && drawStatus !== 'revoked' ? (
                                  <Button
                                    type='button'
                                    variant='outline'
                                    size='sm'
                                    onClick={() => {
                                      setRevokeReason('')
                                      setRevokeDraw(adminDraw)
                                    }}
                                  >
                                    <Undo2 aria-hidden='true' />
                                    {t('Reverse reward')}
                                  </Button>
                                ) : (
                                  <span className='text-muted-foreground'>
                                    -
                                  </span>
                                )}
                              </TableCell>
                            ) : null}
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
                {!recordsLoading ? (
                  <div
                    className='flex items-center justify-between border-t px-4 py-3 text-sm'
                    data-testid='lottery-records-pagination'
                  >
                    <span className='text-muted-foreground tabular-nums'>
                      {showingAllRecords ? adminPage : userDrawPage} /{' '}
                      {showingAllRecords ? adminTotalPages : userTotalPages}
                    </span>
                    <div className='flex gap-2'>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        disabled={
                          showingAllRecords
                            ? adminPage <= 1 || adminDrawsLoading
                            : userDrawPage <= 1 || userDrawsLoading
                        }
                        onClick={() =>
                          showingAllRecords
                            ? setAdminPage((page) => page - 1)
                            : setUserDrawPage((page) => page - 1)
                        }
                      >
                        {t('Previous')}
                      </Button>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        disabled={
                          showingAllRecords
                            ? adminPage >= adminTotalPages || adminDrawsLoading
                            : userDrawPage >= userTotalPages || userDrawsLoading
                        }
                        onClick={() =>
                          showingAllRecords
                            ? setAdminPage((page) => page + 1)
                            : setUserDrawPage((page) => page + 1)
                        }
                      >
                        {t('Next')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </CardStaggerItem>
        </CardStaggerContainer>
      </div>
      <LotterySettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        prizes={status?.prizes || []}
        onSaved={(prizes) =>
          setStatus((current) => (current ? { ...current, prizes } : current))
        }
      />
      <ConfirmDialog
        open={revokeDraw !== null}
        onOpenChange={(open) => {
          if (!open && !revoking) {
            setRevokeDraw(null)
            setRevokeReason('')
          }
        }}
        title={t('Reverse lottery reward')}
        desc={t(
          'The awarded quota will be deducted and a linked reversal transaction will be created. The original record will remain.'
        )}
        confirmText={t('Confirm reversal')}
        destructive
        disabled={revokeReason.trim().length < 2}
        isLoading={revoking}
        handleConfirm={() => void handleRevokeReward()}
      >
        <div className='space-y-2'>
          {revokeDraw ? (
            <div className='bg-muted/50 rounded-md border px-3 py-2 text-sm'>
              <div className='font-medium'>
                {revokeDraw.username || `ID: ${revokeDraw.user_id}`}
              </div>
              <div className='text-muted-foreground mt-1 font-mono text-xs break-all'>
                {revokeDraw.event_reference}
              </div>
              <div className='mt-1 font-medium tabular-nums'>
                -{formatQuota(revokeDraw.quota)}
              </div>
            </div>
          ) : null}
          <Textarea
            value={revokeReason}
            onChange={(event) => setRevokeReason(event.target.value)}
            placeholder={t('Reason')}
            aria-label={t('Reason')}
            maxLength={200}
          />
        </div>
      </ConfirmDialog>
    </Main>
  )
}
