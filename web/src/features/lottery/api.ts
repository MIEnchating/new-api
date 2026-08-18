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
import { api } from '@/lib/api'

import type {
  LotteryApiResponse,
  LotteryConfig,
  LotteryDrawPage,
  LotteryDrawFilters,
  LotteryDrawResult,
  LotteryStatus,
  LotteryUserDrawPage,
} from './types'

export async function getLotteryStatus(): Promise<
  LotteryApiResponse<LotteryStatus>
> {
  const response = await api.get('/api/user/lottery')
  return response.data
}

export async function drawLottery(): Promise<
  LotteryApiResponse<LotteryDrawResult>
> {
  const response = await api.post('/api/user/lottery/draw', {}, {
    skipBusinessError: true,
  } as Record<string, unknown>)
  return response.data
}

export async function getLotteryConfig(): Promise<
  LotteryApiResponse<LotteryConfig>
> {
  const response = await api.get('/api/user/lottery/config')
  return response.data
}

export async function updateLotteryConfig(
  config: LotteryConfig
): Promise<LotteryApiResponse<LotteryConfig>> {
  const response = await api.put('/api/user/lottery/config', config)
  return response.data
}

export async function getAllLotteryDraws(
  page: number,
  pageSize: number,
  filters: LotteryDrawFilters
): Promise<LotteryApiResponse<LotteryDrawPage>> {
  const params = new URLSearchParams({
    p: String(page),
    page_size: String(pageSize),
  })
  if (filters.user) params.set('user', filters.user)
  if (filters.result) params.set('result', filters.result)
  const response = await api.get(`/api/user/lottery/draws?${params}`)
  return response.data
}

export async function getUserLotteryDraws(
  page: number,
  pageSize: number
): Promise<LotteryApiResponse<LotteryUserDrawPage>> {
  const params = new URLSearchParams({
    p: String(page),
    page_size: String(pageSize),
  })
  const response = await api.get(`/api/user/lottery/draws/self?${params}`)
  return response.data
}

export async function revokeLotteryReward(
  drawId: number,
  reason: string
): Promise<LotteryApiResponse<null>> {
  const response = await api.post(`/api/user/lottery/draws/${drawId}/revoke`, {
    reason,
  })
  return response.data
}
