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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { InvoiceApplicationForm } from '../components/application-form'
import { InvoiceEmailTemplatesDialog } from '../components/email-templates'
import { InvoiceNotificationDialog } from '../components/notification-settings'
import { InvoiceOrderPicker } from '../components/order-picker'
import { InvoiceProcessDialog } from '../components/process-dialog'
import { InvoiceRequestList } from '../components/request-list'
import { InvoiceSettingsDialog } from '../components/settings'
import { InvoicesPage } from '../index'
import type { InvoiceRequest } from '../types'

const clients: QueryClient[] = []
afterEach(() => {
  clients.forEach((client) => client.clear())
  clients.length = 0
  useAuthStore.getState().auth.setUser(null)
})

function renderInvoice(ui?: React.ReactNode, minimumAmount: number | null = 0) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (minimumAmount !== null) {
    client.setQueryDefaults(['invoices', 'settings'], { staleTime: Infinity })
    client.setQueryData(['invoices', 'settings'], {
      minimum_amount: minimumAmount,
      application_days: 90,
    })
  }
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      {ui ?? <InvoicesPage />}
    </QueryClientProvider>
  )
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

it('searches admin applications by applicant, keyword and date range and resets all filters', async () => {
  const user = userEvent.setup()
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 1,
        items: [
          {
            ...pending,
            username: 'invoice-owner',
            display_name: 'Invoice Applicant',
          },
        ],
      },
    },
  })
  renderInvoice(<InvoiceRequestList admin />)
  expect(await screen.findByText('Invoice Applicant')).toBeVisible()
  await user.type(
    screen.getByRole('textbox', { name: 'Search invoice applications' }),
    'TAX123'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Search users by ID or name...' }),
    'invoice-owner'
  )
  await user.click(screen.getByRole('button', { name: 'Date Range' }))
  await user.click(screen.getByRole('button', { name: '7 Days' }))
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith('/api/user/invoices', {
      params: expect.objectContaining({
        keyword: 'TAX123',
        user: 'invoice-owner',
        status: 'pending',
        start_timestamp: expect.any(Number),
        end_timestamp: expect.any(Number),
        p: 1,
      }),
    })
  )
  await user.click(screen.getByRole('button', { name: 'Reset' }))
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith('/api/user/invoices', {
      params: { p: 1, page_size: 10, status: '' },
    })
  )
  expect(
    screen.getByRole('textbox', { name: 'Search invoice applications' })
  ).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Date Range' })).toBeVisible()
})

it('keeps selected orders when filtering eligible orders by date only', async () => {
  const user = userEvent.setup()
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 1,
        items: [{ id: 2, trade_no: 'order-two', money: 20 }],
      },
    },
  })
  const onChange = vi.fn()
  renderInvoice(
    <InvoiceOrderPicker
      selected={[{ id: 1, trade_no: 'order-one', money: 10 }]}
      onChange={onChange}
      disabled={false}
    />
  )
  expect(
    screen.queryByRole('textbox', { name: 'Order Number' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Date Range' }))
  await user.click(screen.getByRole('button', { name: 'Today' }))
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith('/api/user/invoices/eligible', {
      params: expect.objectContaining({
        start_timestamp: expect.any(Number),
        end_timestamp: expect.any(Number),
      }),
    })
  )
  await user.click(
    await screen.findByRole('checkbox', { name: 'Select order order-two' })
  )
  expect(onChange).toHaveBeenLastCalledWith([
    { id: 1, trade_no: 'order-one', money: 10 },
    { id: 2, trade_no: 'order-two', money: 20 },
  ])
})

