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
  getAllLotteryGrants,
  getLotteryStatus,
  getUserLotteryDraws,
  revokeLotteryReward,
} from './api'
import { LotterySettingsDialog } from './lottery-settings-dialog'
import { ManualLotteryGrantDialog } from './manual-lottery-grant-dialog'
import type {
  LotteryAdminGrant,
  LotteryAdminDraw,
  LotteryDraw,
  LotteryDrawFilters,
  LotteryGrantFilters,
  LotteryGrantSource,
  LotteryGrantStatus,
  LotteryStatus,
} from './types'

const ADMIN_PAGE_SIZE = 20
const USER_PAGE_SIZE = 10
const LOTTERY_GRID_SIZE = 9
const LOTTERY_GRID_CENTER = 4
const LOTTERY_GRID_ROUTE = [0, 1, 2, 5, 8, 7, 6, 3] as const
// Let the draw animation complete a few rotations before revealing the result.
// The API response is already available, so this delay only affects the visual
// presentation and is skipped when the request itself fails.
const DRAW_REVEAL_DELAY_MS = 2400
const EMPTY_DRAW_FILTERS: LotteryDrawFilters = { user: '', result: '' }
const EMPTY_GRANT_FILTERS: LotteryGrantFilters = {
  user: '',
  source: '',
  status: '',
}

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

function grantSourceFilterLabel(
  value: LotteryGrantSource,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (value === 'recharge') return t('Recharge grant')
  if (value === 'event') return t('Event grant')
  if (value === 'weekly') return t('Weekly usage reward')
  if (value === 'streak') return t('Activity streak reward')
  if (value === 'manual') return t('Manual grant')
  return t('All sources')
}

function grantStatusFilterLabel(
  value: LotteryGrantStatus,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (value === 'available') return t('Available')
  if (value === 'used') return t('Used')
  if (value === 'expired') return t('Expired')
  return t('All statuses')
}

function campaignStatus(
  rule: { start_at: number; end_at: number },
  now: number,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (rule.start_at > 0 && now < rule.start_at) {
    return { label: t('Not Started'), variant: 'info' as const }
  }
  if (rule.end_at > 0 && now >= rule.end_at) {
    return { label: t('Expired'), variant: 'neutral' as const }
  }
  return { label: t('In progress'), variant: 'success' as const }
}

