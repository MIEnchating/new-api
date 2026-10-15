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
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'

import { SearchProvider } from '@/context/search-provider'
import { customMenuPagesQueryOptions } from '@/hooks/use-custom-menu-pages'
import type { CustomMenuPage } from '@/lib/custom-menu-pages'
import { ROLE } from '@/lib/roles'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

import { CommandMenu } from '../command-menu'
import { Search } from '../search'

const adminEntries = ['Channels', 'Models', 'Users', 'Redemption Codes']
const superAdminEntries = ['System Info', 'Task Plugins', 'System Settings']

// jsdom lacks the Web Animations API the menu's scroll area waits on.
const getAnimationsDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})

afterAll(() => {
  if (getAnimationsDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'getAnimations',
      getAnimationsDescriptor
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  }
})

afterEach(() => {
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  window.localStorage.clear()
  vi.restoreAllMocks()
})

async function searchEntriesFor(
  role: number,
  sidebarModulesAdmin = '',
  customPages: CustomMenuPage[] = []
) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    SidebarModulesAdmin: sidebarModulesAdmin,
  })
  client.setQueryData(customMenuPagesQueryOptions(role).queryKey, customPages)
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <SearchProvider>
          <Search />
          <CommandMenu />
        </SearchProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/dashboard/overview'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  await userEvent.click(await screen.findByRole('button', { name: 'Search' }))
  const options = await screen.findAllByRole('option')
  return options.map((option) => option.textContent)
}

test('regular users only find their own console pages in search', async () => {
  const entries = await searchEntriesFor(ROLE.USER)

  expect(entries).toEqual(
    expect.arrayContaining(['API Keys', 'Usage Logs', 'Wallet', 'Profile'])
  )
  for (const entry of [...adminEntries, ...superAdminEntries]) {
    expect(entries).not.toContain(entry)
  }
})

test('admins find admin pages in search but not super admin pages', async () => {
  const entries = await searchEntriesFor(ROLE.ADMIN)

  expect(entries).toEqual(expect.arrayContaining(adminEntries))
  for (const entry of superAdminEntries) {
    expect(entries).not.toContain(entry)
  }
})

test('pages hidden in the sidebar settings stay out of search', async () => {
  const entries = await searchEntriesFor(
    ROLE.USER,
    JSON.stringify({ personal: { enabled: true, topup: false } })
  )

  expect(entries).not.toContain('Wallet')
  expect(entries).toContain('Profile')
})

const customPages: CustomMenuPage[] = [
  {
    id: 'public_guide',
    name: 'Public guide',
    url: 'https://docs.example.org',
    visibility: 'public',
    openMode: 'external',
  },
  {
    id: 'admin_guide',
    name: 'Admin guide',
    url: 'https://admin.example.org',
    visibility: 'admin',
    openMode: 'iframe',
  },
  {
    id: 'disabled_guide',
    name: 'Disabled guide',
    url: 'https://disabled.example.org',
    visibility: 'public',
    openMode: 'iframe',
    enabled: false,
  },
]

test.each([ROLE.USER, ROLE.ADMIN])(
  'search preserves custom pages and fork features for role %s',
  async (role) => {
    const entries = await searchEntriesFor(role, '', customPages)

    expect(entries).toEqual(
      expect.arrayContaining([
        'Channel Monitor',
        'Invitation Rebates',
        'Lottery Center',
        'Public guide',
      ])
    )
    expect(entries).not.toContain('Disabled guide')
    if (role === ROLE.ADMIN) {
      expect(entries).toEqual(
        expect.arrayContaining(['Order Management', 'Admin guide'])
      )
    } else {
      expect(entries).not.toContain('Order Management')
      expect(entries).not.toContain('Admin guide')
    }
  }
)

test('selecting an external custom page opens it separately and closes search', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  await searchEntriesFor(ROLE.USER, '', customPages)

  await userEvent.click(screen.getByRole('option', { name: 'Public guide' }))

  expect(open).toHaveBeenCalledWith(
    'https://docs.example.org',
    '_blank',
    'noopener,noreferrer'
  )
  await waitFor(() =>
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  )
})
