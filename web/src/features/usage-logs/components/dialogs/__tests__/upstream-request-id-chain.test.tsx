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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

import { usageLogSchema } from '../../../data/schema'
import { DetailsDialog } from '../details-dialog'
import { UpstreamRequestIdChain } from '../execution-trace-dialog'

const i18n = createInstance()
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard'
)
let client: QueryClient
beforeEach(async () => {
  await i18n.init({
    lng: 'en',
    resources: { en, zh },
    interpolation: { escapeValue: false },
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  cleanup()
  client.clear()
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})

function renderWithProviders(children: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </I18nextProvider>
  )
}

const sources = {
  'client-id': 'x-client-request-id',
  'provider-id': 'x-request-id',
}

describe('upstream request ID chain', () => {
  test('shows both response ID sources and copies the raw client correlation ID', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    renderWithProviders(
      <UpstreamRequestIdChain
        requestIds={['client-id', 'provider-id']}
        sources={sources}
      />
    )
    expect(
      screen.getByText('Upstream client correlation ID (X-Client-Request-ID)')
    ).toBeVisible()
    expect(
      screen.getByText('Upstream response request ID (X-Request-ID)')
    ).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy to clipboard: client-id' })
    )
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible()
    expect(writeText).toHaveBeenCalledWith('client-id')
    await act(() => i18n.changeLanguage('zh'))
    expect(
      screen.getByText(
        zh.translation['Upstream client correlation ID (X-Client-Request-ID)']
      )
    ).toBeVisible()
    expect(
      screen.getByText(
        zh.translation['Upstream response request ID (X-Request-ID)']
      )
    ).toBeVisible()
  })

  test('shows up to three request IDs without collapse controls', () => {
    const requestIds = ['request-one', 'request-two', 'request-three']
    renderWithProviders(<UpstreamRequestIdChain requestIds={requestIds} />)
    for (const requestId of requestIds) {
      expect(screen.getByText(requestId)).toBeVisible()
    }
    expect(
      screen.queryByRole('button', { name: 'Expand' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Collapse' })
    ).not.toBeInTheDocument()
  })

  test('summarizes a long chain with the first and final request IDs', () => {
    renderWithProviders(
      <UpstreamRequestIdChain
        requestIds={[
          'request-one',
          'request-two',
          'request-three',
          'request-four',
        ]}
      />
    )
    expect(screen.getByText('request-one')).toBeVisible()
    expect(screen.getByText('request-four')).toBeVisible()
    expect(screen.queryByText('request-two')).not.toBeInTheDocument()
    expect(screen.queryByText('request-three')).not.toBeInTheDocument()
    expect(screen.getByText('+2 more')).toBeVisible()
    expect(
      screen.getAllByRole('button', { name: 'Expand' })[0]
    ).toHaveAttribute('aria-expanded', 'false')
  })

  test('expands the complete chain in order and can collapse it again', () => {
    const requestIds = [
      'request-one',
      'request-two',
      'request-three',
      'request-four',
    ]
    renderWithProviders(
      <UpstreamRequestIdChain
        requestIds={requestIds}
        sources={{ 'request-two': 'x-request-id' }}
      />
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand' })[0])
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    requestIds.forEach((requestId, index) =>
      expect(within(rows[index]).getByText(requestId)).toBeVisible()
    )
    expect(
      screen.getByText('Upstream response request ID (X-Request-ID)')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByText('request-two')).not.toBeInTheDocument()
    expect(screen.getByText('request-four')).toBeVisible()
  })

  test('can collapse to only the first request ID', () => {
    renderWithProviders(
      <UpstreamRequestIdChain
        requestIds={[
          'request-one',
          'request-two',
          'request-three',
          'request-four',
        ]}
        collapsedPreview='first'
      />
    )
    expect(screen.getByText('request-one')).toBeVisible()
    expect(screen.queryByText('request-two')).not.toBeInTheDocument()
    expect(screen.queryByText('request-four')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand' })[0])
    expect(screen.getByText('request-two')).toBeVisible()
    expect(screen.getByText('request-four')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByText('request-two')).not.toBeInTheDocument()
    expect(screen.queryByText('request-four')).not.toBeInTheDocument()
  })
})

describe('log detail request IDs', () => {
  test.each([
    ['client-id', 'Upstream client correlation ID (X-Client-Request-ID)'],
    ['provider-id', 'Upstream response request ID (X-Request-ID)'],
  ])(
    'labels a single %s with its response header source',
    async (requestId, label) => {
      const log = usageLogSchema.parse({
        id: 1,
        user_id: 1,
        created_at: 1,
        type: 5,
        content: '',
        request_id: 'local-id',
        upstream_request_id: requestId,
        other: JSON.stringify({
          admin_info: { upstream_request_id_sources: sources },
        }),
      })
      renderWithProviders(
        <DetailsDialog
          log={log}
          isAdmin
          isRoot={false}
          open
          onOpenChange={() => {}}
        />
      )
      const dialog = within(await screen.findByRole('dialog'))
      expect(dialog.getByText(label, { exact: false })).toBeVisible()
      expect(
        dialog.getByRole('button', { name: `Copy to clipboard: ${requestId}` })
      ).toBeVisible()
      expect(
        dialog.getByRole('button', { name: 'Copy to clipboard: local-id' })
      ).toBeVisible()
    }
  )

  test('retains both upstream IDs while showing the local ID separately', async () => {
    const log = usageLogSchema.parse({
      id: 1,
      user_id: 1,
      created_at: 1,
      type: 5,
      content: '',
      request_id: 'local-id',
      upstream_request_id: 'client-id',
      other: JSON.stringify({
        admin_info: {
          upstream_request_ids: ['local-id', 'client-id', 'provider-id'],
          upstream_request_id_sources: sources,
        },
      }),
    })
    renderWithProviders(
      <DetailsDialog
        log={log}
        isAdmin
        isRoot={false}
        open
        onOpenChange={() => {}}
      />
    )
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getAllByRole('button', { name: 'Expand' })[0])
    expect(
      dialog.getByText('Upstream client correlation ID (X-Client-Request-ID)')
    ).toBeVisible()
    expect(
      dialog.getByText('Upstream response request ID (X-Request-ID)')
    ).toBeVisible()
    expect(
      dialog.getAllByRole('button', { name: 'Copy to clipboard: local-id' })
    ).toHaveLength(1)
    expect(
      dialog.getByRole('button', { name: 'Copy to clipboard: client-id' })
    ).toBeVisible()
    expect(
      dialog.getByRole('button', { name: 'Copy to clipboard: provider-id' })
    ).toBeVisible()
  })
})
