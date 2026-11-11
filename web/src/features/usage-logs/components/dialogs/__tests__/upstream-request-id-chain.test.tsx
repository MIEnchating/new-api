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
import {
  ExecutionTraceDialog,
  UpstreamRequestChain,
  UpstreamRequestIdChain,
} from '../execution-trace-dialog'

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

  test('inline chains align long IDs with the detail value and omit the nested title', () => {
    const requestId = `upstream-request-${'a'.repeat(128)}`
    renderWithProviders(
      <UpstreamRequestIdChain requestIds={[requestId, 'next-request']} inline />
    )
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    const id = screen.getByText(requestId)
    expect(id).toHaveClass('min-w-0', 'break-all')
    const row = screen.getAllByRole('listitem')[0]
    expect(row).toHaveClass('flex', 'min-w-0', 'items-start')
    expect(within(row).queryByText('1.')).not.toBeInTheDocument()
    const copy = within(row).getByRole('button', {
      name: `Copy to clipboard: ${requestId}`,
    })
    expect(copy.parentElement).toBe(id.parentElement)
    expect(copy).toHaveClass('shrink-0')
  })

  test('empty chains take no space and a single ID needs no expand control', () => {
    const view = renderWithProviders(<UpstreamRequestIdChain requestIds={[]} />)
    expect(view.container).toBeEmptyDOMElement()
    view.unmount()
    renderWithProviders(
      <UpstreamRequestIdChain requestIds={['only-request']} />
    )
    expect(screen.getByText('only-request')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Expand' })
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
    const toggle = screen.getByRole('button', { name: 'Expand' })
    toggle.focus()
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Collapse' })).toHaveFocus()
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
    expect(dialog.getAllByText('Upstream Request ID Chain')).toHaveLength(1)
    fireEvent.click(dialog.getByRole('button', { name: 'Expand' }))
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

const attempts = [
  {
    attempt: 1,
    channel_id: 177,
    channel_type: 'sub2api',
    nodes: [
      {
        id: 'client-id',
        source: 'x-client-request-id',
        service: 'sub2api',
        role: 'client_correlation',
      },
      {
        id: 'provider-id',
        source: 'x-request-id',
        service: 'sub2api-upstream',
        role: 'provider_request',
      },
    ],
  },
  {
    attempt: 2,
    channel_id: 177,
    channel_type: 'sub2api',
    nodes: [
      {
        id: 'provider-id',
        source: 'x-request-id',
        service: 'upstream',
        role: 'upstream_request',
      },
    ],
  },
  { attempt: 3, channel_id: 178, channel_type: 'sub2api', nodes: [] },
]

describe('structured upstream request chain', () => {
  test('groups repeated IDs by attempt, labels roles, and keeps empty attempts', async () => {
    renderWithProviders(
      <UpstreamRequestChain attempts={attempts} requestIds={['legacy-id']} />
    )
    expect(screen.queryByText('legacy-id')).not.toBeInTheDocument()
    const first = screen.getByRole('group', { name: 'Attempt 1 · Channel 177' })
    expect(
      within(first).getByText('Sub2API client correlation ID')
    ).toBeVisible()
    expect(
      within(first).getByText('Sub2API upstream provider request ID')
    ).toBeVisible()
    const rows = within(first).getAllByRole('listitem')
    expect(within(rows[0]).getByText('client-id')).toBeVisible()
    expect(within(rows[1]).getByText('provider-id')).toBeVisible()
    const second = screen.getByRole('group', {
      name: 'Attempt 2 · Channel 177',
    })
    expect(
      within(second).getByText('Upstream response request ID (X-Request-ID)')
    ).toBeVisible()
    expect(screen.getAllByText('provider-id')).toHaveLength(2)
    expect(
      within(
        screen.getByRole('group', { name: 'Attempt 3 · Channel 178' })
      ).getByText('No upstream request ID recorded')
    ).toBeVisible()
    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    expect(screen.getByText('Sub2API 客户端关联 ID')).toBeVisible()
  })

  test('execution trace displays the structured chain from its log', async () => {
    client.setQueryData(['channel-execution-trace', 'local-id'], {
      success: true,
      data: {
        request_id: 'local-id',
        status: 'success',
        events: [],
        channel_ids: [177],
      },
    })
    renderWithProviders(
      <ExecutionTraceDialog
        requestId='local-id'
        upstreamRequestChain={attempts}
        upstreamRequestIds={['legacy-id']}
        open
        onOpenChange={() => {}}
      />
    )
    const dialog = within(await screen.findByRole('dialog'))
    expect(
      dialog.getByRole('group', { name: 'Attempt 1 · Channel 177' })
    ).toBeVisible()
    expect(dialog.getByText('Sub2API client correlation ID')).toBeVisible()
    expect(dialog.queryByText('legacy-id')).not.toBeInTheDocument()
  })

  test('falls back to historical IDs when no structured attempts exist', () => {
    renderWithProviders(
      <UpstreamRequestChain
        attempts={[]}
        requestIds={['legacy-id']}
        sources={{ 'legacy-id': 'x-request-id' }}
      />
    )
    expect(screen.getByText('legacy-id')).toBeVisible()
    expect(
      screen.getByText('Upstream response request ID (X-Request-ID)')
    ).toBeVisible()
  })

  test('log details prefer attempt groups and keep the local ID separate', async () => {
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
          upstream_request_ids: ['client-id', 'provider-id'],
          upstream_request_chain: attempts,
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
    expect(
      dialog.getByRole('group', { name: 'Attempt 1 · Channel 177' })
    ).toBeVisible()
    expect(
      dialog.getAllByRole('button', { name: 'Copy to clipboard: local-id' })
    ).toHaveLength(1)
    expect(
      dialog.getAllByRole('button', { name: 'Copy to clipboard: client-id' })
    ).toHaveLength(1)
  })
})