it('disables completion during upload and retains the uploaded file when issuing', async () => {
  const user = userEvent.setup()
  let completeUpload: (response: unknown) => void = () => {}
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        completeUpload = resolve
      })
  )
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: pending } })
  renderInvoice(
    <InvoiceProcessDialog request={pending} action='issued' onClose={vi.fn()} />
  )
  expect(screen.getByRole('switch', { name: 'Send to email' })).toBeChecked()
  const file = new File(['%PDF-1.7 invoice'], 'invoice.pdf', {
    type: 'application/pdf',
  })
  await user.upload(screen.getByLabelText('Invoice file'), file)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  )
  expect(post).toHaveBeenCalledWith(
    '/api/user/invoices/4/file',
    expect.any(FormData)
  )
  expect((post.mock.calls[0][1] as FormData).get('file')).toBe(file)
  completeUpload({
    data: {
      success: true,
      data: {
        invoice_url: 'invoice-file:stored.pdf',
        invoice_number: '12345678901234567890',
      },
    },
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
  )
  expect(
    screen.queryByLabelText('Invoice link (HTTPS, optional)')
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/user/invoices/4',
      expect.objectContaining({
        invoice_number: '12345678901234567890',
        invoice_url: '',
        send_email: true,
      })
    )
  )
})

it('offers issued invoice download and sends mail without accepting a destination override', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 1,
        items: [
          {
            ...pending,
            status: 'issued',
            invoice_url: 'invoice-file:stored.pdf',
          },
        ],
      },
    },
  })
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValue(new Error('delivery unavailable'))
  renderInvoice(<InvoiceRequestList admin={false} />)
  await user.click(await screen.findByRole('button', { name: 'View details' }))
  expect(screen.getByRole('button', { name: 'Download invoice' })).toBeVisible()
  expect(screen.queryByLabelText('Invoice file')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Send to email' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/user/invoices/4/email')
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send to email' })).toBeEnabled()
  )
  post.mockResolvedValue({ data: { success: true, data: null } })
  await user.click(screen.getByRole('button', { name: 'Send to email' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
})

it('loads administrator notification recipients and saves the selected administrators', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        user_ids: [],
        administrators: [
          { id: 7, username: 'admin', display_name: 'Billing Admin' },
        ],
      },
    },
  })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: null } })
  renderInvoice(<InvoiceNotificationDialog />)
  await user.click(
    screen.getByRole('button', { name: 'Notification settings' })
  )
  await user.click(
    await screen.findByRole('combobox', { name: 'Select administrators' })
  )
  await user.click(
    await screen.findByRole('option', { name: 'Billing Admin (admin · #7)' })
  )
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/invoices/notifications', {
      user_ids: [7],
    })
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

it('keeps selections across pages and submits all selected orders with validated company details', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockImplementation(async (_url, config) => {
    const params = config?.params
    const secondPage =
      typeof params === 'object' &&
      params !== null &&
      'p' in params &&
      params.p === 2
    return {
      data: {
        success: true,
        data: {
          total: 11,
          items: secondPage
            ? [{ id: 11, trade_no: 'order-eleven', money: 20.1 }]
            : [
                {
                  id: 1,
                  trade_no: 'order-one',
                  money: 10.25,
                  payment_method: 'alipay',
                  status: 'success',
                  create_time: 1793110000,
                  complete_time: 1793110060,
                },
              ],
        },
      },
    }
  })
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
  expect(screen.queryByText('Alipay')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('columnheader', { name: 'Payment Method' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('columnheader', { name: 'Order status' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('columnheader', { name: 'Payment time' })
  ).toBeVisible()
  expect(
    screen.queryByRole('columnheader', { name: 'Completion time' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(
      'Select paid top-up orders to request an invoice. Up to 100 orders per application.'
    )
  ).not.toBeInTheDocument()
  expect(screen.getByLabelText('Invoice amount')).toHaveTextContent('10.25')
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  await user.click(
    await screen.findByRole('checkbox', { name: 'Select order order-eleven' })
  )
  expect(screen.getByLabelText('Invoice amount')).toHaveTextContent('30.35')
  await user.click(
    screen.getByRole('checkbox', { name: 'Select order order-eleven' })
  )
  expect(screen.getByLabelText('Invoice amount')).toHaveTextContent('10.25')
  await user.click(
    screen.getByRole('checkbox', { name: 'Select order order-eleven' })
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
    screen.getByRole('button', { name: 'Optional invoice details' })
  )
  await user.type(
    screen.getByLabelText('Invoice address'),
    '  12 Main Street  '
  )
  await user.type(screen.getByLabelText('Invoice phone number'), '123456')
  await user.type(screen.getByLabelText('Bank name'), 'Example Bank')
  await user.type(screen.getByLabelText('Bank account number'), '0012345')
  const optionalDetails = screen.getByRole('button', {
    name: 'Optional invoice details',
  })
  expect(optionalDetails).toHaveAttribute('aria-expanded', 'true')
  await user.click(optionalDetails)
  expect(optionalDetails).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByLabelText('Bank account number')).not.toBeVisible()
  await user.keyboard('{Enter}')
  expect(optionalDetails).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByLabelText('Bank account number')).toHaveValue('0012345')

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
      invoice_address: '12 Main Street',
      invoice_phone: '123456',
      bank_name: 'Example Bank',
      bank_account: '0012345',
    })
  )
})

