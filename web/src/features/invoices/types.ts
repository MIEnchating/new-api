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
export type InvoiceStatus = 'pending' | 'issued' | 'rejected'
export interface InvoiceOrder {
  id: number
  trade_no: string
  money: number
}
export interface InvoiceRequest {
  id: number
  user_id: number
  title_type: 'personal' | 'company'
  title: string
  tax_id: string
  email: string
  remark: string
  status: InvoiceStatus
  created_at: number
  processed_at: number
  processed_by: number
  invoice_number: string
  invoice_url: string
  process_note: string
  orders: InvoiceOrder[]
}
export interface InvoicePage<T> {
  items: T[]
  total: number
}
export interface InvoiceProcessInput {
  status: 'issued' | 'rejected'
  invoice_number: string
  invoice_url: string
  note: string
}
