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
import { z } from 'zod'

export const invoiceApplicationSchema = z
  .object({
    order_ids: z.array(z.number().int().positive()).min(1).max(100),
    title_type: z.enum(['personal', 'company']),
    title: z.string().trim().min(1).max(200),
    tax_id: z.string().trim().max(32),
    email: z.email().max(254),
    invoice_address: z.string().trim().max(300),
    invoice_phone: z.string().trim().max(50),
    bank_name: z.string().trim().max(100),
    bank_account: z.string().trim().max(64),
    remark: z.string().trim().max(1000),
  })
  .refine(
    (value) => value.title_type !== 'company' || value.tax_id.length > 0,
    { path: ['tax_id'] }
  )

export type InvoiceApplication = z.infer<typeof invoiceApplicationSchema>

export const invoiceProcessSchema = z
  .object({
    status: z.enum(['issued', 'rejected']),
    invoice_number: z.string().trim().max(100),
    invoice_url: z
      .string()
      .trim()
      .max(2000)
      .refine((value) => {
        if (value === '') return true
        try {
          const url = new URL(value)
          return url.protocol === 'https:' && !url.username && !url.password
        } catch {
          return false
        }
      }),
    note: z.string().trim().max(1000),
    send_email: z.boolean(),
  })
  .refine((value) =>
    value.status === 'issued'
      ? value.invoice_number.length > 0
      : value.note.length > 0
  )
