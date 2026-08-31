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
type LotteryPrizeType = string
type LotteryDrawStatus = 'awarded' | 'no_prize' | 'revoked' | ''

export interface LotteryPrize {
  type: LotteryPrizeType
  name: string
  amount: number
  probability: number
}

export interface LotteryStreakReward {
  days: number
  chances: number
}

export interface LotteryRules {
  weekly_spend_amount: number
  weekly_chance_limit: number
  daily_active_amount: number
  streak_rewards: LotteryStreakReward[]
}

export type LotteryChanceGrantRuleType = 'recharge' | 'event'
export type LotteryRechargeGrantLimit = 'daily' | 'cumulative' | 'unlimited'

export interface LotteryChanceGrantRule {
  id: string
  type: LotteryChanceGrantRuleType
  name: string
  enabled: boolean
  threshold: number
  limit?: LotteryRechargeGrantLimit
  reclaim: boolean
  chances: number
  start_at: number
  end_at: number
}

export interface LotteryDraw {
  id: number
  prize: LotteryPrizeType
  quota: number
  status: LotteryDrawStatus
  revoked_at: number
  created_at: number
}

export interface LotteryAdminDraw extends LotteryDraw {
  user_id: number
  username: string
  event_reference: string
  revoked_by: number
  revoke_reason: string
}

export interface LotteryDrawPage {
  items: LotteryAdminDraw[]
  total: number
  page: number
  page_size: number
}

export interface LotteryUserDrawPage {
  items: LotteryDraw[]
  total: number
  page: number
  page_size: number
}

export interface LotteryDrawFilters {
  user: string
  result: 'won' | 'none' | ''
}

export type LotteryGrantSource =
  | 'recharge'
  | 'event'
  | 'weekly'
  | 'streak'
  | 'manual'
  | ''
export type LotteryGrantStatus = 'available' | 'used' | 'expired' | ''

export interface LotteryAdminGrant {
  id: number
  user_id: number
  username: string
  type: string
  source_name: string
  event_reference: string
  chances: number
  consumed: number
  expires_at: number
  created_at: number
  operator_user_id: number
  detail: string
}

export interface LotteryManualGrantRequest {
  user: string
  chances: number
  reason: string
  expires_at: number
  request_id: string
}

export interface LotteryGrantPage {
  items: LotteryAdminGrant[]
  total: number
  page: number
  page_size: number
}

export interface LotteryGrantFilters {
  user: string
  source: LotteryGrantSource
  status: LotteryGrantStatus
}

interface LotteryActivity {
  id: number
  date: string
  quota: number
  active: boolean
}

export interface LotteryStatus {
  available_chances: number
  weekly_spend_quota: number
  weekly_target_quota: number
  weekly_earned_chances: number
  weekly_chance_limit: number
  today_spend_quota: number
  daily_active_quota: number
  today_active: boolean
  current_streak: number
  prizes: LotteryPrize[]
  recent_draws: LotteryDraw[]
  recent_activity: LotteryActivity[]
  rules: LotteryRules
  grant_rules?: LotteryChanceGrantRule[]
  active_grant_rules: LotteryChanceGrantRule[]
}

export interface LotteryDrawResult {
  draw: LotteryDraw
  status: LotteryStatus
}

export interface LotteryApiResponse<T> {
  success?: boolean
  message?: string
  data?: T
}

export interface LotteryConfig {
  rules: LotteryRules
  prizes: LotteryPrize[]
  grant_rules: LotteryChanceGrantRule[]
}
