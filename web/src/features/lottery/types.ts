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
type LotteryPrizeType = 'quota_1' | 'quota_5' | 'quota_8' | 'none'
type LotteryDrawStatus = 'awarded' | 'no_prize' | 'revoked' | ''

export interface LotteryPrize {
  type: LotteryPrizeType
  amount: number
  probability: number
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
  prizes: LotteryPrize[]
}
