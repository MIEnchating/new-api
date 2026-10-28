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
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { CCSwitchDialog } from '../cc-switch-dialog'

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  })
})

afterEach(() => {
  queryClient.clear()
})

function renderDialog(
  models = ['gpt-5.4', 'claude-sonnet-4-6'],
  siteTitle = '测试站点'
) {
  queryClient.setQueryData(STATUS_QUERY_KEY, {
    system_name: siteTitle,
    server_address: 'https://example.com',
    logo: '/site-logo.png',
  })
  queryClient.setQueryData(['api-key-models-ccswitch', 42], {
    success: true,
    data: models,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <CCSwitchDialog
        open
        onOpenChange={vi.fn()}
        tokenId={42}
        tokenKey='test-only'
      />
    </QueryClientProvider>
  )
}

describe('CC Switch model selection', () => {
  it('uses the site title and selected app type as the imported provider name', async () => {
    renderDialog()
    const user = userEvent.setup()
    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toHaveValue('测试站点 Claude Code')

    for (const app of [
      'Codex',
      'Gemini CLI',
      'Grok Build',
      'OpenCode',
      'OpenClaw',
      'Hermes',
      'Claude Code',
    ]) {
      await user.click(screen.getByRole('radio', { name: app }))
      expect(input).toHaveValue(`测试站点 ${app}`)
    }

    await user.type(
      screen.getByRole('combobox', { name: 'Primary Model' }),
      'claude-sonnet-4-6'
    )
    await user.click(screen.getByRole('option', { name: 'claude-sonnet-4-6' }))
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await user.click(screen.getByRole('button', { name: 'Open CC Switch' }))
    expect(open).toHaveBeenCalledOnce()
    expect(
      new URL(String(open.mock.calls[0][0])).searchParams.get('name')
    ).toBe('测试站点 Claude Code')
    expect(
      new URL(String(open.mock.calls[0][0])).searchParams.get('iconUrl')
    ).toBe('https://example.com/site-logo.png')
  })

  it('uses the default site title when the configured title is blank', () => {
    renderDialog([], '   ')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'New API Claude Code'
    )
  })

  it.each(['Claude Code', 'Codex', 'Gemini CLI'])(
    'opens %s models outside the clipping dialog and keeps the dialog open after selection',
    async (app) => {
      renderDialog()
      const user = userEvent.setup()
      await user.click(screen.getByRole('radio', { name: app }))
      const input = screen.getByRole('combobox', { name: 'Primary Model' })

      await user.click(input)

      expect(input).toHaveAttribute('aria-expanded', 'true')
      const list = await screen.findByRole('listbox')
      const dialog = screen.getByRole('dialog', { name: 'Import to CC Switch' })
      // The dialog is translated and clips overflow. Its popup must escape
      // that containing block to remain aligned and fully visible.
      expect(dialog).not.toContainElement(list)
      await user.click(screen.getByRole('option', { name: 'gpt-5.4' }))
      await waitFor(() => expect(input).toHaveValue('gpt-5.4'))
      expect(input).toHaveAttribute('aria-expanded', 'false')
      expect(dialog).toBeVisible()
    }
  )

  it('filters model names and supports keyboard selection and Escape without closing the dialog', async () => {
    renderDialog()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Codex' }))
    const input = screen.getByRole('combobox', { name: 'Primary Model' })
    await user.click(input)
    await user.type(input, 'sonnet')

    expect(
      screen.queryByRole('option', { name: 'gpt-5.4' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'claude-sonnet-4-6' })
    ).toBeVisible()
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(input).toHaveValue('claude-sonnet-4-6'))
    await user.click(input)
    await user.keyboard('{Escape}')

    expect(input).toHaveValue('claude-sonnet-4-6')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it('shows an empty result when no models are available and updates an open dropdown when models arrive', async () => {
    renderDialog([])
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Codex' }))
    const input = screen.getByRole('combobox', { name: 'Primary Model' })
    await user.click(screen.getByRole('button', { name: 'Primary Model' }))

    expect(await screen.findByText('No models found')).toBeVisible()
    await act(async () => {
      queryClient.setQueryData(['api-key-models-ccswitch', 42], {
        success: true,
        data: ['gpt-5.4'],
      })
    })
    await user.click(await screen.findByRole('option', { name: 'gpt-5.4' }))
    await waitFor(() => expect(input).toHaveValue('gpt-5.4'))
  })

  it('lets users edit the provider name without opening a model dropdown', async () => {
    renderDialog()
    const user = userEvent.setup()
    const input = screen.getByRole('textbox', { name: 'Name' })

    await user.clear(input)
    await user.type(input, 'Development')

    expect(input).toHaveValue('Development')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
