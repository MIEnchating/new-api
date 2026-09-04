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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { SmartRoutingSection } from '../smart-routing-section'

describe('smart routing template editor', () => {
  test('adds and removes a routing template from the empty state', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false, staleTime: Infinity },
      },
    })
    const actionsContainer = document.createElement('div')
    document.body.append(actionsContainer)
    queryClient.setQueryData(['smart-routing-groups'], {
      success: true,
      data: ['default', 'vip'],
    })

    render(
      <QueryClientProvider client={queryClient}>
        <SettingsPageProvider
          actionsContainer={actionsContainer}
          suppressSectionHeader={false}
        >
          <SmartRoutingSection
            defaultValues={{
              'smart_routing_setting.enabled': false,
              'smart_routing_setting.templates': '[]',
            }}
          />
        </SettingsPageProvider>
      </QueryClientProvider>
    )

    expect(
      screen.getByText('No routing templates configured')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add template' }))

    expect(screen.getByText('Routing template #1')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Template name' })).toBeVisible()
    expect(
      screen.getByRole('switch', { name: 'Enable routing template' })
    ).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Add route group' }))

    expect(screen.getByRole('combobox', { name: 'Group' })).toBeVisible()
    expect(screen.getByRole('spinbutton', { name: 'Priority' })).toHaveValue(1)
    expect(screen.getByText('Cooldown time (seconds)')).toBeVisible()

    await user.click(
      screen.getByRole('button', { name: 'Remove routing template' })
    )

    expect(
      screen.getByText('No routing templates configured')
    ).toBeInTheDocument()

    actionsContainer.remove()
    queryClient.clear()
  })
})
