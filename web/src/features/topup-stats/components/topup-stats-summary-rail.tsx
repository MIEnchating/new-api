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
import { FileCheck2, ReceiptText, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber, formatQuota } from '@/lib/format'

import type { TopUpStatsItem, TopUpStatsSummary } from '../types'

type TopUpStatsSummaryRailProps = {
  typeQuotas: Record<TopUpStatsItem['type'], number>
  lotteryQuota: number
  totalQuota: number
  summary: TopUpStatsSummary
  loading: boolean
}

export function TopUpStatsSummaryRail(props: TopUpStatsSummaryRailProps) {
  const { t } = useTranslation()
  const metrics = useMemo(
    () => [
      {
        label: t('Successful orders'),
        value: formatNumber(props.summary.order_count),
        icon: ReceiptText,
        iconClassName: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
      },
      {
        label: t('Paying users'),
        value: formatNumber(props.summary.user_count),
        icon: Users,
        iconClassName: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      },
      {
        label: t('Invoiced orders'),
        value: formatNumber(props.summary.invoice_count),
        icon: FileCheck2,
        iconClassName: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
      },
    ],
    [props.summary, t]
  )

  return (
    <div
      data-mobile-summary-rail
      className='no-scrollbar -mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-0.5 sm:mx-0 sm:flex-1 sm:flex-wrap sm:items-center sm:overflow-visible sm:px-0 sm:pb-0'
    >
      <TypeQuotaBadge
        label={t('Online payment')}
        value={props.typeQuotas.online_topup}
        accent='bg-emerald-500/70'
        loading={props.loading}
      />
      <TypeQuotaBadge
        label={t('Redemption Code')}
        value={props.typeQuotas.redemption}
        accent='bg-sky-500/70'
        loading={props.loading}
      />
      <TypeQuotaBadge
        label={t('Admin Adjustment')}
        value={props.typeQuotas.admin_adjustment}
        accent='bg-amber-500/70'
        loading={props.loading}
      />
      <TypeQuotaBadge
        label={t('Lottery amount')}
        value={props.lotteryQuota}
        accent='bg-pink-500/70'
        loading={props.loading}
      />
      <TypeQuotaBadge
        label={t('Total Quota')}
        value={props.totalQuota}
        accent='bg-foreground/60'
        loading={props.loading}
      />
      <div className='bg-border mx-0.5 hidden h-5 w-px shrink-0 xl:block' />
      {metrics.map((metric) => (
        <SummaryMetricBadge
          key={metric.label}
          label={metric.label}
          value={metric.value}
          icon={metric.icon}
          iconClassName={metric.iconClassName}
          loading={props.loading}
        />
      ))}
    </div>
  )
}

function TypeQuotaBadge(props: {
  label: string
  value: number
  accent: string
  loading: boolean
}) {
  return (
    <span
      data-summary-item
      className='border-border/60 bg-muted/25 inline-flex h-8 min-w-[8.5rem] shrink-0 items-center gap-2 rounded-md border px-2.5 text-xs shadow-xs sm:h-9 sm:min-w-0 sm:shrink'
    >
      <span className={`h-4 w-0.5 shrink-0 rounded-full ${props.accent}`} />
      <span className='text-muted-foreground min-w-0 flex-1 truncate'>
        {props.label}
      </span>
      {props.loading ? (
        <Skeleton className='h-3.5 w-7' />
      ) : (
        <span className='text-foreground/85 font-mono font-semibold tabular-nums'>
          {formatQuota(props.value)}
        </span>
      )}
    </span>
  )
}

function SummaryMetricBadge(props: {
  label: string
  value: string
  icon: typeof ReceiptText
  iconClassName: string
  loading: boolean
}) {
  const Icon = props.icon
  return (
    <div
      data-summary-item
      className='border-border/60 bg-card inline-flex h-8 min-w-[8.5rem] shrink-0 items-center gap-2 rounded-md border px-2 shadow-xs sm:h-9 sm:min-w-0 sm:shrink sm:px-2.5'
    >
      <span
        className={`flex size-5 shrink-0 items-center justify-center rounded sm:size-6 ${props.iconClassName}`}
      >
        <Icon className='size-3.5' aria-hidden='true' />
      </span>
      <span className='text-muted-foreground min-w-0 flex-1 truncate text-[11px] sm:text-xs sm:whitespace-nowrap'>
        {props.label}
      </span>
      {props.loading ? (
        <Skeleton className='h-4 w-8' />
      ) : (
        <span
          className='max-w-20 min-w-0 truncate font-mono text-xs font-semibold tabular-nums sm:max-w-28 sm:text-sm'
          title={props.value}
        >
          {props.value}
        </span>
      )}
    </div>
  )
}
