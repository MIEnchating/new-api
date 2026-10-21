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
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import {
  type IntelligenceTask,
  intelligenceResultsQueryKey,
} from '../intelligence-api'
import { IntelligenceMonitor } from '../intelligence-monitor'

function historyTask(index: number, group = 'standard'): IntelligenceTask {
  return {
    task_id: `gallery-${index}`,
    status: 'failed',
    created_at: 1791613858,
    updated_at: 1791613858,
    group,
    model: `model-${index}`,
    endpoint: 'openai-response',
    error: '',
    result: {
      channels: [
        {
          channel_id: index,
          question_index: 0,
          question_name: 'Pelican',
          latency_ms: 100,
          error: 'Example upstream error',
        },
      ],
    },
  }
}

it('keeps cached cards and filters available when refresh fails, and recovers on retry', async () => {
  const user = userEvent.setup()
  const task = historyTask(1)
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { history: [task] } },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligenceMonitor />
    </QueryClientProvider>
  )
  try {
    const model = await screen.findByLabelText('Model: model-1')
    get.mockRejectedValueOnce(new Error('Offline'))
    await act(async () => {
      await client.refetchQueries({ queryKey: intelligenceResultsQueryKey })
    })
    expect(
      await screen.findByText(
        'Refresh failed. Showing the last available data.'
      )
    ).toBeVisible()
    expect(model).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() =>
      expect(
        screen.queryByText('Refresh failed. Showing the last available data.')
      ).not.toBeInTheDocument()
    )
    expect(screen.getByLabelText('Model: model-1')).toBe(model)
  } finally {
    view.unmount()
    client.clear()
  }
})

it('stops automatic history requests while the page is hidden', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { history: [historyTask(1)] } },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligenceMonitor />
    </QueryClientProvider>
  )
  try {
    await screen.findByLabelText('Model: model-1')
    act(() => focusManager.setFocused(false))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65000)
    })
    expect(get).toHaveBeenCalledTimes(1)
    act(() => focusManager.setFocused(true))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  } finally {
    view.unmount()
    client.clear()
    focusManager.setFocused(undefined)
    vi.useRealTimers()
  }
})

it('searches every result in a multi-model run and clears search with focus preserved', async () => {
  const user = userEvent.setup()
  const channels = Array.from({ length: 25 }, (_, index) => ({
    group: 'standard',
    model: `model-${index}`,
    endpoint: 'openai-response',
    channel_id: index,
    question_index: 0,
    question_name: 'Pelican',
    latency_ms: 100,
    error: 'Example upstream error',
  }))
  const history = [
    { ...historyTask(0), groups: channels, result: { channels } },
  ]
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { history } },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligenceMonitor />
    </QueryClientProvider>
  )
  try {
    await screen.findByLabelText('Model: model-0')
    expect(screen.getAllByLabelText(/^Model: /)).toHaveLength(25)
    expect(screen.getByLabelText('Model: model-24')).toBeVisible()
    const search = screen.getByRole('searchbox', {
      name: 'Search test results',
    })
    await user.type(search, 'MODEL-24')
    expect(screen.getAllByLabelText(/^Model: /)).toHaveLength(1)
    expect(screen.getByLabelText('Model: model-24')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search).toHaveFocus()
    expect(screen.getAllByLabelText(/^Model: /)).toHaveLength(25)
    await user.type(search, 'missing')
    expect(await screen.findByText('No matching results')).toBeVisible()
    await user.keyboard('{Escape}')
    expect(search).toHaveValue('')
    expect(screen.getAllByLabelText(/^Model: /)).toHaveLength(25)
  } finally {
    view.unmount()
    client.clear()
  }
})

it('filters by a card group with the keyboard and combines status and question search', async () => {
  const user = userEvent.setup()
  const pending = {
    ...historyTask(2, 'premium'),
    status: 'pending' as const,
    result: undefined,
  }
  const history = [
    historyTask(1, 'standard'),
    pending,
    historyTask(3, 'premium'),
  ]
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { history } },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligenceMonitor />
    </QueryClientProvider>
  )
  try {
    const groupButton = (
      await screen.findAllByRole('button', { name: 'Filter by group premium' })
    )[0]
    groupButton.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('tab', { name: 'premium' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.queryByLabelText('Model: model-1')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText(/^Model: /)).toHaveLength(2)
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(screen.getByRole('option', { name: 'Pending' }))
    expect(screen.getByLabelText('Model: model-2')).toBeVisible()
    expect(screen.queryByLabelText('Model: model-3')).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(screen.getByRole('option', { name: 'All statuses' }))
    await user.type(
      screen.getByRole('searchbox', { name: 'Search test results' }),
      'pelican'
    )
    const card = screen
      .getByLabelText('Model: model-3')
      .closest('[data-slot=card]') as HTMLElement
    expect(within(card).getByText('Pelican')).toBeVisible()
    expect(screen.queryByLabelText('Model: model-2')).not.toBeInTheDocument()
  } finally {
    view.unmount()
    client.clear()
  }
})
