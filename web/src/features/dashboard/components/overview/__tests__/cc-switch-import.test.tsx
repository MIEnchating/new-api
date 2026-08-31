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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ApiKey } from '@/features/keys/types'
import { api } from '@/lib/api'

vi.mock('@/features/keys/components/dialogs/cc-switch-dialog', () => ({
  CCSwitchDialog: (props: { open: boolean; tokenId: number }) =>
    props.open ? (
      <output data-testid='cc-switch-ready'>{props.tokenId}</output>
    ) : null,
}))

const { CCSwitchImport } = await import('../cc-switch-import')

type ApiMethod = (url: string) => Promise<{ data: unknown }>
type MockableApi = {
  get: ApiMethod
  post: ApiMethod
}

const apiClient = api as unknown as MockableApi
const originalGet = apiClient.get
const originalPost = apiClient.post

function createApiKey(id: number, name: string, status: number): ApiKey {
  return {
    id,
    name,
    status,
    key: `${name}-********`,
    remain_quota: 100,
    used_quota: 0,
    unlimited_quota: false,
    expired_time: -1,
    created_time: 1,
    accessed_time: 0,
    group: 'default',
    auto_groups: null,
    cross_group_retry: false,
    group_route_config: '',
    group_route_sticky: false,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
  }
}

afterEach(() => {
  apiClient.get = originalGet
  apiClient.post = originalPost
})

describe('overview CC Switch API key list', () => {
  test('uses the shared API key import button in compact guides', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CCSwitchImport compact />
      </QueryClientProvider>
    )

    const importButton = screen.getByRole('button', {
      name: 'Import to CC Switch',
    })
    expect(importButton).toHaveTextContent('One-click import')
    expect(importButton).toHaveClass('rounded-lg', 'font-semibold')

    queryClient.clear()
  })

  test('imports an enabled key directly and disables unavailable rows', async () => {
    const keys = [
      createApiKey(1, 'gemini', 1),
      createApiKey(2, 'disabled-key', 2),
    ]
    const requestedUrls: string[] = []
    apiClient.get = async (url) => {
      requestedUrls.push(url)
      return {
        data: {
          success: true,
          data: { items: keys, total: keys.length, page: 1, page_size: 8 },
        },
      }
    }
    apiClient.post = async (url) => {
      expect(url).toBe('/api/token/1/key')
      return { data: { success: true, data: { key: 'resolved-key' } } }
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <CCSwitchImport />
      </QueryClientProvider>
    )

    const overviewImport = screen.getByRole('button', {
      name: 'Import to CC Switch',
    })
    expect(overviewImport).toHaveTextContent('One-click import')
    fireEvent.click(overviewImport)

    expect(await screen.findByText('gemini')).toBeInTheDocument()
    expect(requestedUrls).toEqual(['/api/token/?p=1&size=8'])
    expect(screen.getByText('disabled-key')).toBeInTheDocument()
    expect(screen.getAllByText('API Key').length).toBeGreaterThan(0)

    const enabledImport = screen.getByRole('button', {
      name: 'Import to CC Switch: gemini',
    })
    const disabledImport = screen.getByRole('button', {
      name: 'Import to CC Switch: disabled-key',
    })
    expect(enabledImport).toBeEnabled()
    expect(disabledImport).toBeDisabled()

    fireEvent.click(enabledImport)
    await waitFor(() =>
      expect(screen.getByTestId('cc-switch-ready')).toHaveTextContent('1')
    )
    queryClient.clear()
  })

  test('loads one server page at a time and searches from the first page', async () => {
    const requestedUrls: string[] = []
    apiClient.get = async (url) => {
      requestedUrls.push(url)

      if (url.startsWith('/api/token/search?')) {
        return {
          data: {
            success: true,
            data: {
              items: [createApiKey(10, 'searched-key', 1)],
              total: 1,
              page: 1,
              page_size: 8,
            },
          },
        }
      }

      const isSecondPage = url.includes('p=2')
      return {
        data: {
          success: true,
          data: {
            items: [
              createApiKey(
                isSecondPage ? 9 : 1,
                isSecondPage ? 'page-two-key' : 'page-one-key',
                1
              ),
            ],
            total: 9,
            page: isSecondPage ? 2 : 1,
            page_size: 8,
          },
        },
      }
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <CCSwitchImport />
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Import to CC Switch' }))

    expect(await screen.findByText('page-one-key')).toBeInTheDocument()
    expect(requestedUrls).toEqual(['/api/token/?p=1&size=8'])

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('page-two-key')).toBeInTheDocument()
    expect(requestedUrls).toEqual([
      '/api/token/?p=1&size=8',
      '/api/token/?p=2&size=8',
    ])

    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'searched' },
    })
    expect(await screen.findByText('searched-key')).toBeInTheDocument()
    expect(requestedUrls.at(-1)).toBe(
      '/api/token/search?keyword=%25searched%25&p=1&size=8'
    )
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()

    queryClient.clear()
  })
})
