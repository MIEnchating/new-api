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
import { Gift, History, Loader2, RotateCcw, Search } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
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
  getAffiliateRewards,
} from '@/features/wallet/api'
import type {
  AffiliateRewardAdminItem,
  AffiliateRewardFilters,
  AffiliateRewardItem,
  AffiliateRewardType,
} from '@/features/wallet/types'
import { useIsAdmin } from '@/hooks/use-admin'
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
  switch (type) {
    case 'first_topup':
      return t('First top-up rebate')
    case 'wallet_usage':
      return t('Wallet usage commission')
    default:
      return t('Registration reward')
  }
}

export function InvitationHistoryDialog() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<
    Array<AffiliateRewardItem | AffiliateRewardAdminItem>
  >([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
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

  useEffect(() => {
    if (!open) return

    let cancelled = false
    const loadRewards = async () => {
      setRewardsLoading(true)
      try {
        const response = requireServerSuccess(
          recordScope === 'all'
            ? await getAllAffiliateRewards(page, PAGE_SIZE, appliedFilters)
            : await getAffiliateRewards(page, PAGE_SIZE)
        )
        if (!cancelled && response.success && response.data) {
          setItems(response.data.items || [])
          setTotal(response.data.total || 0)
          setDisplayedRecordScope(recordScope)
          setHasLoadedRewards(true)
        }
      } catch (error) {
        if (!cancelled) {
          handleServerError(error, t('Failed to load referral rewards'))
        }
      } finally {
        if (!cancelled) {
          setRewardsLoading(false)
        }
      }
    }
    void loadRewards()
    return () => {
      cancelled = true
    }
  }, [open, page, recordScope, appliedFilters, t])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showingAllRecords = displayedRecordScope === 'all'
  const recordColumnCount = showingAllRecords ? 5 : 4
  const showInitialRecordsLoading = rewardsLoading && !hasLoadedRewards

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
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('Invitation History')}
      description={t('Referral rewards are recorded after they are credited.')}
      trigger={
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='ms-auto min-h-11 max-w-full whitespace-normal'
        >
          <History aria-hidden='true' />
          {t('Invitation History')}
        </Button>
      }
      contentClassName='sm:max-w-[min(56rem,calc(100vw-2rem))]'
      headerClassName='pr-8'
      bodyClassName='space-y-3'
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        {isAdmin ? (
          <Tabs
            value={recordScope}
            onValueChange={(value) => {
              setRecordScope(value as 'mine' | 'all')
              setPage(1)
            }}
          >
            <TabsList>
              <TabsTrigger value='mine'>{t('My records')}</TabsTrigger>
              <TabsTrigger value='all'>{t('All records')}</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        <span className='text-muted-foreground ms-auto flex items-center gap-1.5 text-xs tabular-nums'>
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
      {isAdmin && recordScope === 'all' ? (
        <form
          className='bg-muted/20 grid gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]'
          onSubmit={handleRecordSearch}
        >
          <Input
            value={inviterKeyword}
            onChange={(event) => setInviterKeyword(event.target.value)}
            placeholder={t('Search inviter by username or ID')}
            aria-label={t('Search inviter by username or ID')}
            data-testid='affiliate-inviter-search'
          />
          <Input
            value={inviteeKeyword}
            onChange={(event) => setInviteeKeyword(event.target.value)}
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
              <SelectGroup>
                <SelectItem value='all'>{t('All reward types')}</SelectItem>
                <SelectItem value='registration'>
                  {t('Registration reward')}
                </SelectItem>
                <SelectItem value='first_topup'>
                  {t('First top-up rebate')}
                </SelectItem>
                <SelectItem value='wallet_usage'>
                  {t('Wallet usage commission')}
                </SelectItem>
              </SelectGroup>
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
      <div className='min-w-0 overflow-hidden rounded-lg border'>
        <Table
          aria-label={t('Invitation History')}
          className='[&_th]:bg-muted/30 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5'
        >
          <TableHeader>
            <TableRow>
              {showingAllRecords ? <TableHead>{t('Inviter')}</TableHead> : null}
              <TableHead>{t('Type')}</TableHead>
              <TableHead>{t('Invited User')}</TableHead>
              <TableHead className='text-right'>{t('Reward')}</TableHead>
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
                <TableCell
                  colSpan={recordColumnCount}
                  className='p-0 whitespace-normal'
                >
                  <EmptyState
                    icon={Gift}
                    title={t('No invitation records yet')}
                    description={t(
                      'New referral rewards will appear here after they are credited.'
                    )}
                    className='min-h-44 rounded-none py-10'
                  />
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
                        <div
                          className='max-w-48 truncate font-medium'
                          title={adminItem.inviter_username}
                        >
                          {adminItem.inviter_username || '-'}
                        </div>
                        <div className='text-muted-foreground text-xs tabular-nums'>
                          ID: {adminItem.inviter_id}
                        </div>
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <StatusBadge
                        variant={
                          item.type === 'registration' ? 'neutral' : 'info'
                        }
                      >
                        {formatRewardType(item.type, t)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      {showingAllRecords ? (
                        <>
                          <div
                            className='max-w-48 truncate font-medium'
                            title={adminItem.invitee_username}
                          >
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
                    <TableCell className='text-success text-right font-semibold tabular-nums'>
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
            className='bg-muted/10 flex flex-wrap items-center justify-end gap-2 border-t px-3 py-3 text-sm'
            data-testid='affiliate-records-pagination'
          >
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
        )}
      </div>
    </Dialog>
  )
}
