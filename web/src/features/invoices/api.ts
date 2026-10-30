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
  EligibleInvoiceOrder,
  InvoicePage,
  InvoiceProcessInput,
  InvoiceProcessResult,
  InvoiceUploadResult,
  InvoiceRequest,
  InvoiceSearch,
  InvoiceNotificationSettings,
  InvoiceEmailTemplate,
  InvoiceEmailTemplates,
  InvoiceSettings,
} from './types'

interface Response<T> {
  success: boolean
  data: T
}

export async function getInvoiceEmailTemplates() {
  const response = await api.get<
    Response<{
      templates: InvoiceEmailTemplates
      defaults: InvoiceEmailTemplates
    }>
  >('/api/user/invoices/email-templates')
  return requireServerSuccess(response.data).data
}

export async function saveInvoiceEmailTemplates(input: InvoiceEmailTemplates) {
  const response = await api.put<Response<null>>(
    '/api/user/invoices/email-templates',
    input
  )
  requireServerSuccess(response.data)
}

export async function previewInvoiceEmail(
  kind: keyof InvoiceEmailTemplates,
  input: InvoiceEmailTemplate,
  signal?: AbortSignal
) {
  const response = await api.post<Response<InvoiceEmailTemplate>>(
    '/api/user/invoices/email-templates/preview',
    { kind, ...input },
    { signal }
  )
  return requireServerSuccess(response.data).data
}

export async function getInvoiceOrders(
  page: number,
  pageSize = 10,
  filters: InvoiceSearch = {}
): Promise<InvoicePage<EligibleInvoiceOrder>> {
  const response = await api.get<Response<InvoicePage<EligibleInvoiceOrder>>>(
    '/api/user/invoices/eligible',
    { params: { p: page, page_size: pageSize, ...filters } }
  )
  return requireServerSuccess(response.data).data
}
export async function getInvoiceRequests(
  admin: boolean,
  page: number,
  status: string,
  pageSize = 10,
  filters: InvoiceSearch = {}
): Promise<InvoicePage<InvoiceRequest>> {
  const response = await api.get<Response<InvoicePage<InvoiceRequest>>>(
    admin ? '/api/user/invoices' : '/api/user/invoices/self',
    { params: { p: page, page_size: pageSize, status, ...filters } }
  )
  return requireServerSuccess(response.data).data
}

export async function uploadInvoiceFile(id: number, file: File) {
  const form = new FormData()
  form.append('file', file)
  const response = await api.post<Response<InvoiceUploadResult>>(
    `/api/user/invoices/${id}/file`,
    form
  )
  return requireServerSuccess(response.data).data
}

export async function getInvoiceFile(id: number, signal?: AbortSignal) {
  const response = await api.get<Blob>(`/api/user/invoices/${id}/file`, {
    responseType: 'blob',
    signal,
    disableDuplicate: true,
  })
  const extension = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
  }[response.data.type]
  if (!extension) throw new Error('Invoice file is not available')
  const disposition = String(response.headers?.['content-disposition'] ?? '')
  const encoded = disposition.match(/filename\*=utf-8''([^;]+)/i)?.[1]
  const plain = disposition.match(/filename="([^"]+)"|filename=([^;]+)/i)
  const filename = encoded
    ? decodeURIComponent(encoded)
    : (plain?.[1] ?? plain?.[2] ?? `invoice-${id}.${extension}`)
  return { blob: response.data, filename }
}

export async function downloadInvoiceFile(id: number) {
  const file = await getInvoiceFile(id)
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function sendInvoiceEmail(id: number) {
  const response = await api.post<Response<null>>(
    `/api/user/invoices/${id}/email`
  )
  requireServerSuccess(response.data)
}

export async function getInvoiceNotificationSettings() {
  const response = await api.get<Response<InvoiceNotificationSettings>>(
    '/api/user/invoices/notifications'
  )
  return requireServerSuccess(response.data).data
}

export async function saveInvoiceNotificationSettings(user_ids: number[]) {
  const response = await api.put<Response<null>>(
    '/api/user/invoices/notifications',
    { user_ids }
  )
  requireServerSuccess(response.data)
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
export async function withdrawInvoiceRequest(
  id: number
): Promise<InvoiceRequest> {
  const response = await api.post<Response<InvoiceRequest>>(
    `/api/user/invoices/${id}/withdraw`
  )
  return requireServerSuccess(response.data).data
}
export async function processInvoiceRequest(
  id: number,
  input: InvoiceProcessInput
): Promise<InvoiceProcessResult> {
  const response = await api.put<Response<InvoiceProcessResult>>(
    `/api/user/invoices/${id}`,
    input
  )
  return requireServerSuccess(response.data).data
}

export async function getInvoiceSettings(): Promise<InvoiceSettings> {
  const response = await api.get<Response<InvoiceSettings>>(
    '/api/user/invoices/settings'
  )
  const settings = requireServerSuccess(response.data).data
  if (
    !settings ||
    !Number.isFinite(settings.minimum_amount) ||
    settings.minimum_amount < 0 ||
    !Number.isInteger(settings.application_days) ||
    settings.application_days < 0 ||
    settings.application_days > 3650
  ) {
    throw new Error('Invalid minimum invoice amount')
  }
  return settings
}

export async function saveInvoiceSettings(input: InvoiceSettings) {
  const response = await api.put<Response<null>>(
    '/api/user/invoices/settings',
    input
  )
  requireServerSuccess(response.data)
}
