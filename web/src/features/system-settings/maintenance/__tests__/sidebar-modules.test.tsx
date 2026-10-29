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
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import {
  parseSidebarModulesAdmin,
  serializeSidebarModulesAdmin,
} from '../config'
import { SidebarModulesSection } from '../sidebar-modules-section'

function SidebarSettings() {
  const [actionsContainer, setActionsContainer] =
    useState<HTMLDivElement | null>(null)
  const [config] = useState(() =>
    parseSidebarModulesAdmin(
      '{"personal":{"enabled":true,"topup":true},"admin":{"enabled":true,"topup_stats":true}}'
    )
  )
  return (
    <>
      <div ref={setActionsContainer} />
      <SettingsPageProvider actionsContainer={actionsContainer}>
        <SidebarModulesSection
          config={config}
          initialSerialized={serializeSidebarModulesAdmin(config)}
        />
      </SettingsPageProvider>
    </>
  )
}

it('saves independent invoice switches and restores them with sidebar defaults', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <SidebarSettings />
    </QueryClientProvider>
  )
  const applications = screen.getByRole('switch', {
    name: 'Invoice applications',
  })
  const management = screen.getByRole('switch', { name: 'Invoice management' })
  expect(applications).toBeChecked()
  expect(management).toBeChecked()
  await user.click(applications)
  await user.click(management)
  await user.click(screen.getByRole('button', { name: 'Save sidebar modules' }))
  await waitFor(() => expect(put).toHaveBeenCalled())
  const request = put.mock.calls[0][1] as { key: string; value: string }
  expect(request.key).toBe('SidebarModulesAdmin')
  expect(JSON.parse(request.value)).toMatchObject({
    personal: { topup: true, invoices: false },
    admin: { topup_stats: true, invoice_requests: false },
  })
  await user.click(screen.getByRole('button', { name: 'Reset to default' }))
  expect(applications).toBeChecked()
  expect(management).toBeChecked()
  client.clear()
})