it('retains company invoice input and selection when submission fails', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 1,
        items: [
          {
            id: 1,
            trade_no: 'order-one',
            money: 10,
            payment_method: 'alipay',
            status: 'success',
            create_time: 1793110000,
            complete_time: 1793110060,
          },
        ],
      },
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
  expect(
    screen.queryByRole('combobox', { name: 'Invoice title type' })
  ).not.toBeInTheDocument()
  await user.type(screen.getByLabelText('Invoice title'), 'Alice')
  await user.type(screen.getByLabelText('Tax identification number'), 'TAX123')
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
  await user.click(await screen.findByRole('button', { name: 'View details' }))
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
      send_email: false,
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
  await user.click(await screen.findByRole('button', { name: 'View details' }))
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
  expect(confirm).toBeDisabled()
  await user.click(
    within(dialog).getByRole('switch', { name: 'Send to email' })
  )
  await user.click(confirm)
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/invoices/4', {
      status: 'issued',
      invoice_number: 'INV-001',
      invoice_url: '',
      note: '',
      send_email: false,
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
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'View details' }))
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

it('opens an application dialog from the list and restores the list after submission', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: {
        total: 1,
        items:
          url === '/api/user/invoices/eligible'
            ? [
                {
                  id: 1,
                  trade_no: 'order-one',
                  money: 10,
                  payment_method: 'alipay',
                  status: 'success',
                  create_time: 1793110000,
                  complete_time: 1793110060,
                },
              ]
            : [pending],
      },
    },
  }))
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: pending },
  })
  renderInvoice()
  expect(
    await screen.findByRole('heading', { name: 'Invoice applications' })
  ).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Invoice title')).not.toBeInTheDocument()
  expect(
    screen.queryByText(
      'Select paid orders, submit invoice details, and track progress.'
    )
  ).not.toBeInTheDocument()
  await user.click(
    await screen.findByRole('button', { name: 'Request invoice' })
  )
  expect(
    await screen.findByRole('dialog', { name: 'Request invoice' })
  ).toBeVisible()
  await user.click(
    await screen.findByRole('checkbox', { name: 'Select order order-one' })
  )
  await user.type(screen.getByLabelText('Invoice title'), 'Example Company')
  await user.type(screen.getByLabelText('Tax identification number'), 'TAX123')
  await user.type(screen.getByLabelText('Invoice email'), 'billing@example.com')
  await user.click(
    screen.getByRole('button', { name: 'Submit invoice application' })
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Request invoice' })
    ).not.toBeInTheDocument()
  )
  expect(
    await screen.findByRole('cell', { name: /Example Company/ })
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Complete invoicing' })
  ).not.toBeInTheDocument()
})

it('opens administrator processing directly as a page without the application tabs', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { total: 1, items: [pending] } },
  })
  renderInvoice(<InvoicesPage admin />)
  expect(
    await screen.findByRole('button', { name: 'View details' })
  ).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('tab', { name: 'Request invoice' })
  ).not.toBeInTheDocument()
  expect(get).toHaveBeenCalledWith(
    '/api/user/invoices',
    expect.objectContaining({
      params: expect.objectContaining({ status: 'pending' }),
    })
  )
})

