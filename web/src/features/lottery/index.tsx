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
  ChevronDown,
  CircleCheck,
  Dices,
  Flame,
  Gift,
  History,
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
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Main } from '@/components/layout'
import {
  CardStaggerContainer,
  CardStaggerItem,
} from '@/components/page-transition'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { createDialogHandle, DialogTrigger } from '@/components/ui/dialog'
import { IconBadge } from '@/components/ui/icon-badge'
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
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota, formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import {
  drawLottery,
  getAllLotteryDraws,
  getAllLotteryGrants,
  getLotteryStatus,
  getUserLotteryDraws,
  revokeLotteryReward,
} from './api'
import { LotteryPrizeShowcase } from './lottery-prize-showcase'
import { LotterySettingsDialog } from './lottery-settings-dialog'
import { ManualLotteryGrantDialog } from './manual-lottery-grant-dialog'
import type {
  LotteryAdminGrant,
  LotteryAdminDraw,
  LotteryChanceGrantRule,
  LotteryDraw,
  LotteryDrawFilters,
  LotteryGrantFilters,
  LotteryGrantSource,
  LotteryGrantStatus,
  LotteryStatus,
} from './types'

const ADMIN_PAGE_SIZE = 20
const USER_PAGE_SIZE = 10
// Keep each request within the server's MaxLotteryDrawCount limit.
const MAX_DRAW_BATCH_SIZE = 100
const EMPTY_GRANT_RULES: LotteryChanceGrantRule[] = []
// Give the opening animation time to play before revealing the result.
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
  const { t, i18n } = useTranslation()
  const isAdmin = useIsAdmin()
  const currencyConfig = useSystemConfigStore((store) => store.config.currency)
  const [status, setStatus] = useState<LotteryStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [drawing, setDrawing] = useState(false)
  const [drawStartStatus, setDrawStartStatus] = useState<LotteryStatus | null>(
    null
  )
  const [latestDraw, setLatestDraw] = useState<LotteryDraw | null>(null)
  const [pendingDraws, setPendingDraws] = useState<LotteryDraw[] | null>(null)
  const [batchDraws, setBatchDraws] = useState<LotteryDraw[]>([])
  const [batchResultsOpen, setBatchResultsOpen] = useState(false)
  const drawInFlight = useRef(false)
  const drawPageActive = useRef(true)
  const displayedStatus = drawStartStatus ?? status
  const availableChances = displayedStatus?.available_chances ?? 0
  const [settingsTab, setSettingsTab] = useState<'prizes' | 'grants' | null>(
    null
  )
  const [manualGrantOpen, setManualGrantOpen] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(false)
  const [recordsDialogHandle] = useState(createDialogHandle)
  const recordsTriggerId = useId()
  const campaignPreviewId = useId()
  const [recordView, setRecordView] = useState<'draws' | 'grants'>('draws')
  const [recordScope, setRecordScope] = useState<'mine' | 'all'>('mine')
  const [adminDraws, setAdminDraws] = useState<LotteryAdminDraw[]>([])
  const [adminDrawsLoading, setAdminDrawsLoading] = useState(false)
  const [hasLoadedAdminDraws, setHasLoadedAdminDraws] = useState(false)
  const [adminPage, setAdminPage] = useState(1)
  const [adminTotal, setAdminTotal] = useState(0)
  const [userDraws, setUserDraws] = useState<LotteryDraw[]>([])
  const [userDrawsLoading, setUserDrawsLoading] = useState(true)
  const [userDrawsFailed, setUserDrawsFailed] = useState(false)
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
        handleServerError(response, t('Failed to load lottery status'))
        return
      }
      setStatus(response.data)
    } catch (error) {
      handleServerError(error, t('Failed to load lottery status'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    drawPageActive.current = true
    return () => {
      drawPageActive.current = false
    }
  }, [])

  const loadUserDraws = useCallback(async () => {
    if (!recordsOpen || recordView !== 'draws' || recordScope !== 'mine') return
    const requestId = ++userDrawRequestId.current
    setUserDrawsLoading(true)
    setUserDrawsFailed(false)
    try {
      const response = await getUserLotteryDraws(userDrawPage, USER_PAGE_SIZE)
      if (requestId !== userDrawRequestId.current) return
      if (!response.success || !response.data) {
        setUserDrawsFailed(true)
        handleServerError(response, t('Failed to load lottery records'))
        return
      }
      setUserDraws(response.data.items || [])
      setUserDrawTotal(response.data.total || 0)
      setHasLoadedUserDraws(true)
    } catch (error) {
      if (requestId === userDrawRequestId.current) {
        setUserDrawsFailed(true)
        handleServerError(error, t('Failed to load lottery records'))
      }
    } finally {
      if (requestId === userDrawRequestId.current) {
        setUserDrawsLoading(false)
      }
    }
  }, [recordsOpen, recordScope, recordView, t, userDrawPage])

  useEffect(() => {
    if (!drawing) void loadUserDraws()
  }, [drawing, loadUserDraws])

  const loadAdminDraws = useCallback(async () => {
    if (
      !recordsOpen ||
      !isAdmin ||
      recordView !== 'draws' ||
      recordScope !== 'all'
    ) {
      return
    }
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
        handleServerError(response, t('Failed to load lottery records'))
        return
      }
      setAdminDraws(response.data.items || [])
      setAdminTotal(response.data.total || 0)
      setHasLoadedAdminDraws(true)
    } catch (error) {
      if (requestId === adminDrawRequestId.current) {
        handleServerError(error, t('Failed to load lottery records'))
      }
    } finally {
      if (requestId === adminDrawRequestId.current) {
        setAdminDrawsLoading(false)
      }
    }
  }, [
    adminPage,
    appliedDrawFilters,
    isAdmin,
    recordsOpen,
    recordScope,
    recordView,
    t,
  ])

  useEffect(() => {
    if (!drawing) void loadAdminDraws()
  }, [drawing, loadAdminDraws])

  const loadAdminGrants = useCallback(
    async (requestedPage = grantPage) => {
      if (!recordsOpen || !isAdmin || recordView !== 'grants') return
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
          handleServerError(response, t('Failed to load chance grant records'))
          return
        }
        setAdminGrants(response.data.items || [])
        setGrantTotal(response.data.total || 0)
        setHasLoadedAdminGrants(true)
      } catch (error) {
        if (requestId === adminGrantRequestId.current) {
          handleServerError(error, t('Failed to load chance grant records'))
        }
      } finally {
        if (requestId === adminGrantRequestId.current) {
          setAdminGrantsLoading(false)
        }
      }
    },
    [appliedGrantFilters, grantPage, isAdmin, recordsOpen, recordView, t]
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

  const handleDraw = async (count = 1) => {
    if (
      !status ||
      count <= 0 ||
      status.available_chances < count ||
      drawInFlight.current
    ) {
      return
    }
    drawInFlight.current = true
    drawStartedAt.current = Date.now()
    setDrawStartStatus(status)
    setDrawing(true)
    setLatestDraw(null)
    setPendingDraws(null)
    setBatchDraws([])
    const completedDraws: LotteryDraw[] = []
    try {
      // Snapshot the requested count. Newly granted chances during a run are
      // left for the next click; each batch must finish before starting another.
      while (completedDraws.length < count && drawPageActive.current) {
        const batchSize = Math.min(
          MAX_DRAW_BATCH_SIZE,
          count - completedDraws.length
        )
        const response = await drawLottery(batchSize)
        if (!response.success || !response.data) {
          throw createServerError(response, t('Lottery draw failed'))
        }
        if (!drawPageActive.current) break
        const result = response.data
        const draws = result.draws ?? [result.draw]
        completedDraws.push(...draws)
        setStatus(result.status)
        // Stop if an older server returns only one draw for a batch request.
        if (draws.length !== batchSize) break
      }
    } catch (error) {
      if (drawPageActive.current) {
        handleServerError(error, t('Lottery draw failed'))
        // A lost response may follow a committed draw. Refresh the balance
        // before another attempt. The history refreshes when drawing ends.
        await loadStatus()
      }
    } finally {
      if (drawPageActive.current) {
        if (completedDraws.length > 0) {
          setPendingDraws(completedDraws)
          if (userDrawPage !== 1) setUserDrawPage(1)
        } else {
          setDrawStartStatus(null)
          setDrawing(false)
          drawInFlight.current = false
        }
      }
    }
  }

  useEffect(() => {
    const pendingDraw = pendingDraws?.at(-1)
    if (!pendingDraw || !pendingDraws) return
    const remainingDelay = Math.max(
      0,
      DRAW_REVEAL_DELAY_MS - (Date.now() - drawStartedAt.current)
    )
    const timer = window.setTimeout(() => {
      setLatestDraw(pendingDraw)
      setPendingDraws(null)
      setDrawStartStatus(null)
      setDrawing(false)
      drawInFlight.current = false
      if (pendingDraws.length > 1) {
        setBatchDraws(pendingDraws)
        setBatchResultsOpen(true)
        return
      }
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
  }, [pendingDraws, t])

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
        handleServerError(response, t('Failed to reverse lottery reward'))
        return
      }
      toast.success(t('Lottery reward reversed'))
      setRevokeDraw(null)
      setRevokeReason('')
      await loadAdminDraws()
    } catch (error) {
      handleServerError(error, t('Failed to reverse lottery reward'))
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
  const showingAllRecords =
    isAdmin && recordScope === 'all' && hasLoadedAdminDraws
  const visibleDraws: Array<LotteryDraw | LotteryAdminDraw> = showingAllRecords
    ? adminDraws
    : userDraws
  const recordsLoading = showingAllRecords
    ? adminDrawsLoading && !hasLoadedAdminDraws
    : userDrawsLoading && !hasLoadedUserDraws
  const showUserDrawsError = !showingAllRecords && userDrawsFailed
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
  const campaigns = campaignRules.map((rule) => ({
    rule,
    state: campaignStatus(rule, campaignNow, t),
  }))
  const campaignPreview = campaigns
    .filter(({ rule, state }) => rule.enabled && state.variant === 'success')
    .map(({ rule }) => rule.name?.trim())
    .filter(Boolean)
    .join(' · ')
  const adminTotalPages = Math.max(1, Math.ceil(adminTotal / ADMIN_PAGE_SIZE))
  const grantTotalPages = Math.max(1, Math.ceil(grantTotal / ADMIN_PAGE_SIZE))
  const userTotalPages = Math.max(1, Math.ceil(userDrawTotal / USER_PAGE_SIZE))
  const recordColumnCount = showingGrantRecords ? 7 : showingAllRecords ? 7 : 4
  const pityDrawsRemaining = displayedStatus?.pity_draws_remaining ?? 0
  const pityDrawLimit = displayedStatus?.rules?.pity_draw_limit ?? 0
  const batchReward = batchDraws.reduce((total, draw) => total + draw.quota, 0)
  const showDrawOnStage = Boolean(status?.prizes?.length)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const pityProgressLabel = t(
    'Draws until guaranteed grand prize · {{draws}}',
    {
      draws: formatNumber(pityDrawsRemaining, locale),
    }
  )
  const drawOptions = [
    { id: 'once', count: 1, label: t('Draw once') },
    {
      id: '10',
      count: 10,
      label: t('Draw {{count}} times', { count: formatNumber(10, locale) }),
    },
    {
      id: 'all',
      count: availableChances,
      label: t('Draw all ({{count}})', {
        count: formatNumber(availableChances, locale),
      }),
    },
  ]

  return (
    <Main>
      <div className='min-h-0 min-w-0 flex-1 overflow-auto px-4 py-5 sm:px-6 sm:py-7'>
        <CardStaggerContainer className='mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4 sm:gap-5'>
          <CardStaggerItem>
            <div className='flex flex-wrap items-start justify-between gap-x-3 gap-y-4 sm:items-center'>
              <div className='flex min-w-0 flex-1 basis-44 items-start gap-3'>
                <IconBadge tone='primary' size='lg'>
                  <Dices />
                </IconBadge>
                <div className='min-w-0'>
                  <h1 className='text-xl font-semibold tracking-tight sm:text-2xl'>
                    {t('Lottery Center')}
                  </h1>
                  <p className='text-muted-foreground mt-1 max-w-2xl text-sm leading-5'>
                    {t(
                      'Earn chances through weekly usage and activity streaks, then draw quota rewards.'
                    )}
                  </p>
                </div>
              </div>
              <div className='ms-auto flex max-w-full flex-wrap justify-end gap-2'>
                <DialogTrigger
                  id={recordsTriggerId}
                  handle={recordsDialogHandle}
                  render={
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      className='min-h-11'
                    />
                  }
                >
                  <History aria-hidden='true' />
                  {t('Lottery records')}
                </DialogTrigger>
                {isAdmin ? (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='min-h-11 shrink-0 whitespace-normal sm:w-auto'
                    disabled={loading}
                    onClick={() => setSettingsTab('prizes')}
                  >
                    <Settings aria-hidden='true' />
                    {t('Lottery settings')}
                  </Button>
                ) : null}
              </div>
            </div>
          </CardStaggerItem>

          <CardStaggerItem>
            <Card
              data-card-hover='false'
              data-testid='lottery-mystery-card'
              className='from-primary/[0.06] to-card @container/lottery gap-0 rounded-3xl bg-linear-to-br py-0'
            >
              <CardContent
                className={cn(
                  'grid min-w-0 gap-4 p-4 sm:p-6',
                  (showDrawOnStage || (loading && !status)) &&
                    '@min-[46rem]/lottery:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] @min-[46rem]/lottery:grid-rows-[1fr_auto] @min-[46rem]/lottery:gap-x-7 @min-[46rem]/lottery:gap-y-5 @min-[46rem]/lottery:p-7'
                )}
                data-testid='lottery-overview'
              >
                <div className='flex min-w-0 flex-col justify-center gap-4'>
                  <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2'>
                    <div className='flex min-w-0 items-center gap-2.5'>
                      <IconBadge tone='primary' size='lg'>
                        <Gift />
                      </IconBadge>
                      <h2 className='min-w-0 text-xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-3xl'>
                        {t('Mystery gifts')}
                      </h2>
                    </div>
                    <div className='bg-background/75 flex max-w-full flex-wrap items-baseline gap-x-2 rounded-xl border px-2.5 py-1.5'>
                      <span className='text-muted-foreground text-xs [overflow-wrap:anywhere]'>
                        {t('Available chances')}
                      </span>
                      {loading && !drawStartStatus ? (
                        <Skeleton className='h-5 w-7' />
                      ) : (
                        <strong className='text-primary text-xl leading-none font-semibold [overflow-wrap:anywhere] tabular-nums'>
                          {formatNumber(availableChances, locale)}
                        </strong>
                      )}
                    </div>
                  </div>
                  {pityDrawsRemaining > 0 && (
                    <div className='bg-background/70 space-y-2 rounded-xl border px-3 py-3 sm:px-4'>
                      <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
                        <p className='text-sm font-semibold'>
                          {t('Grand prize guarantee progress')}
                        </p>
                        <p className='text-muted-foreground text-xs tabular-nums sm:text-sm'>
                          {pityProgressLabel}
                        </p>
                      </div>
                      {pityDrawLimit >= pityDrawsRemaining && (
                        <Progress
                          aria-label={t('Grand prize guarantee progress')}
                          aria-valuetext={pityProgressLabel}
                          max={pityDrawLimit}
                          value={pityDrawLimit - pityDrawsRemaining}
                          className='[&_[data-slot=progress-indicator]]:rounded-full [&_[data-slot=progress-track]]:h-2'
                        />
                      )}
                      <p className='text-muted-foreground text-xs leading-relaxed'>
                        {t(
                          'Only a grand prize resets this count. Every other draw advances it.'
                        )}
                      </p>
                    </div>
                  )}
                </div>
                {showDrawOnStage && status && (
                  <div className='min-w-0 @min-[46rem]/lottery:col-start-2 @min-[46rem]/lottery:row-span-2 @min-[46rem]/lottery:row-start-1'>
                    <LotteryPrizeShowcase
                      prizes={status.prizes}
                      pityEnabled={pityDrawsRemaining > 0}
                      drawing={drawing}
                      revealedQuota={
                        batchDraws.length > 0 ? batchReward : latestDraw?.quota
                      }
                    />
                  </div>
                )}
                {loading && !status && (
                  <Skeleton className='h-28 w-full rounded-2xl @min-[46rem]/lottery:col-start-2 @min-[46rem]/lottery:row-span-2 @min-[46rem]/lottery:row-start-1 @min-[46rem]/lottery:h-full' />
                )}
                <div className='min-w-0'>
                  <div
                    role='group'
                    aria-label={t('Mystery gifts')}
                    className='grid grid-cols-2 gap-2 @min-[27rem]/lottery:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]'
                  >
                    {drawOptions.map((option) => (
                      <Button
                        key={option.id}
                        type='button'
                        variant={option.id === 'once' ? 'default' : 'outline'}
                        size='lg'
                        className={cn(
                          'h-auto min-h-11 min-w-0 rounded-xl px-2.5 py-2 leading-snug whitespace-normal [overflow-wrap:anywhere] sm:px-3',
                          option.id === 'all' &&
                            'col-span-2 @min-[27rem]/lottery:col-span-1'
                        )}
                        data-testid={
                          option.id === 'once'
                            ? 'lottery-draw-button'
                            : `lottery-draw-${option.id}`
                        }
                        data-state={drawing ? 'drawing' : 'idle'}
                        disabled={
                          loading ||
                          drawing ||
                          option.count <= 0 ||
                          availableChances < option.count
                        }
                        onClick={() => void handleDraw(option.count)}
                      >
                        {option.id === 'once' && <Dices aria-hidden='true' />}
                        {option.label}
                      </Button>
                    ))}
                  </div>
                  <div
                    role='status'
                    aria-live='polite'
                    aria-atomic='true'
                    className='text-muted-foreground text-xs'
                  >
                    {drawing && (
                      <span
                        className={cn(
                          'text-primary mt-2 inline-flex items-center gap-2',
                          showDrawOnStage && 'sr-only'
                        )}
                        data-testid='lottery-draw-progress'
                      >
                        <Loader2
                          className='size-4 motion-safe:animate-spin'
                          aria-hidden='true'
                        />
                        {t('Drawing...')}
                      </span>
                    )}
                    {!drawing && batchDraws.length > 0 && (
                      <span
                        className={cn(
                          'text-foreground mt-2 block font-medium',
                          showDrawOnStage && 'sr-only'
                        )}
                      >
                        {t(
                          'Completed {{count}} draws · Total reward: {{amount}}',
                          {
                            count: batchDraws.length,
                            amount: formatQuota(batchReward),
                          }
                        )}
                      </span>
                    )}
                    {!drawing && batchDraws.length === 0 && latestDraw && (
                      <span
                        className={cn(
                          'text-foreground mt-2 block font-medium',
                          showDrawOnStage && 'sr-only'
                        )}
                      >
                        {drawResultLabel(latestDraw, t)}
                      </span>
                    )}
                    {!drawing &&
                      batchDraws.length === 0 &&
                      !latestDraw &&
                      !loading &&
                      !availableChances && (
                        <p className='mt-2'>
                          {t('No lottery chances available')}
                        </p>
                      )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </CardStaggerItem>

          {campaignRules.length > 0 && (
            <CardStaggerItem>
              <Card data-card-hover='false' className='gap-0 py-0'>
                <Collapsible>
                  <CollapsibleTrigger
                    aria-label={t('Campaign')}
                    aria-describedby={
                      campaignPreview ? campaignPreviewId : undefined
                    }
                    render={
                      <Button
                        type='button'
                        variant='ghost'
                        className='group hover:bg-primary/10 h-auto min-h-12 w-full justify-start gap-3 rounded-xl px-4 py-2 text-start sm:px-5'
                      />
                    }
                  >
                    <IconBadge tone='primary' size='sm'>
                      <Sparkles />
                    </IconBadge>
                    <span className='shrink-0'>{t('Campaign')}</span>
                    {campaignPreview && (
                      <span
                        id={campaignPreviewId}
                        className='text-muted-foreground min-w-0 truncate text-xs font-normal sm:text-sm'
                      >
                        {campaignPreview}
                      </span>
                    )}
                    <ChevronDown
                      className='text-muted-foreground ms-auto group-aria-expanded:rotate-180 motion-safe:transition-transform'
                      aria-hidden='true'
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className='border-t'>
                    {isAdmin && (
                      <div className='flex justify-end px-5 pt-3'>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() => setSettingsTab('grants')}
                        >
                          <Settings aria-hidden='true' />
                          {t('Chance grants')}
                        </Button>
                      </div>
                    )}
                    <CardContent className='grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] items-stretch gap-3 px-5 py-4'>
                      {campaigns.map(({ rule, state }) => (
                        <div
                          key={rule.id}
                          className='bg-card flex h-full min-w-0 flex-col gap-2.5 rounded-xl border px-4 py-3'
                        >
                          <div className='flex min-h-7 flex-wrap items-center justify-between gap-2'>
                            <span className='min-w-0 text-sm font-medium break-words'>
                              {rule.name || t('Campaign')}
                            </span>
                            <div className='flex flex-wrap items-center gap-1.5'>
                              <StatusBadge variant='info'>
                                {t('{{count}} chances', {
                                  count: rule.chances,
                                })}
                              </StatusBadge>
                              <StatusBadge variant={state.variant}>
                                {state.label}
                              </StatusBadge>
                            </div>
                          </div>
                          <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs leading-5'>
                            {rule.type === 'recharge' ? (
                              <>
                                <p>
                                  {t('Recharge threshold')}:{' '}
                                  <span className='text-foreground font-medium'>
                                    {formatQuota(
                                      rule.threshold *
                                        currencyConfig.quotaPerUnit
                                    )}
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
                      ))}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            </CardStaggerItem>
          )}

          <div
            className='grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'
            data-testid='lottery-rules-grid'
          >
            <CardStaggerItem className='h-full min-w-0'>
              <Card
                data-card-hover='false'
                className='h-full min-w-0 gap-0 rounded-2xl py-0'
              >
                <CardHeader className='border-b px-5 py-4'>
                  <CardTitle className='flex items-center gap-2 text-base'>
                    <Trophy className='text-chart-2 size-4' />
                    {t('Weekly lottery chances')}
                  </CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-3 px-5 py-4'>
                  <div className='flex flex-wrap items-end justify-between gap-3'>
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
                  <Progress
                    aria-label={t('Weekly spending')}
                    value={weeklyProgress}
                  />
                  <p className='text-muted-foreground text-xs leading-5'>
                    {t(
                      'Earn 1 chance for every {{amount}} spent each week, up to {{limit}} chances.',
                      {
                        amount: formatQuota(
                          (status?.rules?.weekly_spend_amount ?? 50) *
                            currencyConfig.quotaPerUnit
                        ),
                        limit: status?.weekly_chance_limit ?? 0,
                      }
                    )}
                  </p>
                </CardContent>
              </Card>
            </CardStaggerItem>

            <CardStaggerItem className='h-full min-w-0'>
              <Card
                data-card-hover='false'
                className='h-full min-w-0 gap-0 rounded-2xl py-0'
              >
                <CardHeader className='border-b px-5 py-4'>
                  <CardTitle className='flex items-center gap-2 text-base'>
                    <CalendarDays className='text-chart-3 size-4' />
                    {t('Daily activity')}
                  </CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-3 px-5 py-4'>
                  <div className='flex flex-wrap items-center justify-between gap-3'>
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
                  <Progress
                    aria-label={t('Today spent')}
                    value={dailyProgress}
                  />
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'Spend {{amount}} in a single day to mark that day as active.',
                      {
                        amount: formatQuota(
                          (status?.rules?.daily_active_amount ?? 20) *
                            currencyConfig.quotaPerUnit
                        ),
                      }
                    )}
                  </p>
                </CardContent>
              </Card>
            </CardStaggerItem>

            <CardStaggerItem className='h-full min-w-0 sm:col-span-2 xl:col-span-1'>
              <Card
                data-card-hover='false'
                className='h-full min-w-0 gap-0 rounded-2xl py-0'
              >
                <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3 border-b px-5 py-4'>
                  <CardTitle className='flex items-center gap-2 text-base'>
                    <Flame className='text-warning size-4' aria-hidden='true' />
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
                <CardContent className='flex flex-1 flex-col gap-4 px-5 py-4'>
                  <p className='text-muted-foreground text-xs'>
                    {t('Current streak')}
                  </p>
                  <div className='grid grid-cols-7 gap-1 sm:gap-2'>
                    {activity.map((day) => (
                      <div
                        key={day.date}
                        className='flex min-w-0 flex-col items-center gap-1.5'
                        title={day.date}
                      >
                        <div
                          className={cn(
                            'flex size-8 items-center justify-center rounded-lg border',
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
                        className='bg-muted/30 rounded-xl border px-3 py-3'
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

          <Dialog
            handle={recordsDialogHandle}
            triggerId={recordsTriggerId}
            open={recordsOpen}
            onOpenChange={setRecordsOpen}
            title={t('Lottery records')}
            contentClassName={cn(
              'overflow-hidden p-0 sm:p-0',
              isAdmin && 'sm:max-w-5xl'
            )}
            headerClassName='border-b px-5 pt-4 pb-3 pr-12'
            bodyClassName='px-0 py-0'
          >
            <div className='min-w-0'>
              <div className='flex min-w-0 flex-wrap items-center gap-2 px-5 py-3'>
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
                      if (nextScope === 'all') {
                        setAdminPage(1)
                      } else {
                        setUserDrawPage(1)
                      }
                    }}
                  >
                    <TabsList>
                      <TabsTrigger value='mine'>{t('My records')}</TabsTrigger>
                      <TabsTrigger value='all'>{t('All records')}</TabsTrigger>
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
                  {t('{{count}} records', {
                    count: displayedRecordTotal,
                  })}
                </span>
              </div>
              <div>
                {showingGrantRecords ? (
                  <form
                    className='bg-muted/20 grid gap-3 border-b p-5 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_170px_150px_auto]'
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
                    className='bg-muted/20 grid gap-3 border-b p-5 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_auto]'
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
                <Table
                  aria-label={
                    showingGrantRecords
                      ? t('Chance grant records')
                      : t('Lottery records')
                  }
                  className='[&_th]:bg-muted/30 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5'
                >
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
                            <EmptyState
                              icon={Gift}
                              title={t('No chance grant records')}
                              description={t(
                                'Issued lottery chances will appear here.'
                              )}
                              className='min-h-44 rounded-none py-10'
                            />
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
                    ) : showUserDrawsError ? (
                      <TableRow>
                        <TableCell colSpan={recordColumnCount}>
                          <ErrorState
                            title={t('Failed to load lottery records')}
                            onRetry={() => void loadUserDraws()}
                            className='min-h-44'
                          />
                        </TableCell>
                      </TableRow>
                    ) : visibleDraws.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={recordColumnCount} className='p-0'>
                          <EmptyState
                            icon={Trophy}
                            title={t('No lottery results yet')}
                            description={t(
                              'Your lottery results will appear here after each draw.'
                            )}
                            className='min-h-44 rounded-none py-10'
                          />
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
                    : !recordsLoading && !showUserDrawsError
                ) ? (
                  <div
                    className='bg-muted/10 flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm'
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
              </div>
            </div>
            <ManualLotteryGrantDialog
              open={manualGrantOpen}
              onOpenChange={setManualGrantOpen}
              grantRules={status?.active_grant_rules ?? EMPTY_GRANT_RULES}
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
          </Dialog>
        </CardStaggerContainer>
      </div>
      <Dialog
        open={batchResultsOpen}
        onOpenChange={setBatchResultsOpen}
        title={t('Batch draw results')}
        description={t('Completed {{count}} draws · Total reward: {{amount}}', {
          count: batchDraws.length,
          amount: formatQuota(batchReward),
        })}
        footer={
          <Button onClick={() => setBatchResultsOpen(false)}>
            {t('Close')}
          </Button>
        }
      >
        <ol className='grid gap-2 sm:grid-cols-2'>
          {batchDraws.map((draw, index) => (
            <li
              key={draw.id}
              data-testid='lottery-batch-result'
              className='flex min-w-0 items-center justify-between gap-3 rounded-lg border p-3 text-sm'
            >
              <span className='text-muted-foreground'>
                {t('Draw {{number}}', { number: index + 1 })}
              </span>
              <strong className='text-end break-words'>
                {drawResultLabel(draw, t)}
              </strong>
            </li>
          ))}
        </ol>
      </Dialog>
      <LotterySettingsDialog
        open={settingsTab !== null}
        initialTab={settingsTab ?? undefined}
        onOpenChange={(open) => {
          if (!open) setSettingsTab(null)
        }}
        onSaved={(config) => {
          setStatus((current) =>
            current
              ? { ...current, prizes: config.prizes, rules: config.rules }
              : current
          )
          void loadStatus()
        }}
      />
    </Main>
  )
}
