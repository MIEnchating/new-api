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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'

import type { Channel } from '../../types'
import { ChannelsProvider, useChannels } from '../channels-provider'
import { ChannelTestDialog } from '../dialogs/channel-test-dialog'

const channel: Channel = {
  id: 1,
  type: 1,
  key: '',
  status: 1,
  name: 'Test channel',
  created_time: 0,
  test_time: 0,
  response_time: 0,
  other: '',
  balance: 0,
  balance_updated_time: 0,
  models: 'gpt-4o',
  group: 'default',
  used_quota: 0,
  other_info: '',
  remark: '',
  max_input_tokens: 0,
  channel_info: {
    is_multi_key: false,
    multi_key_size: 0,
    multi_key_polling_index: 0,
    multi_key_mode: 'random',
  },
  settings: '{}',
}

function TestDialogFixture() {
  const channels = useChannels()
  return (
    <>
      <Button
        onClick={() => {
          channels.setCurrentRow(channel)
          channels.setOpen('test-channel')
        }}
      >
        Test Channel Connection
      </Button>
      <ChannelTestDialog
        open={channels.open === 'test-channel'}
        onOpenChange={(open) => channels.setOpen(open ? 'test-channel' : null)}
      />
    </>
  )
}

describe('channel test endpoint selection', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    localStorage.clear()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ChannelsProvider>
          <TestDialogFixture />
        </ChannelsProvider>
      </QueryClientProvider>
    )
  })

  afterEach(() => {
    cleanup()
    queryClient.clear()
    localStorage.clear()
  })

  it('does not move focus into a control when opening and reopening the test dialog', async () => {
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', {
      name: 'Test Channel Connection',
    })

    for (let opening = 0; opening < 2; opening++) {
      await user.click(trigger)
      const endpoint = await screen.findByLabelText('Endpoint Type')
      expect(screen.getByRole('dialog')).toBeVisible()
      expect(endpoint).not.toHaveFocus()
      expect(trigger).toHaveFocus()
      expect(endpoint).toHaveAttribute('aria-expanded', 'false')
      expect(endpoint).toHaveValue('Auto detect (default)')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

      await user.click(screen.getAllByRole('button', { name: 'Close' })[0])
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      )
    }
  })

  it.each(['pointer', 'keyboard'] as const)(
    'allows explicit endpoint selection using the %s after opening the dialog',
    async (interaction) => {
      const user = userEvent.setup()
      await user.click(
        screen.getByRole('button', { name: 'Test Channel Connection' })
      )
      const endpoint = await screen.findByLabelText('Endpoint Type')
      expect(endpoint).not.toHaveFocus()
      expect(endpoint).toHaveAttribute('aria-expanded', 'false')

      if (interaction === 'pointer') {
        await user.click(endpoint)
      } else {
        await user.tab()
        await user.tab()
        expect(endpoint).toHaveFocus()
        await user.keyboard('{ArrowDown}')
      }
      expect(endpoint).toHaveAttribute('aria-expanded', 'true')
      await user.keyboard('openai-response')
      if (interaction === 'pointer') {
        await user.click(
          screen.getByRole('option', {
            name: 'OpenAI Responses (/v1/responses)',
          })
        )
      } else {
        await user.keyboard('{ArrowDown}{Enter}')
      }
      await waitFor(() =>
        expect(endpoint).toHaveValue('OpenAI Responses (/v1/responses)')
      )
      expect(endpoint).toHaveAttribute('aria-expanded', 'false')
    }
  )
})
