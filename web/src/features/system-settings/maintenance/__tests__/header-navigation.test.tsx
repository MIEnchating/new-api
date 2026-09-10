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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { parseHeaderNavModules, serializeHeaderNavModules } from '../config'
import { HeaderNavigationSection } from '../header-navigation-section'

function NavigationSettings() {
  const [actionsContainer, setActionsContainer] =
    useState<HTMLDivElement | null>(null)
  const config = parseHeaderNavModules(null)
  return (
    <>
      <div ref={setActionsContainer} />
      <SettingsPageProvider actionsContainer={actionsContainer}>
        <HeaderNavigationSection
          config={config}
          initialSerialized={serializeHeaderNavModules(config)}
        />
      </SettingsPageProvider>
    </>
  )
}

describe('site status navigation settings', () => {
  it('saving site status visibility and login controls preserves other navigation modules', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <NavigationSettings />
      </QueryClientProvider>
    )

    const enabled = screen.getByRole('switch', { name: 'Site status' })
    const login = screen.getByRole('switch', {
      name: 'Require login to view site status',
    })
    expect(enabled).toBeChecked()
    expect(login).not.toBeChecked()
    await user.click(login)
    await user.click(enabled)
    expect(login).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('button', { name: 'Save navigation' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/option/', {
        key: 'HeaderNavModules',
        value: serializeHeaderNavModules({
          ...parseHeaderNavModules(null),
          siteStatus: { enabled: false, requireAuth: true },
        }),
      })
    )
    client.clear()
  })

  it.each([
    [undefined, { enabled: true, requireAuth: false }],
    [false, { enabled: false, requireAuth: false }],
    [
      { enabled: true, requireAuth: true },
      { enabled: true, requireAuth: true },
    ],
  ])(
    'stored site status configuration %j round-trips to runtime navigation',
    (siteStatus, expected) => {
      const serialized = serializeHeaderNavModules(
        parseHeaderNavModules(JSON.stringify({ siteStatus }))
      )
      expect(
        parseHeaderNavModulesFromStatus({ HeaderNavModules: serialized })
          .siteStatus
      ).toEqual(expected)
    }
  )
})
