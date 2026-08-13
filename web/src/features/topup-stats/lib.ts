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
import {
  CreditCard,
  Gift,
  RotateCcw,
  ShieldCheck,
  TicketPercent,
  UserRoundCheck,
} from 'lucide-react'

import type { StatusVariant } from '@/components/status-badge'

import type { BillingRecordType, InvoiceStatus } from './types'

type Translate = (key: string) => string

export function getBillingTypeConfig(type: BillingRecordType, t: Translate) {
  const configs = {
    online_topup: {
      label: t('Online Top-up'),
      icon: CreditCard,
      variant: 'success' as StatusVariant,
    },
    redemption: {
      label: t('Redemption Code'),
      icon: TicketPercent,
      variant: 'purple' as StatusVariant,
    },
    affiliate_transfer: {
      label: t('Affiliate Transfer'),
      icon: UserRoundCheck,
      variant: 'info' as StatusVariant,
    },
    admin_adjustment: {
      label: t('Admin Adjustment'),
      icon: ShieldCheck,
      variant: 'warning' as StatusVariant,
    },
    lottery_reward: {
      label: t('Lottery Reward'),
      icon: Gift,
      variant: 'pink' as StatusVariant,
    },
    lottery_reversal: {
      label: t('Lottery Reward Reversal'),
      icon: RotateCcw,
      variant: 'danger' as StatusVariant,
    },
  }
  return configs[type]
}

type BillingTypeQuotas = Record<BillingRecordType, number>

const SELECTABLE_ORDER_TYPES: BillingRecordType[] = [
  'online_topup',
  'redemption',
  'admin_adjustment',
  'lottery_reward',
  'lottery_reversal',
]

export function getOrderManagementTypes(selectedTypes: string[]) {
  const visibleTypes =
    selectedTypes.length > 0 ? selectedTypes : SELECTABLE_ORDER_TYPES
  return visibleTypes
}

export function getLotteryNetQuota(typeQuotas: BillingTypeQuotas) {
  return (typeQuotas.lottery_reward ?? 0) + (typeQuotas.lottery_reversal ?? 0)
}

export function getOrderManagementTotalQuota(typeQuotas: BillingTypeQuotas) {
  return (
    typeQuotas.online_topup +
    typeQuotas.redemption +
    typeQuotas.admin_adjustment -
    getLotteryNetQuota(typeQuotas)
  )
}

export function getInvoiceStatusConfig(status: InvoiceStatus, t: Translate) {
  const configs = {
    0: { label: t('Not invoiced'), variant: 'neutral' as StatusVariant },
    1: { label: t('Invoiced'), variant: 'success' as StatusVariant },
    2: { label: t('Returned'), variant: 'warning' as StatusVariant },
  }
  return configs[status]
}
