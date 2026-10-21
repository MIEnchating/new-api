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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { ModelPricingEntry } from '@/features/model-pricing/api'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { ModelRatioVisualEditor } from '../model-ratio-visual-editor'

let client: QueryClient | undefined

afterEach(() => {
  client?.clear()
  useAuthStore.getState().auth.setUser(null)
  localStorage.clear()
  window.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
})

async function renderEditor(entries: ModelPricingEntry[] = []) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/option/model_pricing') {
      return { data: { success: true, data: { entries } } }
    }
    if (url === '/api/pricing') {
      return { data: { success: true, data: [], vendors: [] } }
    }
    return { data: { success: true, data: {} } }
  })
  const modelRatio = JSON.stringify({
    'gpt-4.1-mini': 0.2,
    'claude-sonnet': 1.5,
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client = queryClient
  const view = render(
    <QueryClientProvider client={client}>
      <ModelRatioVisualEditor
        savedModelPrice='{}'
        savedModelRatio={modelRatio}
        savedCacheRatio='{}'
        savedCreateCacheRatio='{}'
        savedCompletionRatio='{}'
        savedImageRatio='{}'
        savedAudioRatio='{}'
        savedAudioCompletionRatio='{}'
        savedBillingMode='{}'
        savedBillingExpr='{}'
        modelPrice='{}'
        modelRatio={modelRatio}
        cacheRatio='{}'
        createCacheRatio='{}'
        completionRatio='{}'
        imageRatio='{}'
        audioRatio='{}'
        audioCompletionRatio='{}'
        billingMode='{}'
        billingExpr='{}'
        onChange={vi.fn()}
        onSave={vi.fn()}
        isSaving={false}
      />
    </QueryClientProvider>
  )
  // The real page has pricing metadata loaded long before the user drags over
  // a model name, so settle the pricing query before interacting.
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  return view
}

// A drag-select ends with mousedown/mouseup inside the row and the browser
// then fires `click` on the row. Only that final `click` is dispatched here so
// the text selection created by the drag is still active when the row opens
// the editor.
it('keeps the drag-selected model name highlighted when the row click opens the editor', async () => {
  await renderEditor()
  const row = await screen.findByRole('row', { name: /gpt-4\.1-mini/ })
  const nameCell = within(row).getByText('gpt-4.1-mini')
  window.getSelection()?.selectAllChildren(nameCell)
  expect(String(window.getSelection())).toBe('gpt-4.1-mini')

  fireEvent.click(nameCell)

  expect(
    await screen.findByRole('region', { name: 'Edit model pricing' })
  ).toBeInTheDocument()
  expect(nameCell).toBeInTheDocument()
  expect(String(window.getSelection())).toBe('gpt-4.1-mini')
})

it('keeps other rows mounted when a different model is opened for editing', async () => {
  await renderEditor()
  const targetRow = await screen.findByRole('row', { name: /gpt-4\.1-mini/ })
  const otherName = within(
    screen.getByRole('row', { name: /claude-sonnet/ })
  ).getByText('claude-sonnet')

  fireEvent.click(within(targetRow).getByText('gpt-4.1-mini'))

  expect(
    await screen.findByRole('region', { name: 'Edit model pricing' })
  ).toBeInTheDocument()
  expect(otherName).toBeInTheDocument()
})

it('distinguishes built-in defaults from custom-only prices even when a built-in model is overridden', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 100 })
  await renderEditor([
    {
      model_name: 'gpt-4.1-mini',
      version: '1',
      configured: { ModelRatio: 0.2 },
      effective: { ModelRatio: 0.2 },
      has_builtin_pricing: true,
    },
    {
      model_name: 'claude-sonnet',
      version: '2',
      configured: { ModelRatio: 1.5 },
      effective: { ModelRatio: 1.5 },
      has_builtin_pricing: false,
    },
  ])
  const builtin = screen.getByRole('row', { name: /gpt-4\.1-mini/ })
  const custom = screen.getByRole('row', { name: /claude-sonnet/ })
  expect(within(builtin).getByText('Has built-in pricing')).toBeVisible()
  expect(within(custom).getByText('No built-in pricing')).toBeVisible()
  fireEvent.click(within(builtin).getByText('gpt-4.1-mini'))
  expect(
    await screen.findByText(
      'This model has built-in default pricing and may have custom overrides. Built-in expressions take effect again when custom pricing is removed.'
    )
  ).toBeVisible()
})

it('does not guess a pricing source when the server supplies no provenance', async () => {
  await renderEditor()
  expect(screen.queryByText('Has built-in pricing')).not.toBeInTheDocument()
  expect(screen.queryByText('No built-in pricing')).not.toBeInTheDocument()
})

it('restores the upstream inline model label and standard pagination', async () => {
  await renderEditor()
  const row = screen.getByRole('row', { name: /gpt-4\.1-mini/ })
  const name = within(row).getByText('gpt-4.1-mini')
  expect(name.closest('td')?.firstElementChild).toHaveClass('items-center')
  expect(name.closest('td')?.firstElementChild).not.toHaveClass('flex-col')
  expect(screen.getAllByRole('combobox')).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Go to first page' })).toBeVisible()
})
