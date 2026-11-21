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
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { ModelSquareSettingsSection } from '../model-square-settings-section'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Workspace() {
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setActions} />
      <SettingsPageProvider actionsContainer={actions}>
        <ModelSquareSettingsSection vendorOrder={['OpenAI']} />
      </SettingsPageProvider>
    </>
  )
}

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <Workspace />
      </RouterContextProvider>
    </QueryClientProvider>
  )
  return client
}

it('keeps the reordered draft after a failed save and publishes it on retry', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: [
        { id: 1, name: 'Doubao' },
        { id: 2, name: 'OpenAI' },
      ],
    },
  })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValueOnce({
      data: { success: false, message: 'Could not save' },
    })
    .mockResolvedValueOnce({ data: { success: true } })
  const user = userEvent.setup()
  const client = renderSettings()
  client.setQueryData(['pricing'], { vendor_order: ['OpenAI'] })

  const list = await screen.findByRole('list', {
    name: 'Supplier display order',
  })
  expect(get).toHaveBeenCalledWith('/api/option/model_square/vendors')
  const save = screen.getByRole('button', { name: 'Save Changes' })
  expect(save).toBeDisabled()
  expect(
    within(list).getByRole('button', { name: 'Move OpenAI up' })
  ).toBeDisabled()
  within(list).getByRole('button', { name: 'Drag Doubao to reorder' }).focus()
  await user.keyboard('{ArrowUp}')
  expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Doubao')
  expect(save).toBeEnabled()
  await user.click(save)
  await waitFor(() => expect(save).toBeEnabled())
  expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Doubao')
  expect(client.getQueryState(['pricing'])?.isInvalidated).toBe(false)

  await user.click(save)
  await waitFor(() => expect(save).toBeDisabled())
  expect(put).toHaveBeenCalledTimes(2)
  expect(put).toHaveBeenLastCalledWith('/api/option/', {
    key: 'ModelSquareVendorOrder',
    value: '["Doubao","OpenAI"]',
  })
  expect(client.getQueryState(['pricing'])?.isInvalidated).toBe(true)
  client.clear()
})

it('deletes only eligible suppliers after preview and confirmation', async () => {
  const linked = { id: 2, name: 'OpenAI', can_delete: false }
  const unused = { id: 1, name: 'Doubao', can_delete: true }
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce({ data: { success: true, data: [unused, linked] } })
    .mockResolvedValueOnce({ data: { success: true, data: [linked] } })
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
  const client = renderSettings()
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
  expect(get).toHaveBeenCalledTimes(2)
  client.clear()
})
