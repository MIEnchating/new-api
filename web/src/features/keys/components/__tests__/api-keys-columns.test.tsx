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
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import type { ApiKey } from '../../types'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { TooltipProvider } = await import('@/components/ui/tooltip')
const { api } = await import('@/lib/api')
const { ApiKeysProvider } = await import('../api-keys-provider')
const { useApiKeysColumns } = await import('../api-keys-columns')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Group routing rules': 'Group routing rules',
        '{{count}} groups': '{{count}} groups',
      },
    },
  },
})

const apiKey: ApiKey = {
  id: 1,
  name: 'Routed key',
  key: 'sk-routed-key',
  status: 1,
  remain_quota: 100,
  used_quota: 0,
  unlimited_quota: false,
  expired_time: -1,
  created_time: 0,
  accessed_time: 0,
  group: '',
  auto_groups: null,
  cross_group_retry: false,
  group_route_config: JSON.stringify([
    { group: 'primary', priority: 4, cooldown_seconds: 0 },
    { group: 'secondary', priority: 3, cooldown_seconds: 10 },
    { group: 'disabled', priority: 2, cooldown_seconds: 10, enabled: false },
    { group: 'tertiary', priority: 1, cooldown_seconds: 10 },
  ]),
  group_route_sticky: false,
  model_limits_enabled: false,
  model_limits: '',
  allow_ips: '',
}

type ApiMethod = (url: string) => Promise<{ data: unknown }>
const apiClient = api as unknown as { get: ApiMethod }
const originalGet = apiClient.get

function RouteGroupCell() {
  const columns = useApiKeysColumns(Date.now())
  const groupColumn = columns.find(
    (column) => 'accessorKey' in column && column.accessorKey === 'group'
  )
  if (!groupColumn || typeof groupColumn.cell !== 'function') {
    throw new Error('Expected API key group column cell')
  }

  return groupColumn.cell({
    row: {
      original: apiKey,
      getValue: () => apiKey.group,
    },
  } as never)
}

afterEach(() => {
  apiClient.get = originalGet
})

describe('API key group routing summary', () => {
  test('shows the primary enabled group and the actual enabled group count', () => {
    apiClient.get = async (url) => {
      expect(url).toBe('/api/user/self/groups')
      return {
        data: {
          success: true,
          data: {
            primary: { desc: '', ratio: 0.12 },
            secondary: { desc: '', ratio: 0.15 },
            tertiary: { desc: '', ratio: 1 },
            disabled: { desc: '', ratio: 1 },
          },
        },
      }
    }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(['user-groups'], {
      success: true,
      data: {
        primary: { desc: '', ratio: 0.12 },
        secondary: { desc: '', ratio: 0.15 },
        tertiary: { desc: '', ratio: 1 },
        disabled: { desc: '', ratio: 1 },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <TooltipProvider>
            <ApiKeysProvider>
              <RouteGroupCell />
            </ApiKeysProvider>
          </TooltipProvider>
        </I18nextProvider>
      </QueryClientProvider>
    )

    const routingButton = screen.getByRole('button', {
      name: 'Group routing rules',
    })
    expect(routingButton).toHaveTextContent('primary')
    expect(routingButton).toHaveTextContent('0.12x')
    expect(routingButton).toHaveTextContent('3 groups')
    expect(routingButton).not.toHaveTextContent('+')
  })
})