function rechargeGrantLimitLabel(
  limit: string | undefined,
  t: ReturnType<typeof useTranslation>['t']
) {
  switch (limit) {
    case 'daily':
      return t('Once per day')
    case 'unlimited':
      return t('Every qualifying recharge')
    case 'cumulative':
    default:
      return t('Once per campaign')
  }
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

function grantSourceLabel(
  grant: Pick<LotteryAdminGrant, 'type' | 'source_name'>,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (grant.type === 'manual') return t('Manual grant')
  if (grant.source_name) return grant.source_name
  if (grant.type === 'weekly_spend') return t('Weekly usage reward')
  if (grant.type.startsWith('streak_')) return t('Activity streak reward')
  if (grant.type.startsWith('recharge_')) return t('Recharge grant')
  if (grant.type.startsWith('campaign_')) return t('Event grant')
  return grant.type || '-'
}

function grantStatusConfig(
  grant: LotteryAdminGrant,
  now: number,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (grant.expires_at > 0 && grant.expires_at <= now) {
    return { label: t('Expired'), variant: 'neutral' as const }
  }
  if (grant.consumed >= grant.chances) {
    return { label: t('Used'), variant: 'info' as const }
  }
  return { label: t('Available'), variant: 'success' as const }
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
  const [manualGrantOpen, setManualGrantOpen] = useState(false)
  const [recordView, setRecordView] = useState<'draws' | 'grants'>('draws')
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
  const [adminGrants, setAdminGrants] = useState<LotteryAdminGrant[]>([])
  const [adminGrantsLoading, setAdminGrantsLoading] = useState(false)
  const [hasLoadedAdminGrants, setHasLoadedAdminGrants] = useState(false)
  const [grantPage, setGrantPage] = useState(1)
  const [grantTotal, setGrantTotal] = useState(0)
  const [grantUserKeyword, setGrantUserKeyword] = useState('')
  const [grantSourceFilter, setGrantSourceFilter] =
    useState<LotteryGrantSource>('')
  const [grantStatusFilter, setGrantStatusFilter] =
    useState<LotteryGrantStatus>('')
  const [appliedGrantFilters, setAppliedGrantFilters] =
    useState<LotteryGrantFilters>(EMPTY_GRANT_FILTERS)
  const adminDrawRequestId = useRef(0)
  const adminGrantRequestId = useRef(0)
  const userDrawRequestId = useRef(0)
  const drawStartedAt = useRef(0)
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

  const loadAdminGrants = useCallback(
    async (requestedPage = grantPage) => {
      if (!isAdmin || recordView !== 'grants') return
      const requestId = ++adminGrantRequestId.current
      setAdminGrantsLoading(true)
      try {
        const response = await getAllLotteryGrants(
          requestedPage,
          ADMIN_PAGE_SIZE,
          appliedGrantFilters
        )
        if (requestId !== adminGrantRequestId.current) return
        if (!response.success || !response.data) {
          toast.error(
            t(response.message || 'Failed to load chance grant records')
          )
          return
        }
        setAdminGrants(response.data.items || [])
        setGrantTotal(response.data.total || 0)
        setHasLoadedAdminGrants(true)
      } catch {
        if (requestId === adminGrantRequestId.current) {
          toast.error(t('Failed to load chance grant records'))
        }
      } finally {
        if (requestId === adminGrantRequestId.current) {
          setAdminGrantsLoading(false)
        }
      }
    },
    [appliedGrantFilters, grantPage, isAdmin, recordView, t]
  )

  useEffect(() => {
    void loadAdminGrants()
  }, [loadAdminGrants])

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

  const handleGrantSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setGrantPage(1)
    setAppliedGrantFilters({
      user: grantUserKeyword.trim(),
      source: grantSourceFilter,
      status: grantStatusFilter,
    })
  }

  const handleResetGrantSearch = () => {
    setGrantUserKeyword('')
    setGrantSourceFilter('')
    setGrantStatusFilter('')
    setGrantPage(1)
    setAppliedGrantFilters({ ...EMPTY_GRANT_FILTERS })
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

  const handleDraw = async () => {
    if (!status || status.available_chances <= 0 || drawing) return
    drawStartedAt.current = Date.now()
    setDrawing(true)
    setSelectedBox(LOTTERY_GRID_ROUTE[0])
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
    if (!drawing) return
    const timer = window.setInterval(() => {
      setSelectedBox((current) => {
        const routeIndex = LOTTERY_GRID_ROUTE.indexOf(
          current as (typeof LOTTERY_GRID_ROUTE)[number]
        )
        return LOTTERY_GRID_ROUTE[(routeIndex + 1) % LOTTERY_GRID_ROUTE.length]
      })
    }, 110)
    return () => window.clearInterval(timer)
  }, [drawing])

  useEffect(() => {
    if (!pendingDraw) return
    const remainingDelay = Math.max(
      0,
      DRAW_REVEAL_DELAY_MS - (Date.now() - drawStartedAt.current)
    )
    const timer = window.setTimeout(() => {
      setSelectedBox(
        LOTTERY_GRID_ROUTE[Math.abs(pendingDraw.id) % LOTTERY_GRID_ROUTE.length]
      )
      setLatestDraw(pendingDraw)
      setPendingDraw(null)
      setDrawing(false)
      if (pendingDraw.quota <= 0) {
        toast.info(t('No prize this time'))
        return
      }
      toast.success(
        t('Congratulations! You won {{prize}}', {
          prize: formatQuota(pendingDraw.quota),
        })
      )
    }, remainingDelay)
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
  const showingGrantRecords = isAdmin && recordView === 'grants'
  const displayedRecordTotal = showingGrantRecords ? grantTotal : recordTotal
  const displayedRecordsRefreshing = showingGrantRecords
    ? adminGrantsLoading
    : recordsRefreshing
  const campaignRules = status?.grant_rules ?? status?.active_grant_rules ?? []
  const campaignNow = Math.floor(Date.now() / 1000)
  const adminTotalPages = Math.max(1, Math.ceil(adminTotal / ADMIN_PAGE_SIZE))
  const grantTotalPages = Math.max(1, Math.ceil(grantTotal / ADMIN_PAGE_SIZE))
  const userTotalPages = Math.max(1, Math.ceil(userDrawTotal / USER_PAGE_SIZE))
  const recordColumnCount = showingGrantRecords ? 7 : showingAllRecords ? 7 : 4

  return (
    <Main>
      <div className='min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-6'>
        <CardStaggerContainer className='mx-auto flex w-full max-w-6xl flex-col gap-4 sm:gap-6'>
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
                  disabled={loading}
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings aria-hidden='true' />
                  {t('Lottery settings')}
                </Button>
              ) : null}
            </div>
          </CardStaggerItem>

          <div className='grid min-w-0 gap-4 lg:grid-cols-[minmax(340px,0.94fr)_minmax(0,1.06fr)] lg:items-start'>
            <CardStaggerItem className='h-fit'>
              <Card
                data-card-hover='false'
                className='gap-0 overflow-hidden py-0'
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
                <CardContent className='flex flex-col items-center px-4 py-5 sm:px-6'>
                  <div className='grid w-full max-w-xs grid-cols-3 gap-2 sm:gap-2.5'>
                    {Array.from(
                      { length: LOTTERY_GRID_SIZE },
                      (_, boxIndex) => {
                        const selected = selectedBox === boxIndex
                        const revealed = selected && latestDraw !== null
                        const subdued = latestDraw !== null && !selected
                        const isCenter = boxIndex === LOTTERY_GRID_CENTER
                        return (
                          <button
                            key={boxIndex}
                            type='button'
                            data-lottery-grid-cell='true'
                            data-testid={
                              isCenter
                                ? 'lottery-draw-button'
                                : boxIndex < 3
                                  ? 'lottery-mystery-box'
                                  : undefined
                            }
                            data-state={
                              isCenter && drawing
                                ? 'drawing'
                                : revealed
                                  ? 'revealed'
                                  : 'idle'
                            }
                            aria-label={
                              isCenter
                                ? t('Draw now')
                                : t('Mystery box {{index}}', {
                                    index: boxIndex + 1,
                                  })
                            }
                            disabled={
                              !isCenter ||
                              loading ||
                              drawing ||
                              (status?.available_chances || 0) <= 0
                            }
                            onClick={() => void handleDraw()}
                            className={cn(
                              'group bg-background relative isolate flex aspect-square min-w-0 items-center justify-center overflow-hidden rounded-md border p-1.5 transition-[border-color,background-color,box-shadow,opacity] duration-300 outline-none sm:p-2',
                              'hover:border-primary/45 hover:bg-primary/[0.03] hover:shadow-sm focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2',
                              'disabled:pointer-events-none disabled:cursor-not-allowed',
                              isCenter &&
                                'border-primary/30 bg-primary/[0.04] shadow-primary/5 shadow-sm',
                              selected &&
                                drawing &&
                                'border-primary bg-primary/10 ring-primary/25 shadow-primary/15 shadow-md ring-2',
                              drawing && !selected && !isCenter && 'opacity-55',
                              revealed &&
                                'border-success/45 bg-success/[0.04] shadow-success/10 shadow-md',
                              subdued && !isCenter && 'opacity-35'
                            )}
                          >
                            <span className='relative z-10 flex min-h-16 items-center justify-center'>
                              {revealed ? (
                                <span className='motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75 flex flex-col items-center gap-1 text-center motion-safe:duration-500'>
                                  <span className='bg-success/10 flex size-8 items-center justify-center rounded-full'>
                                    <Sparkles
                                      className='text-success size-4'
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
                                <span
                                  className={cn(
                                    'flex items-center justify-center rounded-full transition-colors duration-300',
                                    isCenter
                                      ? 'bg-primary/10 size-12'
                                      : 'bg-muted group-hover:bg-primary/8 size-10 sm:size-11'
                                  )}
                                >
                                  {isCenter ? (
                                    <span className='flex flex-col items-center gap-1'>
                                      <Dices
                                        className={cn(
                                          'text-primary size-6',
                                          drawing &&
                                            'motion-safe:animate-bounce'
                                        )}
                                        aria-hidden='true'
                                      />
                                      <span className='text-primary text-[11px] font-medium'>
                                        {drawing
                                          ? t('Drawing...')
                                          : t('Draw now')}
                                      </span>
                                    </span>
                                  ) : (
                                    <Gift
                                      className={cn(
                                        'size-5 transition-colors duration-150 sm:size-6',
                                        selected && drawing
                                          ? 'text-primary'
                                          : 'text-muted-foreground group-hover:text-primary'
                                      )}
                                      aria-hidden='true'
                                    />
                                  )}
                                </span>
                              )}
                            </span>
                          </button>
                        )
                      }
                    )}
                  </div>
                  <div className='mt-4 flex min-h-5 items-center justify-center text-center text-sm font-medium'>
                    {drawing ? (
                      <span
                        className='text-primary inline-flex items-center gap-2'
                        role='status'
                        aria-live='polite'
                        data-testid='lottery-draw-progress'
                      >
                        <span>{t('Drawing...')}</span>
                        <span
                          className='inline-flex items-end gap-1'
                          aria-hidden='true'
                        >
                          <i className='bg-primary size-1.5 rounded-full motion-safe:animate-bounce' />
                          <i className='bg-primary size-1.5 rounded-full [animation-delay:120ms] motion-safe:animate-bounce' />
                          <i className='bg-primary size-1.5 rounded-full [animation-delay:240ms] motion-safe:animate-bounce' />
                        </span>
                        <span
                          className='bg-primary/10 inline-flex h-1.5 w-14 items-stretch gap-0.5 overflow-hidden rounded-full p-0.5'
                          aria-hidden='true'
                        >
                          <i className='bg-primary/70 flex-1 rounded-full motion-safe:animate-pulse' />
                          <i className='bg-primary/45 flex-1 rounded-full [animation-delay:120ms] motion-safe:animate-pulse' />
                          <i className='bg-primary/25 flex-1 rounded-full [animation-delay:240ms] motion-safe:animate-pulse' />
                        </span>
                      </span>
                    ) : latestDraw ? (
                      <span className='motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300'>
                        {drawResultLabel(latestDraw, t)}
                      </span>
                    ) : (
                      t('One chance is consumed per draw')
                    )}
                  </div>
                </CardContent>
              </Card>
            </CardStaggerItem>

            <div
              className='grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2'
              data-testid='lottery-rules-grid'
            >
              <CardStaggerItem className='h-full min-h-44'>
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
                          limit: status?.weekly_chance_limit ?? 0,
                        })}
                      </StatusBadge>
                    </div>
                    <Progress value={weeklyProgress} />
                    <p className='text-muted-foreground text-xs leading-5'>
                      {t(
                        'Earn 1 chance for every {{amount}} spent each week, up to {{limit}} chances.',
                        {
                          amount: `${(status?.rules?.weekly_spend_amount ?? 50).toFixed(2)} ${t('Yuan')}`,
                          limit: status?.weekly_chance_limit ?? 0,
                        }
                      )}
                    </p>
                  </CardContent>
                </Card>
              </CardStaggerItem>

              <CardStaggerItem className='h-full min-h-44'>
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
                        'Spend {{amount}} in a single day to mark that day as active.',
                        {
                          amount: `${(status?.rules?.daily_active_amount ?? 20).toFixed(2)} ${t('Yuan')}`,
                        }
                      )}
                    </p>
                  </CardContent>
                </Card>
              </CardStaggerItem>

              <CardStaggerItem className='h-full min-h-44 xl:col-span-2'>
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
                    <div className='mt-auto grid gap-2 border-t pt-3 sm:grid-cols-2'>
                      {(status?.rules?.streak_rewards || []).map((reward) => (
                        <div
                          key={reward.days}
                          className='rounded-md border px-3 py-2'
                        >
                          <span className='text-sm font-medium'>
                            {t('{{days}}-day streak', { days: reward.days })}
                          </span>
                          <p className='text-muted-foreground mt-0.5 text-xs'>
                            {t('Reward: {{count}} lottery chances', {
                              count: reward.chances,
                            })}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </CardStaggerItem>
            </div>
          </div>

          <CardStaggerItem>
            <Card data-card-hover='false' className='gap-0 py-0'>
              <CardHeader className='border-b py-4'>
                <CardTitle className='flex items-center gap-2 text-base'>
                  <Sparkles className='text-warning size-4' />
                  {t('Campaign')}
                </CardTitle>
              </CardHeader>
              {campaignRules.length > 0 ? (
                <CardContent className='grid items-stretch gap-3 py-4 sm:grid-cols-2 lg:grid-cols-3'>
                  {campaignRules.map((rule) => {
                    const state = campaignStatus(rule, campaignNow, t)
                    return (
                      <div
                        key={rule.id}
                        className='flex h-full min-w-0 flex-col gap-2 rounded-md border px-3 py-3'
                      >
                        <div className='flex min-h-7 items-center justify-between gap-3'>
                          <span className='min-w-0 truncate text-sm font-medium'>
                            {rule.name || t('Campaign')}
                          </span>
                          <div className='flex shrink-0 items-center gap-1.5'>
                            <StatusBadge variant='info'>
                              {t('{{count}} chances', { count: rule.chances })}
                            </StatusBadge>
                            <StatusBadge variant={state.variant}>
                              {state.label}
                            </StatusBadge>
                          </div>
                        </div>
                        <div className='text-muted-foreground space-y-1 text-xs leading-5'>
                          {rule.type === 'recharge' ? (
                            <>
                              <p>
                                {t('Recharge threshold')}:{' '}
                                <span className='text-foreground font-medium'>
                                  {`${rule.threshold.toFixed(2)} ${t('Yuan')}`}
                                </span>
                              </p>
                              <p>
                                {t('Grant frequency')}:{' '}
                                <span className='text-foreground font-medium'>
                                  {rechargeGrantLimitLabel(rule.limit, t)}
                                </span>
                              </p>
                            </>
                          ) : (
                            <>
                              <p>{t('Receive once during the event')}</p>
                              {rule.reclaim ? (
                                <p>
                                  {t('After the event ends')}:{' '}
                                  <span className='text-foreground font-medium'>
                                    {t('Reclaim unused chances')}
                                  </span>
                                </p>
                              ) : null}
                            </>
                          )}
                        </div>
                        <div className='text-muted-foreground flex min-w-0 items-start gap-1.5 border-t pt-2 text-xs leading-5'>
                          <CalendarDays
                            className='text-primary mt-0.5 size-3.5 shrink-0'
                            aria-hidden='true'
                          />
                          <span className='min-w-0 break-words'>
                            {t('Validity Period')}:{' '}
                            {rule.start_at > 0
                              ? formatTimestampToDate(rule.start_at)
                              : t('Effective immediately')}
                            {' - '}
                            {rule.end_at > 0
                              ? formatTimestampToDate(rule.end_at)
                              : t('Never expires')}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              ) : (
                <CardContent className='text-muted-foreground flex min-h-28 items-center justify-center py-6 text-sm'>
                  {t('No campaigns currently')}
                </CardContent>
              )}
            </Card>
          </CardStaggerItem>

          <CardStaggerItem>
            <Card data-card-hover='false' className='gap-0 py-0'>
              <CardHeader className='flex-row flex-wrap items-center justify-between gap-3 border-b py-4'>
                <CardTitle className='text-base'>
                  {showingGrantRecords
                    ? t('Chance grant records')
                    : t('Lottery records')}
                </CardTitle>
                <div className='flex flex-wrap items-center justify-end gap-2'>
                  {isAdmin ? (
                    <Tabs
                      value={recordView}
                      onValueChange={(value) => {
                        const nextView = value as 'draws' | 'grants'
                        setRecordView(nextView)
                        if (nextView === 'grants') setGrantPage(1)
                      }}
                    >
                      <TabsList>
                        <TabsTrigger value='draws'>
                          {t('Draw records')}
                        </TabsTrigger>
                        <TabsTrigger value='grants'>
                          {t('Chance grant records')}
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  ) : null}
                  {isAdmin ? (
                    <Tabs
                      value={recordScope}
                      className={showingGrantRecords ? 'hidden' : undefined}
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
                  {showingGrantRecords ? (
                    <Button
                      type='button'
                      size='sm'
                      onClick={() => setManualGrantOpen(true)}
                    >
                      <Gift aria-hidden='true' />
                      {t('Manual grant')}
                    </Button>
                  ) : null}
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {displayedRecordsRefreshing ? (
                      <Loader2
                        className='mr-1 inline size-3.5 animate-spin'
                        aria-label={t('Loading')}
                      />
                    ) : null}
                    {t('{{count}} records', { count: displayedRecordTotal })}
                  </span>
                </div>
              </CardHeader>
              <CardContent className='p-0'>
                {showingGrantRecords ? (
                  <form
                    className='grid gap-2 border-b p-3 md:grid-cols-[minmax(200px,1fr)_170px_150px_auto]'
                    onSubmit={handleGrantSearch}
                  >
                    <Input
                      value={grantUserKeyword}
                      onChange={(event) =>
                        setGrantUserKeyword(event.target.value)
                      }
                      placeholder={t('Search user by username or ID')}
                      aria-label={t('Search user by username or ID')}
                      data-testid='lottery-grant-user-search'
                    />
                    <Select
                      value={grantSourceFilter || 'all'}
                      onValueChange={(value) =>
                        setGrantSourceFilter(
                          value === 'all' ? '' : (value as LotteryGrantSource)
                        )
                      }
                    >
                      <SelectTrigger aria-label={t('Source')}>
                        <SelectValue>
                          {grantSourceFilterLabel(grantSourceFilter, t)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectItem value='all'>{t('All sources')}</SelectItem>
                        <SelectItem value='recharge'>
                          {t('Recharge grant')}
                        </SelectItem>
                        <SelectItem value='event'>
                          {t('Event grant')}
                        </SelectItem>
                        <SelectItem value='weekly'>
                          {t('Weekly usage reward')}
                        </SelectItem>
                        <SelectItem value='streak'>
                          {t('Activity streak reward')}
                        </SelectItem>
                        <SelectItem value='manual'>
                          {t('Manual grant')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={grantStatusFilter || 'all'}
                      onValueChange={(value) =>
                        setGrantStatusFilter(
                          value === 'all' ? '' : (value as LotteryGrantStatus)
                        )
                      }
                    >
                      <SelectTrigger aria-label={t('Status')}>
                        <SelectValue>
                          {grantStatusFilterLabel(grantStatusFilter, t)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectItem value='all'>{t('All statuses')}</SelectItem>
                        <SelectItem value='available'>
                          {t('Available')}
                        </SelectItem>
                        <SelectItem value='used'>{t('Used')}</SelectItem>
                        <SelectItem value='expired'>{t('Expired')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className='flex gap-2'>
                      <Button
                        type='submit'
                        size='sm'
                        disabled={adminGrantsLoading}
                      >
                        <Search aria-hidden='true' />
                        {t('Search')}
                      </Button>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        disabled={adminGrantsLoading}
                        onClick={handleResetGrantSearch}
                      >
                        <RotateCcw aria-hidden='true' />
                        {t('Reset')}
                      </Button>
                    </div>
                  </form>
                ) : isAdmin && recordScope === 'all' ? (
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
                    {showingGrantRecords ? (
                      <TableRow>
                        <TableHead>{t('User')}</TableHead>
                        <TableHead>{t('Source')}</TableHead>
                        <TableHead>{t('Granted')}</TableHead>
                        <TableHead>{t('Used / Remaining')}</TableHead>
                        <TableHead>{t('Status')}</TableHead>
                        <TableHead>{t('Grant time')}</TableHead>
                        <TableHead>{t('Expires at')}</TableHead>
                      </TableRow>
                    ) : (
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
                    )}
                  </TableHeader>
                  <TableBody>
                    {showingGrantRecords ? (
                      adminGrantsLoading && !hasLoadedAdminGrants ? (
                        <TableRow>
                          <TableCell colSpan={recordColumnCount}>
                            <Skeleton
                              className='h-8 w-full'
                              data-testid='lottery-grants-skeleton'
                            />
                          </TableCell>
                        </TableRow>
                      ) : adminGrants.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={recordColumnCount}
                            className='p-0'
                          >
                            <Empty className='min-h-44 rounded-none py-8'>
                              <EmptyHeader>
                                <EmptyMedia variant='icon'>
                                  <Gift className='size-4' aria-hidden='true' />
                                </EmptyMedia>
                                <EmptyTitle className='tracking-normal'>
                                  {t('No chance grant records')}
                                </EmptyTitle>
                                <EmptyDescription>
                                  {t(
                                    'Issued lottery chances will appear here.'
                                  )}
                                </EmptyDescription>
                              </EmptyHeader>
                            </Empty>
                          </TableCell>
                        </TableRow>
                      ) : (
                        adminGrants.map((grant) => {
                          const statusConfig = grantStatusConfig(
                            grant,
                            Math.floor(Date.now() / 1000),
                            t
                          )
                          const remaining = Math.max(
                            0,
                            grant.chances - grant.consumed
                          )
                          return (
                            <TableRow key={grant.id}>
                              <TableCell>
                                <div className='font-medium'>
                                  {grant.username || '-'}
                                </div>
                                <div className='text-muted-foreground text-xs tabular-nums'>
                                  ID: {grant.user_id}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className='font-medium'>
                                  {grantSourceLabel(grant, t)}
                                </div>
                                {grant.detail ? (
                                  <div
                                    className='text-muted-foreground mt-0.5 max-w-52 truncate text-xs'
                                    title={grant.detail}
                                  >
                                    {t('Reason')}: {grant.detail}
                                  </div>
                                ) : null}
                                {grant.operator_user_id > 0 ? (
                                  <div className='text-muted-foreground text-xs tabular-nums'>
                                    {t('Operator Admin')} #
                                    {grant.operator_user_id}
                                  </div>
                                ) : null}
                                <code
                                  className='text-muted-foreground block max-w-52 truncate text-xs'
                                  title={grant.event_reference}
                                >
                                  {grant.event_reference}
                                </code>
                              </TableCell>
                              <TableCell className='font-medium tabular-nums'>
                                {grant.chances}
                              </TableCell>
                              <TableCell className='tabular-nums'>
                                {grant.consumed} / {remaining}
                              </TableCell>
                              <TableCell>
                                <StatusBadge variant={statusConfig.variant}>
                                  {statusConfig.label}
                                </StatusBadge>
                              </TableCell>
                              <TableCell className='text-muted-foreground'>
                                {formatTimestampToDate(grant.created_at)}
                              </TableCell>
                              <TableCell className='text-muted-foreground'>
                                {grant.expires_at > 0
                                  ? formatTimestampToDate(grant.expires_at)
                                  : t('Never expires')}
                              </TableCell>
                            </TableRow>
                          )
                        })
                      )
                    ) : recordsLoading ? (
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
                                  draw.quota <= 0 ? 'neutral' : 'success'
                                }
                              >
                                {draw.quota <= 0 ? t('No prize') : t('Won')}
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
                {(
                  showingGrantRecords
                    ? !(adminGrantsLoading && !hasLoadedAdminGrants)
                    : !recordsLoading
                ) ? (
                  <div
                    className='flex items-center justify-between border-t px-4 py-3 text-sm'
                    data-testid='lottery-records-pagination'
                  >
                    <span className='text-muted-foreground tabular-nums'>
                      {showingGrantRecords
                        ? grantPage
                        : showingAllRecords
                          ? adminPage
                          : userDrawPage}{' '}
                      /{' '}
                      {showingGrantRecords
                        ? grantTotalPages
                        : showingAllRecords
                          ? adminTotalPages
                          : userTotalPages}
                    </span>
                    <div className='flex gap-2'>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        disabled={
                          showingGrantRecords
                            ? grantPage <= 1 || adminGrantsLoading
                            : showingAllRecords
                              ? adminPage <= 1 || adminDrawsLoading
                              : userDrawPage <= 1 || userDrawsLoading
                        }
                        onClick={() =>
                          showingGrantRecords
                            ? setGrantPage((page) => page - 1)
                            : showingAllRecords
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
                          showingGrantRecords
                            ? grantPage >= grantTotalPages || adminGrantsLoading
                            : showingAllRecords
                              ? adminPage >= adminTotalPages ||
                                adminDrawsLoading
                              : userDrawPage >= userTotalPages ||
                                userDrawsLoading
                        }
                        onClick={() =>
                          showingGrantRecords
                            ? setGrantPage((page) => page + 1)
                            : showingAllRecords
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
        onSaved={(config) => {
          setStatus((current) =>
            current
              ? { ...current, prizes: config.prizes, rules: config.rules }
              : current
          )
          void loadStatus()
        }}
      />
      <ManualLotteryGrantDialog
        open={manualGrantOpen}
        onOpenChange={setManualGrantOpen}
        onSuccess={async () => {
          setGrantPage(1)
          await Promise.all([loadAdminGrants(1), loadStatus()])
        }}
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
