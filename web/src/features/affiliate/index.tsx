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
import type { TFunction } from 'i18next'
import {
  Gift,
  Link2,
  Loader2,
  RotateCcw,
  Search,
  TrendingUp,
  Users,
  WalletCards,
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

import { CopyButton } from '@/components/copy-button'
import { Main } from '@/components/layout'
import {
  CardStaggerContainer,
  CardStaggerItem,
} from '@/components/page-transition'
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
import {
  getAllAffiliateRewards,
  getAffiliateCode,
  getAffiliateRewards,
  transferAffiliateQuota,
} from '@/features/wallet/api'
import { TransferDialog } from '@/features/wallet/components/dialogs/transfer-dialog'
import { useTopupInfo } from '@/features/wallet/hooks/use-topup-info'
import { generateAffiliateLink } from '@/features/wallet/lib'
import type {
  AffiliateRewardAdminItem,
  AffiliateRewardFilters,
  AffiliateRewardItem,
  AffiliateRewardType,
  UserWalletData,
} from '@/features/wallet/types'
import { useIsAdmin } from '@/hooks/use-admin'
import { useSystemConfig } from '@/hooks/use-system-config'
import { getSelf } from '@/lib/api'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

const PAGE_SIZE = 10
const EMPTY_FILTERS: AffiliateRewardFilters = {
  inviter: '',
  invitee: '',
  type: '',
}

function formatRewardType(type: AffiliateRewardItem['type'], t: TFunction) {
  return type === 'first_topup'
    ? t('First top-up rebate')
    : t('Registration reward')
}

export function Affiliate() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const { currency } = useSystemConfig()
  const { topupInfo } = useTopupInfo()
  const [user, setUser] = useState<UserWalletData | null>(null)
  const [affiliateLink, setAffiliateLink] = useState('')
  const [items, setItems] = useState<
    Array<AffiliateRewardItem | AffiliateRewardAdminItem>
  >([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [rewardsLoading, setRewardsLoading] = useState(true)
  const [hasLoadedRewards, setHasLoadedRewards] = useState(false)
  const [recordScope, setRecordScope] = useState<'mine' | 'all'>('mine')
  const [displayedRecordScope, setDisplayedRecordScope] = useState<
    'mine' | 'all'
  >('mine')
  const [inviterKeyword, setInviterKeyword] = useState('')
  const [inviteeKeyword, setInviteeKeyword] = useState('')
  const [rewardType, setRewardType] = useState<AffiliateRewardType | 'all'>(
    'all'
  )
  const [appliedFilters, setAppliedFilters] =
    useState<AffiliateRewardFilters>(EMPTY_FILTERS)
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const rewardsRequestId = useRef(0)

  const loadUser = useCallback(async () => {
    setLoading(true)
    try {
      const response = requireServerSuccess(await getSelf())
      if (response.success && response.data) {
        setUser(response.data as UserWalletData)
      }
    } catch (error) {
      handleServerError(error, t('Failed to load referral rewards'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const loadRewards = useCallback(
    async (nextPage: number, scope: 'mine' | 'all') => {
      const requestId = ++rewardsRequestId.current
      setRewardsLoading(true)
      try {
        const rewardsResponse = requireServerSuccess(
          scope === 'all'
            ? await getAllAffiliateRewards(nextPage, PAGE_SIZE, appliedFilters)
            : await getAffiliateRewards(nextPage, PAGE_SIZE)
        )
        if (requestId !== rewardsRequestId.current) return
        if (rewardsResponse.success && rewardsResponse.data) {
          setItems(rewardsResponse.data.items || [])
          setTotal(rewardsResponse.data.total || 0)
          setDisplayedRecordScope(scope)
          setHasLoadedRewards(true)
        }
      } catch (error) {
        if (requestId === rewardsRequestId.current) {
          handleServerError(error, t('Failed to load referral rewards'))
        }
      } finally {
        if (requestId === rewardsRequestId.current) {
          setRewardsLoading(false)
        }
      }
    },
    [appliedFilters, t]
  )

  useEffect(() => {
    let cancelled = false
    const loadAffiliateCode = async () => {
      try {
        const response = requireServerSuccess(await getAffiliateCode())
        if (!cancelled && response.success && response.data) {
          setAffiliateLink(generateAffiliateLink(response.data))
        }
      } catch (error) {
        if (!cancelled) {
          handleServerError(error, t('Failed to load referral rewards'))
        }
      }
    }
    void loadAffiliateCode()
    return () => {
      cancelled = true
    }
  }, [t])

  useEffect(() => {
    void loadUser()
  }, [loadUser])

  useEffect(() => {
    void loadRewards(page, recordScope)
  }, [loadRewards, page, recordScope])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showingAllRecords = displayedRecordScope === 'all'
  const recordColumnCount = showingAllRecords ? 5 : 4
  const showInitialRecordsLoading = rewardsLoading && !hasLoadedRewards
  const quotaUnit = currency?.quotaPerUnit || 1
  const complianceConfirmed = topupInfo?.payment_compliance_confirmed !== false
  const handleTransfer = async (amount: number) => {
    setTransferring(true)
    try {
      const response = await transferAffiliateQuota({ quota: amount })
      if (!response.success) {
        handleServerError(response, t('Transfer failed'))
        return false
      }
      toast.success(t('Transfer successful'))
      await loadUser()
      return true
    } catch (error) {
      handleServerError(error, t('Transfer failed'))
      return false
    } finally {
      setTransferring(false)
    }
  }

  const description = useMemo(
    () =>
      t(
        'Share your referral link. When eligible users register or complete a first top-up, rewards are added to your referral balance.'
      ),
    [t]
  )

  const handleRecordSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(1)
    setAppliedFilters({
      inviter: inviterKeyword.trim(),
      invitee: inviteeKeyword.trim(),
      type: rewardType === 'all' ? '' : rewardType,
    })
  }

  const handleResetRecordSearch = () => {
    setInviterKeyword('')
    setInviteeKeyword('')
    setRewardType('all')
    setPage(1)
    setAppliedFilters({ ...EMPTY_FILTERS })
  }

  return (
    <Main>
      <div className='min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-6 sm:py-6'>
        <CardStaggerContainer className='mx-auto flex w-full max-w-6xl flex-col gap-5 sm:gap-6'>
          <CardStaggerItem>
            <header className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
              <div className='flex min-w-0 items-start gap-3'>
                <div className='bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl'>
                  <Gift className='size-5' aria-hidden='true' />
                </div>
                <div className='min-w-0'>
                  <h1 className='text-xl font-semibold tracking-tight sm:text-2xl'>
                    {t('Invitation Rebates')}
                  </h1>
                  <p className='text-muted-foreground mt-1.5 max-w-2xl text-sm leading-6'>
                    {description}
                  </p>
                </div>
              </div>
              <Button
                type='button'
                className='h-10 w-full shrink-0 sm:w-auto'
                onClick={() => setTransferOpen(true)}
                disabled={
                  (user?.aff_quota ?? 0) < quotaUnit ||
                  transferring ||
                  !complianceConfirmed
                }
              >
                <WalletCards aria-hidden='true' />
                {t('Transfer to Balance')}
              </Button>
            </header>
          </CardStaggerItem>

          <CardStaggerItem>
            <div
              role='group'
              aria-label={t('Referral Program')}
              className='grid min-w-0 gap-3 sm:grid-cols-3 sm:gap-4'
              data-testid='affiliate-summary'
            >
              {[
                {
                  label: t('Available referral balance'),
                  value: formatQuota(user?.aff_quota ?? 0),
                  icon: WalletCards,
                },
                {
                  label: t('Total referral income'),
                  value: formatQuota(user?.aff_history_quota ?? 0),
                  icon: TrendingUp,
                },
                {
                  label: t('People invited'),
                  value: String(user?.aff_count ?? 0),
                  icon: Users,
                },
              ].map((stat) => {
                const Icon = stat.icon
                return (
                  <Card
                    key={stat.label}
                    data-card-hover='false'
                    className='min-w-0 gap-3 rounded-xl py-5'
                  >
                    <CardHeader className='flex flex-row items-center justify-between gap-3 px-5'>
                      <span className='text-muted-foreground text-sm'>
                        {stat.label}
                      </span>
                      <Icon
                        className='text-primary size-4 shrink-0'
                        aria-hidden='true'
                      />
                    </CardHeader>
                    <CardContent className='px-5'>
                      {loading ? (
                        <Skeleton className='h-9 w-28' />
                      ) : (
                        <div className='text-3xl font-semibold tracking-tight [overflow-wrap:anywhere] tabular-nums'>
                          {stat.value}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </CardStaggerItem>

          <CardStaggerItem>
            <Card
              data-card-hover='false'
              className='gap-4 rounded-xl py-5 sm:gap-5'
            >
              <CardHeader className='px-5'>
                <CardTitle className='flex items-center gap-2 text-base'>
                  <Link2 className='text-primary size-4' aria-hidden='true' />
                  {t('Referral link')}
                </CardTitle>
              </CardHeader>
              <CardContent className='flex min-w-0 flex-col gap-3 px-5'>
                <div className='flex min-w-0 flex-col gap-2 sm:flex-row'>
                  {loading ? (
                    <Skeleton className='h-11 min-w-0 shrink-0 sm:flex-1' />
                  ) : (
                    <Input
                      value={affiliateLink}
                      readOnly
                      aria-label={t('Referral link')}
                      className='bg-muted/30 h-11 min-w-0 shrink-0 font-mono text-sm sm:flex-1'
                    />
                  )}
                  <CopyButton
                    value={affiliateLink}
                    size='default'
                    variant='outline'
                    tooltip={t('Copy referral link')}
                    aria-label={t('Copy referral link')}
                    className='h-11 w-full px-4 sm:w-auto'
                  >
                    {t('Copy referral link')}
                  </CopyButton>
                </div>
                {!complianceConfirmed ? (
                  <p className='text-muted-foreground text-xs leading-5'>
                    {t(
                      'Referral reward transfer is disabled until the administrator confirms compliance terms.'
                    )}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </CardStaggerItem>

          <CardStaggerItem>
            <Card data-card-hover='false' className='gap-0 py-0'>
              <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3 border-b px-5 py-5'>
                <div className='flex min-w-0 flex-col gap-1'>
                  <CardTitle className='flex items-center gap-2 text-base'>
                    <Users className='text-primary size-4' aria-hidden='true' />
                    {t('Invitation History')}
                  </CardTitle>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'Referral rewards are recorded after they are credited.'
                    )}
                  </p>
                </div>
                <div className='flex flex-wrap items-center gap-3'>
                  {isAdmin ? (
                    <Tabs
                      value={recordScope}
                      onValueChange={(value) => {
                        setRecordScope(value as 'mine' | 'all')
                        setPage(1)
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
                  <span className='text-muted-foreground flex items-center gap-1.5 text-xs tabular-nums'>
                    {rewardsLoading ? (
                      <Loader2
                        className='size-3.5 animate-spin'
                        data-testid='affiliate-records-loading'
                        aria-label={t('Loading')}
                      />
                    ) : null}
                    {t('{{count}} records', { count: total })}
                  </span>
                </div>
              </CardHeader>
              <CardContent className='p-0'>
                {isAdmin && recordScope === 'all' ? (
                  <form
                    className='grid gap-2 border-b p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_auto]'
                    onSubmit={handleRecordSearch}
                  >
                    <Input
                      value={inviterKeyword}
                      onChange={(event) =>
                        setInviterKeyword(event.target.value)
                      }
                      placeholder={t('Search inviter by username or ID')}
                      aria-label={t('Search inviter by username or ID')}
                      data-testid='affiliate-inviter-search'
                    />
                    <Input
                      value={inviteeKeyword}
                      onChange={(event) =>
                        setInviteeKeyword(event.target.value)
                      }
                      placeholder={t('Search invitee by username or ID')}
                      aria-label={t('Search invitee by username or ID')}
                      data-testid='affiliate-invitee-search'
                    />
                    <Select
                      value={rewardType}
                      onValueChange={(value) =>
                        setRewardType(value as AffiliateRewardType | 'all')
                      }
                    >
                      <SelectTrigger aria-label={t('Type')}>
                        <SelectValue>
                          {rewardType === 'all'
                            ? t('All reward types')
                            : formatRewardType(rewardType, t)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectItem value='all'>
                          {t('All reward types')}
                        </SelectItem>
                        <SelectItem value='registration'>
                          {t('Registration reward')}
                        </SelectItem>
                        <SelectItem value='first_topup'>
                          {t('First top-up rebate')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <div className='flex gap-2'>
                      <Button type='submit' size='sm' disabled={rewardsLoading}>
                        <Search aria-hidden='true' />
                        {t('Search')}
                      </Button>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        disabled={rewardsLoading}
                        onClick={handleResetRecordSearch}
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
                        <TableHead>{t('Inviter')}</TableHead>
                      ) : null}
                      <TableHead>{t('Type')}</TableHead>
                      <TableHead>{t('Invited User')}</TableHead>
                      <TableHead>{t('Reward')}</TableHead>
                      <TableHead>{t('Time')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {showInitialRecordsLoading ? (
                      <TableRow>
                        <TableCell colSpan={recordColumnCount}>
                          <Skeleton
                            className='h-8 w-full'
                            data-testid='affiliate-records-skeleton'
                          />
                        </TableCell>
                      </TableRow>
                    ) : items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={recordColumnCount} className='p-0'>
                          <Empty className='min-h-44 rounded-none py-8'>
                            <EmptyHeader>
                              <EmptyMedia variant='icon'>
                                <Gift className='size-4' aria-hidden='true' />
                              </EmptyMedia>
                              <EmptyTitle className='tracking-normal'>
                                {t('No invitation records yet')}
                              </EmptyTitle>
                              <EmptyDescription>
                                {t(
                                  'New referral rewards will appear here after they are credited.'
                                )}
                              </EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        </TableCell>
                      </TableRow>
                    ) : (
                      items.map((item) => {
                        const adminItem = item as AffiliateRewardAdminItem
                        const userItem = item as AffiliateRewardItem
                        return (
                          <TableRow key={item.id}>
                            {showingAllRecords ? (
                              <TableCell>
                                <div className='font-medium'>
                                  {adminItem.inviter_username || '-'}
                                </div>
                                <div className='text-muted-foreground text-xs tabular-nums'>
                                  ID: {adminItem.inviter_id}
                                </div>
                              </TableCell>
                            ) : null}
                            <TableCell>
                              {formatRewardType(item.type, t)}
                            </TableCell>
                            <TableCell>
                              {showingAllRecords ? (
                                <>
                                  <div className='font-medium'>
                                    {adminItem.invitee_username || '-'}
                                  </div>
                                  <div className='text-muted-foreground text-xs tabular-nums'>
                                    ID: {adminItem.invitee_id}
                                  </div>
                                </>
                              ) : (
                                <span className='font-mono text-xs'>
                                  {userItem.invitee_display}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className='font-medium tabular-nums'>
                              {formatQuota(item.quota)}
                            </TableCell>
                            <TableCell className='text-muted-foreground'>
                              {formatTimestampToDate(item.created_at)}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
                {hasLoadedRewards && (
                  <div
                    className='flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm'
                    data-testid='affiliate-records-pagination'
                  >
                    <span className='text-muted-foreground'>
                      {t('{{count}} records', { count: total })}
                    </span>
                    <div className='flex items-center gap-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        disabled={page <= 1 || rewardsLoading}
                        onClick={() => setPage((value) => value - 1)}
                      >
                        {t('Previous')}
                      </Button>
                      <span className='tabular-nums'>
                        {page} / {totalPages}
                      </span>
                      <Button
                        variant='outline'
                        size='sm'
                        disabled={page >= totalPages || rewardsLoading}
                        onClick={() => setPage((value) => value + 1)}
                      >
                        {t('Next')}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </CardStaggerItem>
        </CardStaggerContainer>
      </div>
      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        onConfirm={handleTransfer}
        availableQuota={user?.aff_quota ?? 0}
        transferring={transferring}
      />
    </Main>
  )
}
