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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Channel } from '../../types'
import {
  ChannelRowActionsLayoutContext,
  type ChannelRowActionsLayout,
} from '../channel-row-actions-context'
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

function RowActionsFixture(props: { layout: ChannelRowActionsLayout }) {
  const channels = useChannels()
  const table = useReactTable({
    data,
    columns: [],
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <ChannelRowActionsLayoutContext.Provider value={props.layout}>
      <DataTableRowActions row={table.getRowModel().rows[0]} />
      {channels.open === 'update-channel' && (
        <div role='status'>Editing {channels.currentRow?.name}</div>
      )}
    </ChannelRowActionsLayoutContext.Provider>
  )
}

describe('channel row edit action', () => {
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
    { layout: 'card', interaction: 'pointer' },
    { layout: 'card', interaction: 'keyboard' },
    { layout: 'table', interaction: 'pointer' },
  ] as const)(
    'opens the selected channel editor directly from the $layout actions using the $interaction',
    async ({ layout, interaction }) => {
      const user = userEvent.setup()
      render(
        <QueryClientProvider client={queryClient}>
          <ChannelsProvider>
            <RowActionsFixture layout={layout} />
          </ChannelsProvider>
        </QueryClientProvider>
      )
      const edit = screen.getByRole('button', { name: 'Edit' })
      const buttons = screen.getAllByRole('button')
      if (layout === 'card') {
        expect(buttons[2]).toHaveAccessibleName('Disable')
        expect(buttons[3]).toBe(edit)
        expect(buttons[4]).toHaveAccessibleName('Open menu')
      }
      if (interaction === 'pointer') {
        await user.click(edit)
      } else {
        for (const button of buttons.slice(0, buttons.indexOf(edit) + 1)) {
          await user.tab()
          expect(button).toHaveFocus()
        }
        expect(edit).toHaveFocus()
        await user.keyboard('{Enter}')
      }
      expect(screen.getByRole('status')).toHaveTextContent(
        'Editing Test channel'
      )
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    }
  )
})
