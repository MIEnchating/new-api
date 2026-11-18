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
  test.each([true, false])(
    'userMode %s applies the user quota only to personal templates',
    async (userMode) => {
      const user = userEvent.setup()
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      client.setQueryData(
        userMode ? ['smart-routing-groups', 'user'] : ['smart-routing-groups'],
        ['default']
      )
      render(
        <QueryClientProvider client={client}>
          <SmartRoutingSection
            userMode={userMode}
            maxTemplates={1}
            defaultValues={{
              'smart_routing_setting.enabled': true,
              'smart_routing_setting.templates': JSON.stringify([
                { id: 'existing', name: 'Existing', enabled: false },
              ]),
            }}
          />
        </QueryClientProvider>
      )
      expect(
        screen.getByRole('switch', { name: 'Enable routing template' })
      ).not.toBeChecked()
      const add = screen.getByRole('button', { name: 'Add template' })
      if (userMode) {
        expect(add).toBeDisabled()
        await user.click(
          screen.getByRole('button', { name: 'Remove routing template' })
        )
      } else {
        expect(add).toBeEnabled()
      }
      await user.click(screen.getByRole('button', { name: 'Add template' }))
      const switches = screen.getAllByRole('switch', {
        name: 'Enable routing template',
      })
      expect(switches.at(-1)).toBeChecked()
      expect(switches).toHaveLength(userMode ? 1 : 2)
      client.clear()
    }
  )

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
    expect(
      screen.queryByRole('spinbutton', {
        name: 'Maximum user routing templates',
      })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add template' }))

    expect(screen.getByText('Routing template #1')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Template name' })).toBeVisible()
    expect(
      screen.getByRole('switch', { name: 'Enable routing template' })
    ).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Add route group' }))

    expect(screen.getByRole('combobox', { name: 'Group' })).toBeVisible()
    expect(
      screen.queryByRole('spinbutton', { name: 'Priority' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('spinbutton', { name: 'Cooldown time (seconds)' })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add route group' }))
    const priorities = screen.getAllByRole('spinbutton', { name: 'Priority' })
    const cooldowns = screen.getAllByRole('spinbutton', {
      name: 'Cooldown time (seconds)',
    })
    expect(priorities).toHaveLength(2)
    expect(cooldowns).toHaveLength(2)
    await user.clear(priorities[0])
    await user.type(priorities[0], '7')
    await user.clear(cooldowns[0])
    await user.type(cooldowns[0], '90')

    await user.click(
      screen.getAllByRole('button', { name: 'Remove route group' })[1]
    )
    expect(
      screen.queryByRole('spinbutton', { name: 'Priority' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('spinbutton', { name: 'Cooldown time (seconds)' })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add route group' }))
    expect(
      screen.getAllByRole('spinbutton', { name: 'Priority' })[0]
    ).toHaveValue(7)
    expect(
      screen.getAllByRole('spinbutton', { name: 'Cooldown time (seconds)' })[0]
    ).toHaveValue(90)

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
