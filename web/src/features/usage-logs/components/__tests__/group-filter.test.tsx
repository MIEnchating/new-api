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
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { CommonLogsFilterBar } from '../common-logs-filter-bar'
import { UsageLogsProvider } from '../usage-logs-provider'

const pointerCaptureDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'setPointerCapture'
)

function FilterFixture() {
  const table = useReactTable({
    data: [],
    columns: [],
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <UsageLogsProvider>
      <CommonLogsFilterBar table={table} />
    </UsageLogsProvider>
  )
}

async function renderFilter(
  initialEntry = '/usage-logs/common',
  groups: Record<string, { desc: string; ratio: number }> | null = {
    default: { desc: '', ratio: 1 },
    premium: { desc: '', ratio: 2 },
  },
  hideSensitive = false
) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/self/groups' || url === '/api/group/') {
      if (groups === null) throw new Error('Group loading failed')
      return {
        data: {
          success: true,
          data: url === '/api/group/' ? Object.keys(groups) : groups,
        },
      }
    }
    return { data: { success: true, data: { quota: 0, rpm: 0, tpm: 0 } } }
  })
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: FilterFixture,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  if (hideSensitive) {
    await userEvent.click(await screen.findByRole('button', { name: /^Hide$/ }))
  }
  if (window.matchMedia('(max-width: 640px)').matches) {
    await userEvent.click(
      await screen.findByRole('button', { name: /^Filter/ })
    )
  }
  await screen.findByRole('button', { name: /^Group/ })
  return router
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.setUser(null)
  if (pointerCaptureDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'setPointerCapture',
      pointerCaptureDescriptor
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  }
})

it('loads personal groups and filters choices without submitting until Search', async () => {
  const router = await renderFilter()
  await userEvent.click(screen.getByRole('button', { name: /^Group/ }))
  expect(await screen.findByRole('option', { name: 'default' })).toBeVisible()
  await userEvent.type(screen.getByPlaceholderText('Group'), 'prem')
  expect(
    screen.queryByRole('option', { name: 'default' })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('option', { name: 'premium' }))
  expect(screen.getByRole('button', { name: /^Group/ })).toHaveTextContent(
    'premium'
  )
  expect(router.state.location.search).not.toHaveProperty('group')
  await userEvent.keyboard('{Escape}')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      group: 'premium',
      page: 1,
    })
  )
  expect(api.get).toHaveBeenCalledWith('/api/user/self/groups')
  expect(api.get).not.toHaveBeenCalledWith('/api/group/')
})

it('loads all groups in the administrator view', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 10 })
  await renderFilter()
  await userEvent.click(screen.getByRole('button', { name: /^Group/ }))
  expect(await screen.findByRole('option', { name: 'premium' })).toBeVisible()
  expect(api.get).toHaveBeenCalledWith('/api/group/')
  expect(api.get).not.toHaveBeenCalledWith('/api/user/self/groups')
})

it('selects a group with the keyboard and waits for Search to apply it', async () => {
  const router = await renderFilter()
  const trigger = screen.getByRole('button', { name: /^Group/ })
  trigger.focus()
  await userEvent.keyboard('{Enter}')
  await screen.findByRole('option', { name: 'default' })
  await userEvent.type(screen.getByPlaceholderText('Group'), 'premium')
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(trigger).toHaveTextContent('premium')
  expect(router.state.location.search).not.toHaveProperty('group')
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ group: 'premium' })
  )
})

