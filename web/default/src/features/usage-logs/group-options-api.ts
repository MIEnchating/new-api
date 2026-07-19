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

type UserGroupMetadata = {
  order?: number
}

type GroupData = string[] | Record<string, UserGroupMetadata> | undefined

type GroupResponse = {
  success?: boolean
  data?: GroupData
}

export function normalizeUsageLogGroups(data: GroupData): string[] {
  if (Array.isArray(data)) return data
  if (!data) return []

  return Object.entries(data)
    .sort(([, left], [, right]) => {
      const leftOrder = Number.isFinite(left.order)
        ? Number(left.order)
        : Number.MAX_SAFE_INTEGER
      const rightOrder = Number.isFinite(right.order)
        ? Number(right.order)
        : Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder
    })
    .map(([group]) => group)
}

export async function getUsageLogGroups(isAdmin: boolean): Promise<string[]> {
  const path = isAdmin ? '/api/group/' : '/api/user/self/groups'
  const res = await api.get<GroupResponse>(path)
  return normalizeUsageLogGroups(res.data?.data)
}