it('clears orders selected on multiple pages without losing invoice details', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockImplementation(async (_url, config) => {
    const params = config?.params
    const secondPage =
      typeof params === 'object' &&
      params !== null &&
      'p' in params &&
      params.p === 2
    return {
      data: {
        success: true,
        data: {
          total: 11,
          items: secondPage
            ? [{ id: 11, trade_no: 'order-eleven', money: 20 }]
            : [
                {
                  id: 1,
                  trade_no: 'order-one',
                  money: 10,
                  payment_method: 'alipay',
                  status: 'success',
                  create_time: 1793110000,
                  complete_time: 1793110060,
                },
              ],
        },
      },
    }
  })
  renderInvoice(<InvoiceApplicationForm onSubmitted={vi.fn()} />)
  const orders = screen.getByRole('region', { name: 'Select orders' })
  const details = screen.getByRole('region', { name: 'Invoice details' })
  await user.type(
    within(details).getByLabelText('Invoice title'),
    'Retained title'
  )
  await user.click(
    await within(orders).findByRole('checkbox', {
      name: 'Select order order-one',
    })
  )
  await user.click(
    within(orders).getByRole('button', { name: 'Go to next page' })
  )
  await user.click(
    await within(orders).findByRole('checkbox', {
      name: 'Select order order-eleven',
    })
  )
  await user.click(
    within(orders).getByRole('button', { name: 'Clear selection' })
  )
  expect(screen.getByLabelText('Invoice amount')).toHaveTextContent(/^0$/)
  expect(
    screen.queryByText(
      'Select 1 to 100 eligible paid orders belonging to your account'
    )
  ).not.toBeInTheDocument()
  expect(
    within(orders).getByRole('checkbox', { name: 'Select order order-eleven' })
  ).not.toBeChecked()
  expect(within(details).getByLabelText('Invoice title')).toHaveValue(
    'Retained title'
  )
  expect(
    screen.getByRole('button', { name: 'Submit invoice application' })
  ).toBeDisabled()
  await user.click(
    within(orders).getByRole('button', { name: 'Go to previous page' })
  )
  expect(
    await within(orders).findByRole('checkbox', {
      name: 'Select order order-one',
    })
  ).not.toBeChecked()
})

it('opens a selected application in a drawer and returns to the compact list', async () => {
  const user = userEvent.setup()
  const longTitle = 'Long company title '.repeat(20)
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 2,
        items: [
          pending,
          { ...pending, id: 5, title: longTitle, tax_id: 'SECOND-TAX' },
        ],
      },
    },
  })
  renderInvoice(<InvoiceRequestList admin />)
  const row = await screen.findByRole('row', {
    name: new RegExp(longTitle.trim()),
  })
  expect(screen.queryByText('SECOND-TAX')).not.toBeInTheDocument()
  await user.click(within(row).getByRole('button', { name: 'View details' }))
  const drawer = screen.getByRole('dialog', {
    name: 'Application details · #5',
  })
  expect(within(drawer).getByText('SECOND-TAX')).toBeVisible()
  expect(within(drawer).getByText(longTitle.trim())).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  await waitFor(() =>
    expect(
      within(row).getByRole('button', { name: 'View details' })
    ).toHaveFocus()
  )
})

it('disables mobile order selection while an application is being submitted', async () => {
  const matchMedia = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...matchMedia(query),
    matches: query === '(max-width: 640px)' || matchMedia(query).matches,
  }))
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { total: 1, items: [{ id: 1, trade_no: 'order-one', money: 10 }] },
    },
  })
  const onChange = vi.fn()
  renderInvoice(
    <InvoiceOrderPicker
      selected={[{ id: 1, trade_no: 'order-one', money: 10 }]}
      disabled
      onChange={onChange}
    />
  )
  const selected = await screen.findByRole('checkbox', { name: 'Select row 1' })
  expect(selected).toBeChecked()
  expect(selected).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('checkbox', { name: 'Select all' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await userEvent.setup().click(selected)
  expect(onChange).not.toHaveBeenCalled()
})

