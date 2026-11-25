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
import { Gift, Link2, TrendingUp, Users, WalletCards } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { getAffiliateCode, transferAffiliateQuota } from '@/features/wallet/api'
import { TransferDialog } from '@/features/wallet/components/dialogs/transfer-dialog'
import { useTopupInfo } from '@/features/wallet/hooks/use-topup-info'
import { generateAffiliateLink } from '@/features/wallet/lib'
import type { UserWalletData } from '@/features/wallet/types'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { getSelf } from '@/lib/api'
import { formatQuota } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { InvitationHistoryDialog } from './invitation-history-dialog'
import { getReferralProgramRewards } from './referral-program'
import { ReferralProgramRules } from './referral-program-rules'

export function Affiliate() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const rewards = getReferralProgramRewards(status?.referral_program)
  const { currency } = useSystemConfig()
  const { topupInfo } = useTopupInfo()
  const [user, setUser] = useState<UserWalletData | null>(null)
  const [affiliateLink, setAffiliateLink] = useState('')
  const [loading, setLoading] = useState(true)
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferring, setTransferring] = useState(false)

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

  return (
    <Main>
      <div className='min-h-0 min-w-0 flex-1 overflow-auto px-4 py-5 sm:px-6 sm:py-8'>
        <CardStaggerContainer className='mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6'>
          <CardStaggerItem>
            <header className='flex flex-wrap items-start justify-between gap-x-3 gap-y-4'>
              <div className='flex min-w-0 flex-1 basis-56 items-center gap-3'>
                <div className='bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl'>
                  <Gift className='size-5' aria-hidden='true' />
                </div>
                <h1 className='text-xl font-semibold tracking-tight sm:text-2xl'>
                  {t('Referral Program')}
                </h1>
              </div>
              <InvitationHistoryDialog />
            </header>
          </CardStaggerItem>

          <CardStaggerItem>
            <div
              role='group'
              aria-label={t('Referral Program')}
              className='grid min-w-0 grid-cols-2 gap-4 md:grid-cols-3'
              data-testid='affiliate-summary'
            >
              {[
                {
                  label: t('Available referral balance'),
                  value: formatQuota(user?.aff_quota ?? 0),
                  icon: WalletCards,
                  primary: true,
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
                    className={cn(
                      'min-w-0 gap-4 rounded-2xl py-5',
                      stat.primary &&
                        'bg-primary/5 col-span-2 md:col-span-1 md:row-span-2'
                    )}
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
                    <CardContent className='flex flex-1 flex-col justify-between px-5'>
                      {loading ? (
                        <Skeleton className='h-9 w-28' />
                      ) : (
                        <div
                          className={cn(
                            'font-semibold tracking-tight [overflow-wrap:anywhere] tabular-nums',
                            stat.primary
                              ? 'text-4xl sm:text-5xl'
                              : 'text-2xl sm:text-3xl'
                          )}
                        >
                          {stat.value}
                        </div>
                      )}
                      {stat.primary ? (
                        <div>
                          <Button
                            type='button'
                            className='mt-6 min-h-11 w-full whitespace-normal'
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
                          {!complianceConfirmed ? (
                            <p className='text-muted-foreground mt-3 text-xs leading-5'>
                              {t(
                                'Referral reward transfer is disabled until the administrator confirms compliance terms.'
                              )}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                )
              })}
              <Card
                data-card-hover='false'
                className='col-span-2 min-w-0 gap-4 rounded-2xl py-5'
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
                      className='min-h-11 w-full px-4 whitespace-normal sm:w-auto'
                    >
                      {t('Copy referral link')}
                    </CopyButton>
                  </div>
                </CardContent>
              </Card>
            </div>
          </CardStaggerItem>
          {rewards ? (
            <CardStaggerItem>
              <Card data-card-hover='false' className='rounded-2xl py-5'>
                <CardHeader className='px-5'>
                  <CardTitle>{t('Rules')}</CardTitle>
                </CardHeader>
                <CardContent className='px-5'>
                  <ReferralProgramRules rewards={rewards} />
                </CardContent>
              </Card>
            </CardStaggerItem>
          ) : null}
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
