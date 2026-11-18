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
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { TokenLimitSection } from '../token-limit-section'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.restoreAllMocks()
})

function renderLimits() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  clients.push(client)
  client.setQueryData(['token-smart-routing-templates', 'owned', 7], {
    success: true,
    data: { templates: [], max_user_templates: 10 },
  })
  const actions = document.createElement('div')
  render(
    <QueryClientProvider client={client}>
      <div
        ref={(node) => {
          node?.append(actions)
        }}
      />
      <SettingsPageProvider actionsContainer={actions}>
        <TokenLimitSection
          defaultValues={{
            'token_setting.max_user_tokens': 150,
            'smart_routing_setting.max_user_templates': 10,
          }}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  return client
}

test('token limits saves both user limits in the same settings section', async () => {
  const user = userEvent.setup()
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const client = renderLimits()
  const tokens = screen.getByRole('spinbutton', {
    name: 'Maximum tokens per user',
  })
  const templates = screen.getByRole('spinbutton', {
    name: 'Maximum user routing templates',
  })
  expect(tokens).toHaveValue(150)
  expect(templates).toHaveValue(10)
  fireEvent.change(tokens, { target: { value: '200' } })
  await user.clear(templates)
  await user.type(templates, '15')
  await user.click(screen.getByRole('button', { name: 'Save token limits' }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
  expect(put).toHaveBeenCalledWith('/api/option/', {
    key: 'token_setting.max_user_tokens',
    value: 200,
  })
  expect(put).toHaveBeenCalledWith('/api/option/', {
    key: 'smart_routing_setting.max_user_templates',
    value: 15,
  })
  await waitFor(() =>
    expect(
      client.getQueryState(['token-smart-routing-templates', 'owned', 7])
        ?.isInvalidated
    ).toBe(true)
  )
})

test.each(['0', '101', '1.5'])(
  'an invalid template limit %s prevents saving',
  async (value) => {
    const user = userEvent.setup()
    const put = vi.spyOn(api, 'put')
    renderLimits()
    const templates = screen.getByRole('spinbutton', {
      name: 'Maximum user routing templates',
    })
    await user.clear(templates)
    await user.type(templates, value)
    await user.click(screen.getByRole('button', { name: 'Save token limits' }))
    await waitFor(() =>
      expect(templates).toHaveAttribute('aria-invalid', 'true')
    )
    expect(put).not.toHaveBeenCalled()
  }
)

test('a rejected template limit update preserves the value for retry', async () => {
  const user = userEvent.setup()
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValueOnce({
      data: { success: false, message: 'Update denied' },
    })
    .mockResolvedValueOnce({ data: { success: true } })
  renderLimits()
  const templates = screen.getByRole('spinbutton', {
    name: 'Maximum user routing templates',
  })
  await user.clear(templates)
  await user.type(templates, '20')
  const save = screen.getByRole('button', { name: 'Save token limits' })
  await user.click(save)
  await waitFor(() => expect(save).toBeEnabled())
  expect(templates).toHaveValue(20)
  await user.click(save)
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
  for (const call of put.mock.calls) {
    expect(call).toEqual([
      '/api/option/',
      { key: 'smart_routing_setting.max_user_templates', value: 20 },
    ])
  }
})
