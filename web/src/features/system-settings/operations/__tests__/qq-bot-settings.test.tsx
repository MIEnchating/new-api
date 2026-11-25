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
/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { QQBotSettingsSection } from '../qq-bot-settings-section'

const { get, post, put, requestVerification } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  requestVerification: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: { get, post, put } }))
vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: { server_address: 'https://gateway.example' } }),
}))
vi.mock('@/features/auth/secure-verification', () => ({
  SecureVerificationDialog: () => null,
  useSecureVerification: () => ({ requestVerification, dialogProps: {} }),
}))

const settings = {
  enabled: false,
  app_id: '12345',
  groups: 'example-group',
  site_url: '',
  chat_source: 'disabled',
  chat_protocol: 'chat_completions',
  chat_base_url: '',
  chat_token_id: 0,
  chat_group: '',
  chat_model: '',
  app_secret_configured: true,
  chat_key_configured: false,
  legacy_chat_key: false,
  revision: 'original',
  callback_path: '/api/qqbot/webhook',
}

beforeEach(() => vi.resetAllMocks())

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const actions = document.createElement('div')
  document.body.append(actions)
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SettingsPageProvider actionsContainer={actions}>
        <QQBotSettingsSection />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  return () => {
    view.unmount()
    actions.remove()
    queryClient.clear()
  }
}

it('shows the webhook and saves new credentials only after verification', async () => {
  get.mockResolvedValue({ data: { success: true, data: settings } })
  put.mockResolvedValue({
    data: {
      success: true,
      data: { ...settings, enabled: true, revision: 'updated' },
    },
  })
  requestVerification.mockResolvedValueOnce(null)
  requestVerification.mockResolvedValueOnce({ proof_token: 'proof' })
  const cleanup = renderSettings()
  try {
    expect(
      await screen.findByText('https://gateway.example/api/qqbot/webhook')
    ).toBeTruthy()
    const secret = screen.getByLabelText(
      'QQ Bot App Secret'
    ) as HTMLInputElement
    expect(secret.value).toBe('')
    expect(secret.placeholder).toBe('Configured')
    fireEvent.change(secret, { target: { value: 'replacement' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Enable QQ Bot' }))

    const save = screen.getByRole('button', { name: /save changes/i })
    fireEvent.click(save)
    await waitFor(() => {
      expect(requestVerification).toHaveBeenCalledTimes(1)
      expect((save as HTMLButtonElement).disabled).toBe(false)
    })
    expect(put).not.toHaveBeenCalled()

    fireEvent.click(save)
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/option/qqbot',
        expect.objectContaining({
          enabled: true,
          app_secret: 'replacement',
          chat_key: '',
          revision: 'original',
        }),
        { headers: { 'X-Security-Proof': 'proof' } }
      )
    )
    expect(requestVerification).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: 'qq_bot.settings.update' })
    )
    await waitFor(() => {
      const field = screen.getByLabelText(
        'QQ Bot App Secret'
      ) as HTMLInputElement
      expect(field.value).toBe('')
    })
  } finally {
    cleanup()
  }
})

it('adds a discovered group to the current list and saves it with verification', async () => {
  get.mockImplementation(async (url: string) => ({
    data: {
      success: true,
      data: url.endsWith('/discovered-groups')
        ? ['test-group', 'example-group']
        : { ...settings, enabled: true },
    },
  }))
  put.mockResolvedValue({
    data: {
      success: true,
      data: {
        ...settings,
        groups: 'example-group, test-group',
        revision: 'updated',
      },
    },
  })
  requestVerification.mockResolvedValue({ proof_token: 'proof' })
  const user = userEvent.setup()
  const cleanup = renderSettings()
  try {
    await user.click(
      await screen.findByRole('button', { name: 'Discover QQ groups' })
    )
    const picker = await screen.findByRole('combobox', {
      name: 'Select a discovered QQ group',
    })
    await user.type(picker, 'group')
    expect(screen.queryByRole('option', { name: 'example-group' })).toBeNull()
    await user.click(await screen.findByRole('option', { name: 'test-group' }))
    expect(
      screen.getByLabelText<HTMLInputElement>('Allowed QQ group OpenIDs').value
    ).toBe('example-group, test-group')
    expect(put).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/option/qqbot',
        expect.objectContaining({ groups: 'example-group, test-group' }),
        { headers: { 'X-Security-Proof': 'proof' } }
      )
    )
  } finally {
    cleanup()
  }
})

it('shows how to discover a QQ group when the list is empty', async () => {
  get.mockResolvedValueOnce({
    data: { success: true, data: { ...settings, enabled: true } },
  })
  get.mockResolvedValueOnce({ data: { success: true, data: [] } })
  const user = userEvent.setup()
  const cleanup = renderSettings()
  try {
    await user.click(
      await screen.findByRole('button', { name: 'Discover QQ groups' })
    )
    expect(
      await screen.findByText('Mention the bot in a QQ group to discover it.')
    ).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh' })
        .disabled
    ).toBe(false)
  } finally {
    cleanup()
  }
})