it('caps select-all at 100 orders while retaining selections from earlier pages', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 3,
        items: [100, 101, 102].map((id) => ({
          id,
          trade_no: `order-${id}`,
          money: 10,
        })),
      },
    },
  })
  const selected = Array.from({ length: 99 }, (_, index) => ({
    id: index + 1,
    trade_no: `order-${index + 1}`,
    money: 10,
  }))
  const onChange = vi.fn()
  renderInvoice(
    <InvoiceOrderPicker
      selected={selected}
      disabled={false}
      onChange={onChange}
    />
  )
  await userEvent
    .setup()
    .click(await screen.findByRole('checkbox', { name: 'Select all' }))
  expect(onChange).toHaveBeenCalledWith([
    ...selected,
    { id: 100, trade_no: 'order-100', money: 10 },
  ])
})

it('requests the chosen page size from the server when order pagination changes', async () => {
  const user = userEvent.setup()
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 30,
        items: [{ id: 1, trade_no: 'order-one', money: 10 }],
      },
    },
  })
  renderInvoice(
    <InvoiceOrderPicker selected={[]} disabled={false} onChange={vi.fn()} />
  )
  await screen.findByRole('checkbox', { name: 'Select order order-one' })
  await user.click(screen.getByRole('combobox'))
  await user.click(screen.getByRole('option', { name: '20' }))
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/api/user/invoices/eligible', {
      params: { p: 1, page_size: 20 },
    })
  )
})

it('cancels the application dialog and restores focus without submitting', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { total: 0, items: [] } },
  })
  const post = vi.spyOn(api, 'post')
  renderInvoice()
  const trigger = screen.getByRole('button', { name: 'Request invoice' })
  await user.click(trigger)
  const dialog = await screen.findByRole('dialog', { name: 'Request invoice' })
  await user.type(
    within(dialog).getByLabelText('Invoice title'),
    'Unsaved title'
  )
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(post).not.toHaveBeenCalled()
  await user.click(trigger)
  expect(await screen.findByLabelText('Invoice title')).toHaveValue('')
  expect(screen.getByLabelText('Invoice amount')).toHaveTextContent(/^0$/)
})

it('prefills the bound email on opening, accepts edits, and resets on reopening', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { total: 0, items: [] } },
  })
  renderInvoice()
  act(() =>
    useAuthStore.getState().auth.setUser({
      id: 8,
      username: 'owner',
      role: 1,
      email: 'bound@example.com',
    })
  )
  await user.click(screen.getByRole('button', { name: 'Request invoice' }))
  expect(screen.getByLabelText('Invoice email')).toHaveValue(
    'bound@example.com'
  )
  await user.clear(screen.getByLabelText('Invoice email'))
  await user.type(screen.getByLabelText('Invoice email'), 'custom@example.com')
  act(() =>
    useAuthStore.getState().auth.setUser({
      id: 8,
      username: 'owner',
      role: 1,
      email: 'updated@example.com',
    })
  )
  expect(screen.getByLabelText('Invoice email')).toHaveValue(
    'custom@example.com'
  )
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  await user.click(screen.getByRole('button', { name: 'Request invoice' }))
  expect(screen.getByLabelText('Invoice email')).toHaveValue(
    'updated@example.com'
  )
})

it('requires confirmation to withdraw, retains the dialog on failure, and refreshes statuses on success', async () => {
  const user = userEvent.setup()
  let request = pending
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: { success: true, data: { total: 1, items: [request] } },
  }))
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: false,
      message: 'Invoice application not found or already processed',
    },
  })
  renderInvoice(<InvoiceRequestList admin={false} />)
  expect(
    screen.queryByRole('textbox', { name: 'Search invoice applications' })
  ).not.toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Withdraw' }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cancel',
    })
  )
  expect(post).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Withdraw' }))
  await user.click(screen.getByRole('button', { name: 'Withdraw application' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/user/invoices/4/withdraw')
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Withdraw application' })
    ).toBeEnabled()
  )
  post.mockImplementation(async () => {
    request = { ...pending, status: 'withdrawn' }
    return { data: { success: true, data: request } }
  })
  await user.click(screen.getByRole('button', { name: 'Withdraw application' }))
  expect(await screen.findByText('Withdrawn')).toBeVisible()
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(
    screen.queryByRole('button', { name: 'Withdraw' })
  ).not.toBeInTheDocument()
})

