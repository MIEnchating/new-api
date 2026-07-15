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
  average_order_money: number
}

export type UserTopUpStat = {
  user_id: number
  username: string
  display_name: string
  order_count: number
  total_money: number
  average_order_money: number
  last_complete_time: number
}

export type TopUpStatsData = {
  summary: TopUpStatsSummary
  items: UserTopUpStat[]
  total: number
  page: number
  page_size: number
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
}
