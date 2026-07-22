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
  BillingInvoiceTarget,
  InvoiceAction,
  TopUpInvoiceBatchResponse,
  TopUpInvoiceResponse,
  TopUpStatsParams,
  TopUpStatsResponse,
} from './types'

export async function getTopUpStats(
  params: TopUpStatsParams
): Promise<TopUpStatsResponse> {
  const response = await api.get('/api/user/topup/stats', { params })
  return response.data
}

export async function updateTopUpInvoice(
  target: BillingInvoiceTarget,
  action: InvoiceAction
): Promise<TopUpInvoiceResponse> {
  const response = await api.put(`/api/user/topup/${target.id}/invoice`, {
    action,
    type: target.type,
  })
  return response.data
}

export async function updateTopUpInvoices(
  items: BillingInvoiceTarget[],
  action: InvoiceAction
): Promise<TopUpInvoiceBatchResponse> {
  const response = await api.put('/api/user/topup/invoice/batch', {
    items,
    action,
  })
  return response.data
}
