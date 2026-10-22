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
  it('saves individual tabs and preserves their choices while the entire page is hidden', async () => {
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
    const intelligence = screen.getByRole('switch', {
      name: 'Show intelligence testing',
    })
    const uptime = screen.getByRole('switch', { name: 'Show site status' })
    const official = screen.getByRole('switch', {
      name: 'Show official status',
    })
    await user.click(intelligence)
    await user.click(official)
    await user.click(screen.getByRole('switch', { name: 'Site status' }))
    for (const control of [intelligence, uptime, official]) {
      expect(control).toHaveAttribute('aria-disabled', 'true')
    }
    await user.click(screen.getByRole('button', { name: 'Save navigation' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    const saved = JSON.parse((put.mock.calls[0][1] as { value: string }).value)
    expect(saved.siteStatus).toEqual({
      enabled: false,
      requireAuth: false,
      tabs: { intelligence: false, uptime: true, official: false },
    })
    await user.click(screen.getByRole('switch', { name: 'Site status' }))
    expect(intelligence).not.toBeChecked()
    expect(uptime).toBeChecked()
    expect(official).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Reset to default' }))
    for (const control of [intelligence, uptime, official]) {
      expect(control).toBeChecked()
    }
    client.clear()
  })

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
          siteStatus: {
            ...parseHeaderNavModules(null).siteStatus,
            enabled: false,
            requireAuth: true,
          },
        }),
      })
    )
    client.clear()
  })

  it('stored tab choices survive serialization even when every tab is hidden', () => {
    const siteStatus = {
      enabled: true,
      requireAuth: true,
      tabs: {
        intelligence: false,
        uptime: false,
        official: false,
      },
    }
    const config = parseHeaderNavModules(JSON.stringify({ siteStatus }))
    expect(config.siteStatus).toEqual(siteStatus)
    const runtime = parseHeaderNavModulesFromStatus({
      HeaderNavModules: serializeHeaderNavModules(config),
    })
    expect(runtime.siteStatus).toEqual({ ...siteStatus, enabled: false })
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
      ).toEqual({
        ...expected,
        tabs: { intelligence: true, uptime: true, official: true },
      })
    }
  )
})