it('loads groups and models for the selected key and clears them when switching to external', async () => {
  get.mockImplementation(
    async (url: string, config?: { params?: { group?: string } }) => {
      if (url.startsWith('/api/token/')) {
        return {
          data: {
            success: true,
            data: { items: [{ id: 34, name: 'Bot key', status: 1 }], total: 1 },
          },
        }
      }
      if (url.endsWith('/chat-options')) {
        return {
          data: {
            success: true,
            data: {
              groups: ['vip'],
              models: config?.params?.group === 'vip' ? ['bot-model'] : [],
            },
          },
        }
      }
      return { data: { success: true, data: settings } }
    }
  )
  put.mockImplementation(
    async (_url: string, values: Record<string, unknown>) => ({
      data: {
        success: true,
        data: { ...settings, ...values, revision: 'updated' },
      },
    })
  )
  requestVerification.mockResolvedValue({ proof_token: 'proof' })
  const user = userEvent.setup()
  const cleanup = renderSettings()
  try {
    expect(
      await screen.findByRole('heading', { name: 'QQ connection' })
    ).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'AI Chat' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Built-in' }))
    expect(screen.getByText('OpenAI Chat Completions')).toBeTruthy()
    expect(screen.queryByLabelText('API Base URL')).toBeNull()
    const key = await screen.findByRole('combobox', { name: 'API Key' })
    await waitFor(() => expect((key as HTMLInputElement).disabled).toBe(false))
    await user.type(key, 'Bot')
    await user.click(await screen.findByRole('option', { name: 'Bot key' }))
    const group = screen.getByRole('combobox', { name: 'Group' })
    await waitFor(() =>
      expect((group as HTMLInputElement).disabled).toBe(false)
    )
    await user.type(group, 'vip')
    await user.click(await screen.findByRole('option', { name: 'vip' }))
    const model = screen.getByRole('combobox', { name: 'Model' })
    await waitFor(() =>
      expect((model as HTMLInputElement).disabled).toBe(false)
    )
    await user.type(model, 'bot')
    await user.click(await screen.findByRole('option', { name: 'bot-model' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/option/qqbot',
        expect.objectContaining({
          chat_source: 'builtin',
          chat_token_id: 34,
          chat_group: 'vip',
          chat_model: 'bot-model',
          chat_key: '',
        }),
        { headers: { 'X-Security-Proof': 'proof' } }
      )
    )
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'External' }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    )
    await user.click(screen.getByRole('button', { name: 'External' }))
    expect(screen.queryByRole('combobox', { name: 'Group' })).toBeNull()
    expect(
      (screen.getByLabelText('API Base URL') as HTMLInputElement).value
    ).toBe('')
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe(
      ''
    )
  } finally {
    cleanup()
  }
})

it('fetches the external model list with the current settings and supports keyboard selection', async () => {
  get.mockResolvedValue({ data: { success: true, data: settings } })
  post.mockResolvedValue({
    data: { success: true, data: ['model-alpha', 'model-beta'] },
  })
  const user = userEvent.setup()
  const cleanup = renderSettings()
  try {
    await user.click(await screen.findByRole('button', { name: 'External' }))
    const fetch = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Fetch Models',
    })
    expect(fetch.disabled).toBe(true)
    await user.type(
      screen.getByLabelText('API Base URL'),
      'https://example.com/v1/'
    )
    expect(fetch.disabled).toBe(true)
    await user.type(screen.getByLabelText('API Key'), 'unsaved-key')
    await user.click(fetch)
    const model = await screen.findByRole<HTMLInputElement>('combobox', {
      name: 'Model',
    })
    expect(post).toHaveBeenCalledWith('/api/option/qqbot/external-models', {
      chat_base_url: 'https://example.com/v1',
      chat_key: 'unsaved-key',
      chat_protocol: 'chat_completions',
    })
    await user.type(model, 'beta')
    await screen.findByRole('option', { name: 'model-beta' })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(model.value).toBe('model-beta')
    expect(put).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('API Key'), '-edited')
    expect(screen.queryByRole('combobox', { name: 'Model' })).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>('Model').value).toBe(
      'model-beta'
    )
  } finally {
    cleanup()
  }
})

it.each([
  { success: true, data: [], feedback: 'No models returned by the upstream' },
  { success: false, data: [], feedback: 'Failed to fetch models' },
])(
  'keeps the manually entered external model when the list reports $feedback',
  async ({ success, data, feedback }) => {
    get.mockResolvedValue({
      data: {
        success: true,
        data: {
          ...settings,
          chat_source: 'external',
          chat_base_url: 'https://example.com/v1',
          chat_model: 'manual-model',
          chat_key_configured: true,
        },
      },
    })
    post.mockResolvedValue({ data: { success, data, message: feedback } })
    const user = userEvent.setup()
    const cleanup = renderSettings()
    try {
      await user.click(
        await screen.findByRole('button', { name: 'Fetch Models' })
      )
      expect(await screen.findByText(feedback)).toBeTruthy()
      expect(screen.getByLabelText<HTMLInputElement>('Model').value).toBe(
        'manual-model'
      )
      expect(post).toHaveBeenCalledWith(
        '/api/option/qqbot/external-models',
        expect.objectContaining({ chat_key: '' })
      )
    } finally {
      cleanup()
    }
  }
)
