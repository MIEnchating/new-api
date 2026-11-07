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
  act,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { TopNav } from '@/components/layout/components/top-nav'
import { api } from '@/lib/api'
import { parseCustomMenuPages } from '@/lib/custom-menu-pages'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

import { customMenuPagesQueryOptions } from '../use-custom-menu-pages'
import { useSidebarData } from '../use-sidebar-data'
import { useTopNavLinks } from '../use-top-nav-links'

afterEach(() => {
  useAuthStore.setState(useAuthStore.getInitialState(), true)
})

function navigationFor(role: number) {
  if (role > 0) {
    useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role })
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    HeaderNavModules: JSON.stringify({
      home: false,
      console: false,
      pricing: false,
      rankings: false,
      siteStatus: false,
      docs: false,
      about: false,
    }),
  })
  const pages = parseCustomMenuPages([
    {
      id: 'page_header01',
      name: 'Help',
      url: 'https://example.com/?issuer={origin}',
      visibility: 'public',
      section: 'header',
    },
    {
      id: 'page_header02',
      name: 'Admin link',
      url: 'https://example.com/admin',
      visibility: 'admin',
      section: 'header',
    },
    {
      id: 'page_disabled',
      name: 'Disabled link',
      url: 'https://example.com/disabled',
      visibility: 'public',
      section: 'header',
      enabled: false,
    },
    {
      id: 'page_sidebar1',
      name: 'Sidebar help',
      url: 'https://example.com/sidebar',
      visibility: 'public',
    },
  ])
  if (role > 0) {
    client.setQueryData(customMenuPagesQueryOptions(role).queryKey, pages)
  }
  function Wrapper(props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }
  const hook = renderHook(
    () => ({ top: useTopNavLinks(), sidebar: useSidebarData() }),
    { wrapper: Wrapper }
  )
  return { ...hook, client, pages }
}

test.each([1, 10])(
  'top links respect visibility and stay out of the sidebar for role %s',
  async (role) => {
    const { result, client, pages, unmount } = navigationFor(role)
    expect(result.current.top.map((link) => link.title)).toEqual(
      role === 10 ? ['Help', 'Admin link'] : ['Help']
    )
    expect(result.current.top[0]).toEqual({
      title: 'Help',
      href: `https://example.com/?issuer=${window.location.origin}`,
      external: true,
    })
    const sidebarTitles = result.current.sidebar.navGroups.flatMap((group) =>
      group.items.map((item) => item.title)
    )
    expect(sidebarTitles).toContain('Sidebar help')
    expect(sidebarTitles).not.toContain('Help')
    expect(sidebarTitles).not.toContain('Admin link')
    expect(sidebarTitles).not.toContain('Disabled link')

    await act(() =>
      client.setQueryData(
        customMenuPagesQueryOptions(role).queryKey,
        pages.map((page) => ({ ...page, enabled: false }))
      )
    )
    await waitFor(() => expect(result.current.top).toEqual([]))
    unmount()
    client.clear()
  }
)

test('guests do not request the authenticated custom menu endpoint', () => {
  const get = vi.spyOn(api, 'get')
  const { result, unmount, client } = navigationFor(0)
  expect(result.current.top).toEqual([])
  expect(get).not.toHaveBeenCalledWith('/api/custom-menu-pages')
  unmount()
  client.clear()
})

test('desktop and mobile top navigation render text-only external links in a new tab', async () => {
  const { result, unmount, client } = navigationFor(1)
  const view = render(<TopNav links={result.current.top} />)
  const desktop = within(screen.getByRole('navigation')).getByRole('link', {
    name: 'Help',
  })
  expect(desktop).toHaveAttribute(
    'href',
    `https://example.com/?issuer=${window.location.origin}`
  )
  expect(desktop).toHaveAttribute('target', '_blank')
  expect(desktop).toHaveAttribute('rel', 'noopener noreferrer')
  expect(within(desktop).queryByRole('img')).not.toBeInTheDocument()

  await userEvent.click(
    screen.getByRole('button', { name: 'Toggle navigation menu' })
  )
  const mobile = screen.getByRole('menuitem', { name: 'Help' })
  expect(mobile).toHaveAttribute('href', desktop.getAttribute('href'))
  expect(mobile).toHaveAttribute('target', '_blank')
  expect(mobile).toHaveAttribute('rel', 'noopener noreferrer')
  view.unmount()
  unmount()
  client.clear()
})