it.each([false, true])(
  'shows consistent statuses and stored invoice details (admin=%s)',
  async (admin) => {
    const user = userEvent.setup()
    const items = (['pending', 'issued', 'rejected', 'withdrawn'] as const).map(
      (status, index) => ({
        ...pending,
        id: index + 1,
        status,
        invoice_address: '12 Main Street',
        invoice_phone: '123456',
        bank_name: 'Example Bank',
        bank_account: '0012345',
      })
    )
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { total: 4, items } },
    })
    renderInvoice(<InvoiceRequestList admin={admin} />)
    expect(await screen.findByText('Withdrawn')).toBeVisible()
    for (const label of ['Awaiting invoicing', 'Invoiced', 'Rejected']) {
      expect(screen.getAllByText(label)[0]).toBeVisible()
    }
    expect(screen.queryAllByRole('button', { name: 'Withdraw' })).toHaveLength(
      admin ? 0 : 1
    )
    await user.click(screen.getAllByRole('button', { name: 'View details' })[0])
    for (const detail of [
      '12 Main Street',
      '123456',
      'Example Bank',
      '0012345',
    ]) {
      expect(screen.getByText(detail)).toBeVisible()
    }
  }
)

it('edits both invoice email templates, previews without sending and restores defaults', async () => {
  const user = userEvent.setup()
  const defaults = {
    admin: { subject: 'New application', html: '<h1>{{.Title}}</h1>' },
    customer: { subject: 'Your invoice', html: '<p>{{.InvoiceNumber}}</p>' },
  }
  const saved = structuredClone(defaults)
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { templates: saved, defaults } },
  })
  const post = vi.spyOn(api, 'post').mockImplementation(async (_url, body) => {
    const input = body as { subject: string }
    return {
      data: {
        success: true,
        data: {
          subject: input.subject,
          html: '<h1>Preview company</h1><script>alert(1)</script>',
        },
      },
    }
  })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: null } })
  renderInvoice(<InvoiceEmailTemplatesDialog />)
  await user.click(screen.getByRole('button', { name: 'Email templates' }))
  const subject = await screen.findByLabelText('Email subject')
  await user.clear(subject)
  await user.type(subject, 'Updated notification')
  await waitFor(() => expect(screen.getByTitle('Email preview')).toBeVisible())
  const frame = screen.getByTitle('Email preview')
  expect(frame).toHaveAttribute('sandbox', '')
  expect(frame.getAttribute('srcdoc')).not.toContain('<script>')
  expect(frame.getAttribute('srcdoc')).toContain('Content-Security-Policy')
  await user.click(screen.getByRole('tab', { name: 'Customer invoice email' }))
  expect(subject).toHaveValue('Your invoice')
  await user.clear(subject)
  await user.type(subject, 'Changed invoice')
  await user.click(
    screen.getByRole('button', { name: 'Restore default template' })
  )
  expect(subject).toHaveValue('Your invoice')
  await user.click(
    screen.getByRole('tab', { name: 'Administrator notification' })
  )
  expect(subject).toHaveValue('Updated notification')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/invoices/email-templates', {
      admin: { ...defaults.admin, subject: 'Updated notification' },
      customer: defaults.customer,
    })
  )
  expect(
    post.mock.calls.every(
      (call) => call[0] === '/api/user/invoices/email-templates/preview'
    )
  ).toBe(true)
})

it('disables template saving when preview validation fails', async () => {
  const user = userEvent.setup()
  const templates = {
    admin: { subject: 'Test', html: '{{.Unknown}}' },
    customer: { subject: 'Invoice', html: '<p>Invoice</p>' },
  }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { templates, defaults: templates } },
  })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: false, message: 'Invalid invoice email template' },
  })
  const put = vi.spyOn(api, 'put')
  renderInvoice(<InvoiceEmailTemplatesDialog />)
  await user.click(screen.getByRole('button', { name: 'Email templates' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Invalid invoice email template'
  )
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(put).not.toHaveBeenCalled()
})

