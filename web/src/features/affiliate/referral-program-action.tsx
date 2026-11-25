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
import { Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { getAffiliateCode } from '@/features/wallet/api'
import { generateAffiliateLink } from '@/features/wallet/lib/affiliate'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getReferralProgramRewards } from './referral-program'
import { ReferralProgramRules } from './referral-program-rules'

export function ReferralProgramAction() {
  const { status } = useStatus()
  const { t, i18n } = useTranslation()
  const rewards = getReferralProgramRewards(status?.referral_program)
  if (!rewards) return null

  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const rate = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumSignificantDigits: 15,
  }).format(rewards.walletRatePercent / 100)
  const label =
    rewards.walletRatePercent > 0
      ? t('Invite friends and earn {{rate}}', { rate })
      : t('Referral Program')

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant='outline'
            aria-label={label}
            className='bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary rounded-full'
          />
        }
      >
        <Gift aria-hidden='true' />
        <span className='hidden xl:inline'>{label}</span>
      </PopoverTrigger>
      <PopoverContent
        align='end'
        sideOffset={8}
        className='max-h-(--available-height) w-80 max-w-[calc(100vw-2rem)] gap-3 overflow-y-auto overscroll-contain p-4'
      >
        <PopoverHeader>
          <PopoverTitle>{t('Referral Program')}</PopoverTitle>
        </PopoverHeader>
        <ReferralProgramRules rewards={rewards} />
        <Separator />
        <CopyButton
          size='sm'
          className='text-primary hover:text-primary h-auto self-start px-0 text-start whitespace-normal hover:bg-transparent'
          aria-label={t('Copy referral link')}
          getValue={async () => {
            const response = requireServerSuccess(await getAffiliateCode())
            return response.data ? generateAffiliateLink(response.data) : ''
          }}
        >
          {t('Copy referral link')}
        </CopyButton>
      </PopoverContent>
    </Popover>
  )
}
