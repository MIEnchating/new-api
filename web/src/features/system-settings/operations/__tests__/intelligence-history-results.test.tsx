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
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import type { IntelligenceTask } from '@/features/status-monitor/intelligence-api'
import { api } from '@/lib/api'

import { IntelligenceHistory } from '../intelligence-history'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})

function renderHistory(
  channels: NonNullable<IntelligenceTask['result']>['channels']
) {
  const task: IntelligenceTask = {
    task_id: 'history-results',
    status: 'succeeded',
    created_at: 1791613858,
    updated_at: 1791613858,
    group: 'default',
    model: 'legacy-model',
    endpoint: 'openai',
    error: '',
    result: { channels },
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <IntelligenceHistory history={[task]} />
    </QueryClientProvider>
  )
  return task
}

const channel = {
  channel_id: 108,
  question_index: 0,
  question_name: 'Pelican',
  latency_ms: 100,
  error: '',
}

it('loads only the selected history result on demand and returns keyboard focus when closed', async () => {
  const get = vi.spyOn(api, 'get')
  const channels = [
    { ...channel, group: 'default', model: 'first-model' },
    { ...channel, group: 'vip', model: 'first-model' },
    { ...channel, group: 'vip', model: 'second-model' },
    { ...channel, group: 'vip', model: 'second-model', question_index: 1 },
  ]
  const task = renderHistory(channels)
  get.mockResolvedValue({
    data: {
      success: true,
      data: {
        ...task,
        result: {
          channels: channels.map((row, index) => ({
            ...row,
            html: `<html><body><h1>Result ${index}</h1></body></html>`,
          })),
        },
      },
    },
  })
  const user = userEvent.setup()
  expect(get).not.toHaveBeenCalled()
  expect(
    screen.queryByTitle('Generated animation preview')
  ).not.toBeInTheDocument()
  const buttons = screen.getAllByRole('button', { name: 'View result' })
  for (const [index, button] of buttons.entries()) {
    button.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', {
      name: 'Generated animation preview',
    })
    const frame = await within(dialog).findByTitle(
      'Generated animation preview'
    )
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(frame.getAttribute('srcdoc')).toContain(`<h1>Result ${index}</h1>`)
    expect(frame.getAttribute('srcdoc')).toContain("connect-src 'none'")
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(button).toHaveFocus()
    expect(
      screen.queryByTitle('Generated animation preview')
    ).not.toBeInTheDocument()
  }
  expect(get).toHaveBeenCalledExactlyOnceWith(
    '/api/status-monitor/intelligence/results/history-results'
  )
})

it('keeps the result dialog usable during loading, failure, retry and empty legacy output', async () => {
  let rejectRequest!: (reason: Error) => void
  const get = vi.spyOn(api, 'get').mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectRequest = reject
      })
  )
  const task = renderHistory([channel])
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'View result' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('Loading...')).toBeVisible()
  rejectRequest(new Error('Network failure'))
  const retry = await within(dialog).findByRole('button', { name: 'Retry' })
  get.mockResolvedValueOnce({ data: { success: true, data: task } })
  await user.click(retry)
  expect(
    await within(dialog).findByText('Intelligence test returned no output')
  ).toBeVisible()
  expect(
    within(dialog).queryByTitle('Generated animation preview')
  ).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(screen.getByRole('button', { name: 'View result' })).toHaveFocus()
})

it('previews legacy records without group or model fields and omits failed request actions', async () => {
  const get = vi.spyOn(api, 'get')
  const task = renderHistory([
    channel,
    { ...channel, question_index: 1, error: 'Upstream request failed' },
  ])
  get.mockResolvedValueOnce({
    data: {
      success: true,
      data: {
        ...task,
        result: {
          channels: [
            { ...channel, html: '<html><body>Legacy result</body></html>' },
          ],
        },
      },
    },
  })
  expect(screen.getAllByRole('button', { name: 'View result' })).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'View result' }))
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveAccessibleDescription('default · legacy-model · Pelican')
  const frame = await within(dialog).findByTitle('Generated animation preview')
  expect(frame.getAttribute('srcdoc')).toContain('Legacy result')
})
