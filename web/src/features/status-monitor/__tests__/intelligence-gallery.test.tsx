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
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import {
  type IntelligenceTask,
  intelligenceResultsQueryKey,
} from '../intelligence-api'
import { IntelligenceMonitor } from '../intelligence-monitor'
import { buildIntelligenceCards } from '../intelligence-results'

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

it('keeps cached cards and group tabs available when refresh fails, and recovers on retry', async () => {
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
    // Resume with explicitly stale data; interval-only fake timers do not
    // advance the wall clock used to decide whether focus should refetch.
    await act(async () => {
      await client.invalidateQueries({
        queryKey: intelligenceResultsQueryKey,
        refetchType: 'none',
      })
    })
    await act(async () => focusManager.setFocused(true))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  } finally {
    view.unmount()
    client.clear()
    focusManager.setFocused(undefined)
    vi.useRealTimers()
  }
})

it('limits each group to 20 cards without search or status controls', async () => {
  const channels = Array.from({ length: 24 }, (_, index) => ({
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
    expect(screen.getAllByLabelText(/^Model: /)).toHaveLength(20)
    expect(screen.queryByLabelText('Model: model-23')).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: 'Status' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'standard' })).toHaveTextContent(
      '20'
    )
    expect(screen.getByRole('tab', { name: 'All' })).toHaveTextContent('20')
  } finally {
    view.unmount()
    client.clear()
  }
})

it('filters by a card group with the keyboard and returns to all groups', async () => {
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
    expect(screen.getByLabelText('Model: model-2')).toBeVisible()
    const card = screen
      .getByLabelText('Model: model-3')
      .closest('[data-slot=card]') as HTMLElement
    expect(within(card).getByText('Pelican')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'All' }))
    expect(screen.getAllByLabelText(/^Model: /)).toHaveLength(3)
  } finally {
    view.unmount()
    client.clear()
  }
})

it('caps groups independently after expanding multi-model runs, retaining newest results', () => {
  const history = Array.from({ length: 12 }, (_, index) => {
    const channels = ['standard', 'premium'].flatMap((group) =>
      ['a', 'b'].map((model, channel_id) => ({
        group,
        model,
        channel_id,
        endpoint: 'openai-response',
        question_index: 0,
        question_name: 'Pelican',
        latency_ms: 100,
        error: '',
      }))
    )
    return { ...historyTask(index), groups: channels, result: { channels } }
  })
  const result = buildIntelligenceCards(history)
  expect(result.cards).toHaveLength(40)
  expect([...result.groupCounts]).toEqual([
    ['standard', 20],
    ['premium', 20],
  ])
  expect(result.cards.some((card) => card.task.task_id === 'gallery-9')).toBe(
    true
  )
  expect(result.cards.some((card) => card.task.task_id === 'gallery-10')).toBe(
    false
  )
})

it('defers new preview requests during scrolling and preserves an already visible document', async () => {
  let intersect: (visible: boolean) => void = () => undefined
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = (visible) =>
          callback(
            [{ isIntersecting: visible } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          )
      }
      observe() {}
      disconnect() {}
    }
  )
  const task = historyTask(0)
  task.result = {
    channels: [
      {
        channel_id: 0,
        question_index: 0,
        question_name: 'Pelican',
        latency_ms: 100,
        error: '',
        html: '<html><body>Preview</body></html>',
      },
    ],
  }
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/gallery-0') ? task : { history: [task] },
    },
  }))
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const panel = screen.getByRole('tabpanel')
    fireEvent.scroll(panel)
    act(() => intersect(true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160)
    })
    expect(get.mock.calls.map(([url]) => url)).toEqual([
      '/api/status-monitor/intelligence/results',
    ])
    expect(
      screen.queryByTitle('Generated animation preview')
    ).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    vi.useRealTimers()
    const frame = await screen.findByTitle('Generated animation preview')
    fireEvent.scroll(panel)
    expect(screen.getByTitle('Generated animation preview')).toBe(frame)
  } finally {
    view.unmount()
    client.clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
