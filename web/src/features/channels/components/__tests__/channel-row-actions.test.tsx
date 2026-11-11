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
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import type { Channel } from '../../types'
import {
  ChannelRowActionsLayoutContext,
  type ChannelRowActionsLayout,
} from '../channel-row-actions-context'
import { BalanceCell } from '../channels-columns'
import { ChannelsProvider, useChannels } from '../channels-provider'
import { DataTableRowActions } from '../data-table-row-actions'

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

const data = [channel]

function RowActionsFixture(props: {
  layout: ChannelRowActionsLayout
  data?: Channel[]
}) {
  const channels = useChannels()
  const table = useReactTable({
    data: props.data ?? data,
    columns: [],
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <ChannelRowActionsLayoutContext.Provider value={props.layout}>
      <DataTableRowActions row={table.getRowModel().rows[0]} />
      {channels.open === 'update-channel' && (
        <div role='status'>Editing {channels.currentRow?.name}</div>
      )}
      {channels.open === 'balance-query' && (
        <div role='status'>Balance {channels.currentRow?.name}</div>
      )}
    </ChannelRowActionsLayoutContext.Provider>
  )
}

describe('channel row actions', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    localStorage.clear()
    queryClient = new QueryClient()
  })

  afterEach(() => {
    cleanup()
    queryClient.clear()
    localStorage.clear()
  })

  it.each([
    { type: 55, name: 'Sora', upstreamUpdatesVisible: false },
    { type: 1, name: 'OpenAI', upstreamUpdatesVisible: true },
  ])(
    '$name retains Fetch Models with upstream update visibility $upstreamUpdatesVisible',
    async ({ type, upstreamUpdatesVisible }) => {
      const user = userEvent.setup()
      render(
        <QueryClientProvider client={queryClient}>
          <ChannelsProvider>
            <RowActionsFixture layout='table' data={[{ ...channel, type }]} />
          </ChannelsProvider>
        </QueryClientProvider>
      )

      await user.click(screen.getByRole('button', { name: 'Open menu' }))
      expect(
        screen.getByRole('menuitem', { name: 'Fetch Models' })
      ).toBeInTheDocument()
      const upstreamUpdates = screen.queryByRole('menuitem', {
        name: 'Upstream Updates',
      })
      if (upstreamUpdatesVisible) {
        expect(upstreamUpdates).toBeInTheDocument()
      } else {
        expect(upstreamUpdates).not.toBeInTheDocument()
      }
    }
  )

  it.each([
    { layout: 'card', interaction: 'pointer' },
    { layout: 'card', interaction: 'keyboard' },
    { layout: 'table', interaction: 'pointer' },
  ] as const)(
    'opens the selected channel editor from the $layout actions using the $interaction',
    async ({ layout, interaction }) => {
      const user = userEvent.setup()
      render(
        <QueryClientProvider client={queryClient}>
          <ChannelsProvider>
            <RowActionsFixture layout={layout} />
          </ChannelsProvider>
        </QueryClientProvider>
      )
      if (layout === 'card') {
        expect(
          screen.queryByRole('button', { name: 'Edit' })
        ).not.toBeInTheDocument()
        const menuButton = screen.getByRole('button', { name: 'Open menu' })
        if (interaction === 'keyboard') {
          for (const _button of screen.getAllByRole('button')) {
            await user.tab()
            if (menuButton === document.activeElement) break
          }
          expect(menuButton).toHaveFocus()
          await user.keyboard('{Enter}')
          await screen.findByRole('menuitem', { name: 'Edit' })
          await user.keyboard('{Home}{Enter}')
        } else {
          await user.click(menuButton)
          await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
        }
      } else {
        await user.click(screen.getByRole('button', { name: 'Edit' }))
      }
      expect(screen.getByRole('status')).toHaveTextContent(
        'Editing Test channel'
      )
    }
  )
  it.each(['card', 'table'] as const)(
    'opens balance querying for the selected channel from the %s menu',
    async (layout) => {
      const user = userEvent.setup()
      render(
        <QueryClientProvider client={queryClient}>
          <ChannelsProvider>
            <RowActionsFixture layout={layout} />
          </ChannelsProvider>
        </QueryClientProvider>
      )
      await user.click(screen.getByRole('button', { name: 'Open menu' }))
      await user.click(screen.getByRole('menuitem', { name: 'Query Balance' }))
      expect(screen.getByRole('status')).toHaveTextContent(
        'Balance Test channel'
      )
    }
  )

  it('shows the remaining balance on a regular channel card and allows refreshing it', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, balance: 10 },
    })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <ChannelsProvider>
          <ChannelRowActionsLayoutContext.Provider value='card'>
            <BalanceCell channel={{ ...channel, balance: 12.5 }} />
          </ChannelRowActionsLayoutContext.Provider>
        </ChannelsProvider>
      </QueryClientProvider>
    )
    await user.click(screen.getByText(/12\.5/))
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        '/api/channel/update_balance/1',
        expect.any(Object)
      )
    )
  })
})
