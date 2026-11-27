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
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ModelSquareOrderDialog } from '../components/dialogs/model-square-order-dialog'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderSettings(onOpenChange = vi.fn(), initialTab?: 'vendors') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ModelSquareOrderDialog
        open
        onOpenChange={onOpenChange}
        initialTab={initialTab}
      />
    </QueryClientProvider>
  )
  return client
}

function mockVendors(
  ...responses: { id: number; name: string; can_delete?: boolean }[][]
) {
  const loadVendors = vi.fn()
  for (const data of responses) {
    loadVendors.mockResolvedValueOnce({ data: { success: true, data } })
  }
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/option/model_square/vendors') return loadVendors()
    if (url === '/api/option/') {
      return {
        data: {
          success: true,
          data: [{ key: 'ModelSquareVendorOrder', value: '["OpenAI"]' }],
        },
      }
    }
    throw new Error(`Unexpected request to ${url}`)
  })
  return loadVendors
}

it('keeps model and supplier ordering edits in the same draft and saves them together on retry', async () => {
  mockVendors([
    { id: 1, name: 'Doubao' },
    { id: 2, name: 'OpenAI' },
  ])
  let finishFirstSave!: () => void
  const firstSave = new Promise((resolve) => {
    finishFirstSave = () =>
      resolve({ data: { success: false, message: 'Could not save' } })
  })
  const post = vi
    .spyOn(api, 'post')
    .mockImplementationOnce(() => firstSave)
    .mockResolvedValueOnce({ data: { success: true } })
  const user = userEvent.setup()
  const onOpenChange = vi.fn()
  const client = renderSettings(onOpenChange)
  client.setQueryData(['pricing'], { vendor_order: ['OpenAI'] })

  await user.click(screen.getByRole('tab', { name: 'Supplier display order' }))
  const list = await screen.findByRole('list', {
    name: 'Supplier display order',
  })
  const save = screen.getByRole('button', { name: 'Save' })
  expect(save).toBeDisabled()
  expect(
    within(list).getByRole('button', { name: 'Move OpenAI up' })
  ).toBeDisabled()
  within(list).getByRole('button', { name: 'Drag Doubao to reorder' }).focus()
  await user.keyboard('{ArrowUp}')
  expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Doubao')
  expect(save).toBeEnabled()
  await user.click(save)
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  expect(
    within(list).getByRole('button', { name: 'Drag Doubao to reorder' })
  ).toBeDisabled()
  expect(
    within(list).getByRole('button', { name: 'Move Doubao down' })
  ).toBeDisabled()
  finishFirstSave()
  await waitFor(() => expect(save).toBeEnabled())
  expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Doubao')
  expect(client.getQueryState(['pricing'])?.isInvalidated).toBe(false)

  await user.click(screen.getByRole('tab', { name: 'Sort method' }))
  await user.click(screen.getByRole('button', { name: 'Most used' }))
  await user.click(save)
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  expect(post).toHaveBeenCalledTimes(2)
  expect(post).toHaveBeenLastCalledWith('/api/option/bulk', {
    options: [
      { key: 'model_square_setting.sort_mode', value: 'usage' },
      { key: 'ModelSquareVendorOrder', value: '["Doubao","OpenAI"]' },
    ],
  })
  expect(client.getQueryState(['pricing'])?.isInvalidated).toBe(true)
  client.clear()
})

it('deletes only eligible suppliers after preview and confirmation', async () => {
  const linked = { id: 2, name: 'OpenAI', can_delete: false }
  const unused = { id: 1, name: 'Doubao', can_delete: true }
  const loadVendors = mockVendors([unused, linked], [linked])
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: { sources: [unused], models: [], version: 'preview-version' },
      },
    })
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: { updated_models: [], deleted_vendors: [unused.id] },
      },
    })

  const user = userEvent.setup()
  const client = renderSettings(vi.fn(), 'vendors')
  const remove = await screen.findByRole('button', { name: 'Delete Doubao' })
  expect(screen.queryByRole('button', { name: 'Delete OpenAI' })).toBeNull()
  await user.click(remove)
  const dialog = await screen.findByRole('dialog', { name: 'Delete vendors' })
  expect(post).not.toHaveBeenCalled()
  await user.click(
    within(dialog).getByRole('button', { name: 'Preview changes' })
  )
  await user.click(
    await within(dialog).findByRole('button', { name: 'Apply changes' })
  )
  await waitFor(() => expect(remove).not.toBeInTheDocument())
  expect(post).toHaveBeenNthCalledWith(
    1,
    '/api/vendors/operations/preview',
    expect.objectContaining({ action: 'delete', vendor_ids: [1] })
  )
  expect(post).toHaveBeenLastCalledWith(
    '/api/vendors/operations',
    expect.objectContaining({
      action: 'delete',
      vendor_ids: [1],
      expected_version: 'preview-version',
    })
  )
  expect(loadVendors).toHaveBeenCalledTimes(2)
  client.clear()
})