it.each([{}, null])(
  'preserves and clears a historical URL group when groups are unavailable (%s)',
  async (groups) => {
    const router = await renderFilter(
      '/usage-logs/common?group=retired',
      groups
    )
    const trigger = screen.getByRole('button', { name: /^Group/ })
    expect(trigger).toHaveTextContent('retired')
    await userEvent.click(trigger)
    expect(await screen.findByRole('option', { name: 'retired' })).toBeVisible()
    await userEvent.click(screen.getByRole('option', { name: 'Clear filters' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(router.state.location.search).not.toHaveProperty('group')
    )
  }
)

it('resets the selected group and restores a historical group from URL navigation', async () => {
  const router = await renderFilter('/usage-logs/common?group=premium')
  const trigger = screen.getByRole('button', { name: /^Group/ })
  expect(trigger).toHaveTextContent('premium')
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
  await waitFor(() => expect(trigger).not.toHaveTextContent('premium'))
  expect(router.state.location.search).not.toHaveProperty('group')
  router.history.push('/usage-logs/common?group=retired')
  await waitFor(() => expect(trigger).toHaveTextContent('retired'))
})

it('clears a selected group by choosing it again', async () => {
  const router = await renderFilter('/usage-logs/common?group=premium')
  await userEvent.click(screen.getByRole('button', { name: /^Group/ }))
  await userEvent.click(await screen.findByRole('option', { name: 'premium' }))
  await userEvent.keyboard('{Escape}')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(router.state.location.search).not.toHaveProperty('group')
  )
})

it('masks the full-width trigger and dropdown, suppresses native tooltips, and restores visibility', async () => {
  await renderFilter('/usage-logs/common?group=premium')
  const trigger = screen.getByRole('button', { name: /^Group/ })
  expect(trigger).toHaveClass('w-full', 'min-w-0')
  await userEvent.click(screen.getByRole('button', { name: /^Hide$/ }))
  expect(trigger).toHaveClass('[-webkit-text-security:disc]')
  await userEvent.click(trigger)
  const option = await screen.findByRole('option', { name: 'premium' })
  expect(option.closest('.\\[-webkit-text-security\\:disc\\]')).not.toBeNull()
  expect(within(option).getByText('premium')).not.toHaveAttribute('title')
  expect(
    screen
      .getByPlaceholderText('Group')
      .closest('.\\[-webkit-text-security\\:disc\\]')
  ).not.toBeNull()
  await userEvent.keyboard('{Escape}')
  await userEvent.click(screen.getByRole('button', { name: /^Show$/ }))
  expect(trigger).not.toHaveClass('[-webkit-text-security:disc]')
  await userEvent.click(trigger)
  expect(
    within(await screen.findByRole('option', { name: 'premium' })).getByText(
      'premium'
    )
  ).toHaveAttribute('title', 'premium')
})

it('masks mobile group options and selects a long group in the nested drawer', async () => {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  const originalMatchMedia = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...originalMatchMedia(query),
    matches: query === '(max-width: 640px)',
  }))
  const longGroup = 'enterprise-team-with-a-long-group-name'
  const router = await renderFilter(
    '/usage-logs/common',
    { [longGroup]: { desc: '', ratio: 1 } },
    true
  )
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: /^Group/ })
  )
  const groups = await screen.findByRole('dialog', { name: 'Group' })
  const option = await within(groups).findByRole('button', { name: longGroup })
  expect(option.closest('.\\[-webkit-text-security\\:disc\\]')).not.toBeNull()
  await userEvent.click(option)
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Group' })
    ).not.toBeInTheDocument()
  )
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Search' })
  )
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ group: longGroup })
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

it.each([1, 10])(
  'excludes only auto from group choices for role %s',
  async (role) => {
    useAuthStore.getState().auth.setUser({ id: 1, username: 'viewer', role })
    const router = await renderFilter('/usage-logs/common', {
      auto: { desc: '', ratio: 1 },
      'auto-team': { desc: '', ratio: 1 },
    })
    await userEvent.click(screen.getByRole('button', { name: /^Group/ }))
    const option = await screen.findByRole('option', { name: 'auto-team' })
    expect(
      screen.queryByRole('option', { name: 'auto' })
    ).not.toBeInTheDocument()
    await userEvent.click(option)
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ group: 'auto-team' })
    )
  }
)

it('keeps a historical auto filter until explicitly cleared', async () => {
  const router = await renderFilter('/usage-logs/common?group=auto', {
    auto: { desc: '', ratio: 1 },
  })
  await userEvent.click(screen.getByRole('button', { name: /^Group/ }))
  expect(screen.queryByRole('option', { name: 'auto' })).not.toBeInTheDocument()
  expect(router.state.location.search).toMatchObject({ group: 'auto' })
  await userEvent.click(screen.getByRole('option', { name: 'Clear filters' }))
  await userEvent.keyboard('{Escape}')
  await userEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(router.state.location.search).not.toHaveProperty('group')
  )
})
