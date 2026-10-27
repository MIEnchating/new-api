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
import { requireServerSuccess } from '@/lib/server-error-message'

import type { InvoiceApplication } from './lib/schema'
import type {
  InvoiceOrder,
  InvoicePage,
  InvoiceProcessInput,
  InvoiceRequest,
} from './types'

interface Response<T> {
  success: boolean
  data: T
}

export async function getInvoiceOrders(
  page: number
): Promise<InvoicePage<InvoiceOrder>> {
  const response = await api.get<Response<InvoicePage<InvoiceOrder>>>(
    '/api/user/invoices/eligible',
    { params: { p: page, page_size: 10 } }
  )
  return requireServerSuccess(response.data).data
}
export async function getInvoiceRequests(
  admin: boolean,
  page: number,
  status: string
): Promise<InvoicePage<InvoiceRequest>> {
  const response = await api.get<Response<InvoicePage<InvoiceRequest>>>(
    admin ? '/api/user/invoices' : '/api/user/invoices/self',
    { params: { p: page, page_size: 10, status } }
  )
  return requireServerSuccess(response.data).data
}
export async function createInvoiceRequest(
  input: InvoiceApplication
): Promise<InvoiceRequest> {
  const response = await api.post<Response<InvoiceRequest>>(
    '/api/user/invoices',
    input
  )
  return requireServerSuccess(response.data).data
}
export async function processInvoiceRequest(
  id: number,
  input: InvoiceProcessInput
): Promise<InvoiceRequest> {
  const response = await api.put<Response<InvoiceRequest>>(
    `/api/user/invoices/${id}`,
    input
  )
  return requireServerSuccess(response.data).data
}
