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
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { ReferralProgramRewards } from './referral-program'

export function ReferralProgramRules(props: {
  rewards: ReferralProgramRewards
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const percent = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumSignificantDigits: 15,
  })
  const rewards = props.rewards

  return (
    <div className='@container text-sm'>
      <dl className='grid gap-3 @lg:grid-cols-2 @lg:gap-6'>
        {rewards.registrationRewards || rewards.firstTopupRate > 0 ? (
          <div className='space-y-1'>
            <dt className='font-medium'>
              {rewards.registrationRewards
                ? t('New user rewards')
                : t('First top-up rebate')}
            </dt>
            <dd className='text-muted-foreground space-y-0.5'>
              {rewards.registrationRewards ? (
                <p>
                  {t(
                    'Signup rewards follow site settings when friends register through your link.'
                  )}
                </p>
              ) : null}
              {rewards.firstTopupRate > 0 ? (
                <p>
                  {t(
                    'Earn {{rate}} of the credited amount on a referral’s first paid top-up.',
                    {
                      rate: percent.format(rewards.firstTopupRate),
                    }
                  )}
                </p>
              ) : null}
            </dd>
          </div>
        ) : null}
        {rewards.walletRatePercent > 0 ? (
          <div className='space-y-1'>
            <dt className='font-medium'>{t('Wallet usage commission')}</dt>
            <dd className='text-muted-foreground'>
              {t(
                'Earn {{rate}} on settled wallet charges for {{days}} days after signup via your link.',
                {
                  rate: percent.format(rewards.walletRatePercent / 100),
                  days: formatNumber(rewards.days, locale),
                }
              )}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}