it.each([
  { amounts: [999.99], allowed: false },
  { amounts: [1000], allowed: true },
  { amounts: [1000.01], allowed: true },
  { amounts: [600, 400], allowed: true },
])(
  'requires a combined invoice amount of at least 1000 for $amounts',
  async ({ amounts, allowed }) => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          total: amounts.length,
          items: amounts.map((money, index) => ({
            id: index + 1,
            trade_no: `minimum-${index}`,
            money,
          })),
        },
      },
    })
    const user = userEvent.setup()
    renderInvoice(<InvoiceApplicationForm onSubmitted={vi.fn()} />, 1000)
    await user.click(
      await screen.findByRole('checkbox', { name: 'Select all' })
    )
    const submit = screen.getByRole('button', {
      name: 'Submit invoice application',
    })
    if (allowed) expect(submit).toBeEnabled()
    else expect(submit).toBeDisabled()
    expect(screen.getByText('Minimum invoice amount: 1,000')).toBeVisible()
  }
)

it('blocks application submission when settings fail to load and allows retry', async () => {
  let unavailable = true
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/invoices/settings') {
      if (unavailable) throw new Error('offline')
      return {
        data: {
          success: true,
          data: { minimum_amount: 1500, application_days: 90 },
        },
      }
    }
    return {
      data: {
        success: true,
        data: {
          total: 1,
          items: [{ id: 1, trade_no: 'minimum-order', money: 1500 }],
        },
      },
    }
  })
  const user = userEvent.setup()
  renderInvoice(<InvoiceApplicationForm onSubmitted={vi.fn()} />, null)
  await user.click(await screen.findByRole('checkbox', { name: 'Select all' }))
  const submit = screen.getByRole('button', {
    name: 'Submit invoice application',
  })
  expect(submit).toBeDisabled()
  unavailable = false
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(submit).toBeEnabled())
  expect(screen.getByText('Minimum invoice amount: 1,500')).toBeVisible()
})

it('invoice management saves the minimum, keeps input after failure, and displays the saved value on reopen', async () => {
  let minimum = 1000
  let days = 90
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: {
      success: true,
      data: { minimum_amount: minimum, application_days: days },
    },
  }))
  const put = vi
    .spyOn(api, 'put')
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementation(async (_url, input) => {
      minimum = (input as { minimum_amount: number }).minimum_amount
      days = (input as { application_days: number }).application_days
      return { data: { success: true } }
    })
  const user = userEvent.setup()
  renderInvoice(<InvoiceSettingsDialog />, null)
  await user.click(screen.getByRole('button', { name: 'Invoice settings' }))
  const amount = await screen.findByRole('spinbutton', {
    name: 'Minimum invoice amount',
  })
  expect(amount).toHaveValue(1000)
  await user.clear(amount)
  await user.type(amount, '1500.50')
  const windowDays = screen.getByRole('spinbutton', {
    name: 'Invoice application window (days)',
  })
  expect(windowDays).toHaveValue(90)
  await user.clear(windowDays)
  await user.type(windowDays, '180')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(amount).toHaveValue(1500.5)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(put).toHaveBeenLastCalledWith('/api/user/invoices/settings', {
    minimum_amount: 1500.5,
    application_days: 180,
  })
  await user.click(screen.getByRole('button', { name: 'Invoice settings' }))
  expect(
    await screen.findByRole('spinbutton', { name: 'Minimum invoice amount' })
  ).toHaveValue(1500.5)
  expect(
    screen.getByRole('spinbutton', {
      name: 'Invoice application window (days)',
    })
  ).toHaveValue(180)
})

it('invoice settings reject empty, negative and overprecise amounts without saving', async () => {
  const put = vi.spyOn(api, 'put')
  const user = userEvent.setup()
  renderInvoice(<InvoiceSettingsDialog />, 1000)
  await user.click(screen.getByRole('button', { name: 'Invoice settings' }))
  const amount = screen.getByRole('spinbutton', {
    name: 'Minimum invoice amount',
  })
  for (const value of ['', '-1', '10.001']) {
    await user.clear(amount)
    if (value) await user.type(amount, value)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(put).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeVisible()
  }
})

