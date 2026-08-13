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
export type TopUpStatsSummary = {
  order_count: number
  user_count: number
  total_money: number
  invoice_count: number
}

export type TopUpStatus = 'success' | 'pending' | 'failed' | 'expired'
export type InvoiceStatus = 0 | 1 | 2
export type InvoiceAction = 'issue' | 'return'
export type BillingRecordType =
  | 'online_topup'
  | 'redemption'
  | 'affiliate_transfer'
  | 'admin_adjustment'
  | 'lottery_reward'
  | 'lottery_reversal'

export type TopUpStatsItem = {
  id: string
  topup_id?: number
  redemption_id?: number
  type: BillingRecordType
  reference: string
  user_id: number
  username: string
  display_name: string
  payment_method: string
  payment_provider: string
  quota: number
  money: number
  status: TopUpStatus
  created_at: number
  invoice_status: InvoiceStatus
  invoiced_at: number
  invoiced_by: number
  invoice_returned_at: number
  invoice_returned_by: number
  invoice_eligible: boolean
  excluded_from_stats: boolean
  operator_user_id?: number
  detail?: string
}

export type TopUpInvoiceResponse = {
  success: boolean
  message: string
  data?: unknown
}

export type TopUpStatsData = {
  summary: TopUpStatsSummary
  type_counts: Record<BillingRecordType, number>
  type_quotas: Record<BillingRecordType, number>
  items: TopUpStatsItem[]
  total: number
  page: number
  page_size: number
  daily_stats?: TopUpStatsDailyStat[]
}

export type TopUpStatsDailyStat = {
  date: string
  online_topup: number
  redemption: number
  admin_adjustment: number
  lottery: number
  total: number
}

export type TopUpStatsResponse = {
  success: boolean
  message: string
  data?: TopUpStatsData
}

export type TopUpStatsParams = {
  start_time: number
  end_time: number
  p: number
  page_size: number
  keyword?: string
  user_keyword?: string
  types?: string
  status?: string
  payment_method?: string
  invoice_status?: string
  include_daily?: boolean
}

export type TopUpInvoiceBatchResponse = {
  success: boolean
  message: string
  data?: {
    count: number
    items: TopUpStatsItem[]
  }
}

export type BillingInvoiceTarget = {
  id: number
  type: 'online_topup' | 'redemption'
}
