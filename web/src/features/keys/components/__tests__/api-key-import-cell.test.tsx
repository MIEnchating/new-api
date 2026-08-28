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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import { api } from '@/lib/api'

import type { ApiKey } from '../../types'
import { ApiKeyCell } from '../api-keys-cells'
import { ApiKeysProvider, useApiKeys } from '../api-keys-provider'

type ApiMethod = (url: string) => Promise<{ data: unknown }>
type MockableApi = { post: ApiMethod }

const apiClient = api as unknown as MockableApi
const originalPost = apiClient.post

const apiKey: ApiKey = {
  id: 7,
  name: 'gemini',
  status: 1,
  key: 'masked-key',
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

function StateProbe() {
  const { open, currentRow, resolvedKey } = useApiKeys()
  return (
    <output data-testid='import-state'>
      {open}|{currentRow?.id}|{resolvedKey}
    </output>
  )
}

afterEach(() => {
  apiClient.post = originalPost
})

describe('API key table import action', () => {
  test('resolves the key and opens CC Switch from the key cell', async () => {
    apiClient.post = async (url) => {
      expect(url).toBe('/api/token/7/key')
      return { data: { success: true, data: { key: 'resolved-key' } } }
    }

    render(
      <ApiKeysProvider>
        <ApiKeyCell apiKey={apiKey} />
        <StateProbe />
      </ApiKeysProvider>
    )

    const importButton = screen.getByRole('button', {
      name: 'Import to CC Switch',
    })
    expect(importButton).toHaveTextContent('One-click import')
    fireEvent.click(importButton)

    await waitFor(() =>
      expect(screen.getByTestId('import-state')).toHaveTextContent(
        'cc-switch|7|sk-resolved-key'
      )
    )
  })
})
