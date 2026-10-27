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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { InvoiceApplicationForm } from '../components/application-form'
import { InvoiceRequestList } from '../components/request-list'
import type { InvoiceRequest } from '../types'

const clients: QueryClient[] = []
afterEach(() => {
  clients.forEach((client) => client.clear())
  clients.length = 0
})

function renderInvoice(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const pending: InvoiceRequest = {
  id: 4,
  user_id: 8,
  title_type: 'company',
  title: 'Example Company',
  tax_id: 'TAX123',
  email: 'billing@example.com',
  remark: '',
  status: 'pending',
  created_at: 1,
  processed_at: 0,
  processed_by: 0,
  invoice_number: '',
  invoice_url: '',
  process_note: '',
  orders: [{ id: 1, trade_no: 'order-one', money: 10 }],
}

it('keeps selections across pages and submits all selected orders with validated company details', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockImplementation(async (_url, config) => ({
    data: {
      success: true,
      data: {
        total: 11,
        items:
          config?.params.p === 2
            ? [{ id: 11, trade_no: 'order-eleven', money: 20 }]
            : [{ id: 1, trade_no: 'order-one', money: 10 }],
      },
    },
  }))
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: pending } })
  const submitted = vi.fn()
  renderInvoice(<InvoiceApplicationForm onSubmitted={submitted} />)
  expect(
    screen.getByRole('button', { name: 'Submit invoice application' })
  ).toBeDisabled()
  await user.click(
    await screen.findByRole('checkbox', { name: 'Select order order-one' })
  )
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  await user.click(
    await screen.findByRole('checkbox', { name: 'Select order order-eleven' })
  )
  await user.click(
    screen.getByRole('button', { name: 'Submit invoice application' })
  )
  expect(await screen.findAllByRole('alert')).not.toHaveLength(0)
  expect(post).not.toHaveBeenCalled()
  await user.type(screen.getByLabelText('Invoice title'), 'Example Company')
  await user.type(screen.getByLabelText('Tax identification number'), 'TAX123')
  await user.type(screen.getByLabelText('Invoice email'), 'billing@example.com')
  await user.click(
    screen.getByRole('button', { name: 'Submit invoice application' })
  )
  await waitFor(() => expect(submitted).toHaveBeenCalledOnce())
  expect(post).toHaveBeenCalledWith(
    '/api/user/invoices',
    expect.objectContaining({
      order_ids: [1, 11],
      title_type: 'company',
      title: 'Example Company',
      tax_id: 'TAX123',
      email: 'billing@example.com',
    })
  )
})

it('retains personal invoice input and selection when submission fails', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { total: 1, items: [{ id: 1, trade_no: 'order-one', money: 10 }] },
    },
  })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: false,
      message: 'An order already has a pending invoice application',
    },
  })
  const submitted = vi.fn()
  renderInvoice(<InvoiceApplicationForm onSubmitted={submitted} />)
  await user.click(
    await screen.findByRole('checkbox', { name: 'Select order order-one' })
  )
  await user.selectOptions(
    screen.getByLabelText('Invoice title type'),
    'personal'
  )
  await user.type(screen.getByLabelText('Invoice title'), 'Alice')
  await user.type(screen.getByLabelText('Invoice email'), 'alice@example.com')
  await user.click(
    screen.getByRole('button', { name: 'Submit invoice application' })
  )
  await waitFor(() => expect(post).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Submit invoice application' })
    ).toBeEnabled()
  )
  expect(submitted).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Invoice title')).toHaveValue('Alice')
  expect(
    screen.getByRole('checkbox', { name: 'Select order order-one' })
  ).toBeChecked()
})

it('requires a rejection reason and sends the administrator decision', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { total: 1, items: [pending] } },
  })
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: { ...pending, status: 'rejected' } },
  })
  renderInvoice(<InvoiceRequestList admin />)
  await user.click(
    await screen.findByRole('button', { name: 'Reject application' })
  )
  const dialog = screen.getByRole('alertdialog')
  expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeDisabled()
  await user.type(
    within(dialog).getByLabelText('Rejection reason'),
    'Please correct the title'
  )
  await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/invoices/4', {
      status: 'rejected',
      invoice_number: '',
      invoice_url: '',
      note: 'Please correct the title',
    })
  )
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
})

it('requires an invoice number and a safe optional link before completing invoicing', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { total: 1, items: [pending] } },
  })
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: { ...pending, status: 'issued' } },
  })
  renderInvoice(<InvoiceRequestList admin />)
  await user.click(
    await screen.findByRole('button', { name: 'Complete invoicing' })
  )
  const dialog = screen.getByRole('alertdialog')
  const confirm = within(dialog).getByRole('button', { name: 'Confirm' })
  expect(confirm).toBeDisabled()
  await user.type(within(dialog).getByLabelText('Invoice number'), 'INV-001')
  await user.type(
    within(dialog).getByLabelText('Invoice link (HTTPS, optional)'),
    'javascript:alert(1)'
  )
  expect(confirm).toBeDisabled()
  await user.clear(
    within(dialog).getByLabelText('Invoice link (HTTPS, optional)')
  )
  await user.click(confirm)
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/invoices/4', {
      status: 'issued',
      invoice_number: 'INV-001',
      invoice_url: '',
      note: '',
    })
  )
})

it('shows personal processing results without administrator actions', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 1,
        items: [
          {
            ...pending,
            status: 'issued',
            invoice_number: 'INV-001',
            invoice_url: 'https://example.com/invoice',
            process_note: 'Sent by email',
            processed_at: 2,
          },
        ],
      },
    },
  })
  renderInvoice(<InvoiceRequestList admin={false} />)
  expect(
    await screen.findByRole('link', { name: 'View invoice' })
  ).toHaveAttribute('href', 'https://example.com/invoice')
  expect(screen.getByText('Processing note: Sent by email')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Complete invoicing' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Reject application' })
  ).not.toBeInTheDocument()
})

it('shows an error with retry, then an empty state after a successful retry', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({
      data: { success: true, data: { total: 0, items: [] } },
    })
  renderInvoice(<InvoiceRequestList admin={false} />)
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No invoice applications')).toBeVisible()
})