it('an updated minimum immediately disables an application whose total is now too small', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 1,
        items: [{ id: 1, trade_no: 'minimum-order', money: 1000 }],
      },
    },
  })
  const user = userEvent.setup()
  renderInvoice(<InvoiceApplicationForm onSubmitted={vi.fn()} />, 1000)
  await user.click(await screen.findByRole('checkbox', { name: 'Select all' }))
  const submit = screen.getByRole('button', {
    name: 'Submit invoice application',
  })
  expect(submit).toBeEnabled()
  act(() =>
    clients[0].setQueryData(['invoices', 'settings'], {
      minimum_amount: 1500,
      application_days: 90,
    })
  )
  await waitFor(() => expect(submit).toBeDisabled())
})

it('shows the payment window and rejects fractional or negative day settings', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put')
  renderInvoice(<InvoiceSettingsDialog />, 1000)
  await user.click(screen.getByRole('button', { name: 'Invoice settings' }))
  const days = screen.getByRole('spinbutton', {
    name: 'Invoice application window (days)',
  })
  for (const value of ['-1', '1.5', '3651']) {
    await user.clear(days)
    await user.type(days, value)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(put).not.toHaveBeenCalled()
  }
})

it('displays the 90-day payment deadline and keeps company tax identification mandatory', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        total: 1,
        items: [{ id: 1, trade_no: 'company-order', money: 1000 }],
      },
    },
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: pending } })
  const user = userEvent.setup()
  renderInvoice(<InvoiceApplicationForm onSubmitted={vi.fn()} />, 1000)
  expect(
    screen.getByText(
      'Apply within 90 days after payment. Orders currently invoiced or awaiting processing cannot be selected again.'
    )
  ).toBeVisible()
  expect(
    screen.queryByRole('combobox', { name: 'Invoice title type' })
  ).not.toBeInTheDocument()
  await user.click(await screen.findByRole('checkbox', { name: 'Select all' }))
  await user.type(screen.getByLabelText('Invoice title'), 'Company Ltd')
  await user.type(screen.getByLabelText('Invoice email'), 'billing@example.com')
  await user.click(
    screen.getByRole('button', { name: 'Submit invoice application' })
  )
  await waitFor(() =>
    expect(screen.getByLabelText('Tax identification number')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
  )
  expect(post).not.toHaveBeenCalled()
  await user.type(screen.getByLabelText('Tax identification number'), 'TAX123')
  await user.click(
    screen.getByRole('button', { name: 'Submit invoice application' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/user/invoices',
      expect.objectContaining({ title_type: 'company', tax_id: 'TAX123' })
    )
  )
})

it.each([false, true])(
  'reports download notification result when attachment email is off (failed=%s)',
  async (failed) => {
    const success = vi.spyOn(toast, 'success')
    const error = vi.spyOn(toast, 'error')
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: {
        success: true,
        data: {
          ...pending,
          status: 'issued',
          notification_sent: !failed,
          notification_failed: failed,
        },
      },
    })
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderInvoice(
      <InvoiceProcessDialog
        request={{
          ...pending,
          invoice_number: 'INV-001',
          invoice_url: 'invoice-file:ready.pdf',
        }}
        action='issued'
        onClose={onClose}
      />
    )
    await user.click(screen.getByRole('switch', { name: 'Send to email' }))
    expect(
      screen.getByText(
        'The invoice attachment will not be emailed. The user will receive a notification to download it from their applications.'
      )
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(put).toHaveBeenCalledWith(
      '/api/user/invoices/4',
      expect.objectContaining({ send_email: false })
    )
    if (failed) {
      expect(error).toHaveBeenCalledWith(
        'Invoice issued, but the download notification failed. Please notify the user to download it.'
      )
    } else {
      expect(success).toHaveBeenCalledWith('Invoice download notification sent')
    }
    expect(success).not.toHaveBeenCalledWith('Invoice email sent')
  }
)
