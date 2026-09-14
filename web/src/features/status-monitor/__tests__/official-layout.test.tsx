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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { OfficialProviderStatuses } from '../official-provider-status'
import type { OfficialProviderStatus } from '../types'

const provider: OfficialProviderStatus = {
  provider: 'OpenAI',
  available: true,
  indicator: 'none',
  description: '',
  status_url: 'https://status.openai.com',
  subscribe_url: 'https://status.openai.com/subscribe',
  checked_at: '2026-09-10T10:00:00Z',
  components: [],
  incidents: [],
}

function renderProviders(providers: OfficialProviderStatus[]) {
  return render(
    <OfficialProviderStatuses
      response={{ success: true, data: { providers } }}
      loading={false}
      failed={false}
      compact
    />
  )
}

describe('official status card layout', () => {
  it('keeps the last official status visible during a failed refresh and clears the warning on recovery', () => {
    const response = { success: true, data: { providers: [provider] } }
    const rendered = renderProviders([provider])
    const card = screen.getByRole('article')
    rendered.rerender(
      <OfficialProviderStatuses
        response={response}
        loading
        failed={false}
        compact
      />
    )
    expect(screen.getByRole('article')).toBe(card)
    rendered.rerender(
      <OfficialProviderStatuses
        response={response}
        loading={false}
        failed
        compact
      />
    )
    expect(screen.getByRole('article')).toBe(card)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Refresh failed. Showing the last available data.'
    )
    rendered.rerender(
      <OfficialProviderStatuses
        response={response}
        loading={false}
        failed={false}
        compact
      />
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('article')).toBe(card)
  })

  it('preserves the collapsed component list when provider status changes', async () => {
    const monitoredProvider = {
      ...provider,
      components: [
        { id: 'api', name: 'API', status: 'operational', updated_at: '' },
      ],
    }
    const user = userEvent.setup()
    const rendered = renderProviders([monitoredProvider])
    await user.click(
      screen.getByRole('button', { name: 'Service components 1' })
    )
    rendered.rerender(
      <OfficialProviderStatuses
        response={{
          success: true,
          data: { providers: [{ ...monitoredProvider, indicator: 'major' }] },
        }}
        loading={false}
        failed={false}
        compact
      />
    )
    expect(screen.getByText('Major outage')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Service components 1' })
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('offers retry after the first official status request fails', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    render(
      <OfficialProviderStatuses
        response={null}
        loading={false}
        failed
        onRetry={onRetry}
        compact
      />
    )
    await waitFor(() =>
      expect(screen.getByText('Official status unavailable')).toBeVisible()
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('separates provider identity from footer actions without reserving unused columns', () => {
    renderProviders([provider])
    const card = screen.getByRole('article')
    const heading = within(card).getByRole('heading', { name: 'OpenAI' })
    const link = within(card).getByRole('link', {
      name: 'Open official status page',
    })
    expect(card.parentElement).toHaveClass('grid')
    expect(card.parentElement).not.toHaveClass(
      'md:grid-cols-2',
      'xl:grid-cols-3'
    )
    expect(heading.closest('header')).not.toContainElement(link)
    expect(link.closest('footer')).toContainElement(
      screen.getByText('Official check time')
    )
    expect(link).toHaveAttribute('href', provider.status_url)
    expect(
      within(card).getByRole('link', { name: 'Subscribe to official updates' })
    ).toHaveAttribute('href', provider.subscribe_url)
    expect(screen.getByText('No active incidents')).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Official provider status' })
    ).not.toBeInTheDocument()
  })

  it.each([2, 3])(
    'uses available width for %i providers without an empty desktop column',
    (count) => {
      renderProviders(
        Array.from({ length: count }, (_, index) => ({
          ...provider,
          provider: `Provider ${index}`,
        }))
      )
      const grid = screen.getAllByRole('article')[0].parentElement
      expect(grid).toHaveClass('md:grid-cols-2')
      if (count === 2) expect(grid).not.toHaveClass('xl:grid-cols-3')
      else expect(grid).toHaveClass('xl:grid-cols-3')
    }
  )

  it('shows healthy components alongside affected components, orders affected first, and excludes group containers', () => {
    renderProviders([
      {
        ...provider,
        components: [
          {
            id: 'ads',
            name: 'Ads API',
            status: 'degraded_performance',
            updated_at: '',
          },
          {
            id: 'voice',
            name: 'Voice mode',
            status: 'operational',
            updated_at: '',
          },
          {
            id: 'group',
            name: 'API group',
            group: true,
            status: 'operational',
            updated_at: '',
          },
          {
            id: 'responses',
            name: 'Responses',
            status: 'operational',
            updated_at: '',
          },
          {
            id: 'images',
            name: 'Images',
            status: 'degraded_performance',
            updated_at: '',
          },
        ],
      },
    ])
    const disclosure = screen.getByRole('button', {
      name: 'Service components 2',
    })
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    const healthy = screen.getByText('Responses')
    const affected = screen.getByText('Images')
    expect(healthy).toBeVisible()
    expect(affected).toBeVisible()
    expect(
      affected.compareDocumentPosition(healthy) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.queryByText('API group')).not.toBeInTheDocument()
    expect(screen.queryByText('Ads API')).not.toBeInTheDocument()
    expect(screen.queryByText('Voice mode')).not.toBeInTheDocument()
    expect(screen.queryByText('No active incidents')).not.toBeInTheDocument()
  })

  it('shows Claude API availability without web, console, or desktop components', () => {
    renderProviders([
      {
        ...provider,
        provider: 'Claude',
        components: [
          'claude.ai',
          'Claude Console (platform.claude.com)',
          'Claude API (api.anthropic.com)',
          'Claude Code',
          'Claude Cowork',
          'Claude for Government',
        ].map((name) => ({
          id: name,
          name,
          status: 'operational',
          updated_at: '',
        })),
      },
    ])
    expect(
      screen.getByRole('button', { name: 'Service components 1' })
    ).toBeVisible()
    expect(screen.getByText('Claude API (api.anthropic.com)')).toBeVisible()
    expect(screen.queryByText('claude.ai')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Claude Console (platform.claude.com)')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Claude Code')).not.toBeInTheDocument()
    expect(screen.queryByText('Claude Cowork')).not.toBeInTheDocument()
    expect(screen.queryByText('Claude for Government')).not.toBeInTheDocument()
  })

  it('keeps core OpenAI relay endpoints while excluding unrelated API products', () => {
    const relayComponents = [
      'API',
      'Chat Completions',
      'Responses',
      'Embeddings',
      'Images',
      'Audio',
      'Realtime',
      'Files',
      'Batch',
      'Moderations',
      'Codex API',
    ]
    renderProviders([
      {
        ...provider,
        components: [
          ...relayComponents,
          'Compliance API',
          'Ads API',
          'Codex Web',
          'Login',
          'Fine-tuning',
        ].map((name) => ({
          id: name,
          name,
          status: 'operational',
          updated_at: '',
        })),
      },
    ])
    expect(
      screen.getByRole('button', { name: 'Service components 11' })
    ).toBeVisible()
    for (const name of relayComponents) {
      expect(screen.getByText(name)).toBeVisible()
    }
    for (const name of [
      'Compliance API',
      'Ads API',
      'Codex Web',
      'Login',
      'Fine-tuning',
    ]) {
      expect(screen.queryByText(name)).not.toBeInTheDocument()
    }
  })

  it('keeps official incident warnings when no relevant service components are listed', () => {
    renderProviders([
      {
        ...provider,
        components: [
          {
            id: 'web',
            name: 'ChatGPT',
            status: 'major_outage',
            updated_at: '',
          },
        ],
        incidents: [
          {
            name: 'Elevated errors',
            status: 'investigating',
            impact: 'major',
            message: '',
            updated_at: '',
            url: '',
            components: [],
          },
        ],
      },
    ])
    expect(
      screen.queryByRole('button', { name: /Service components/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Elevated errors' })
    ).toBeVisible()
    expect(screen.getByText('Major outage')).toBeVisible()
    expect(screen.queryByText('No active incidents')).not.toBeInTheDocument()
  })

  it('wraps long incident and component names and keeps component disclosure keyboard accessible', async () => {
    const componentName =
      'API-with-an-unbroken-component-name-that-must-remain-readable'
    const incidentName =
      'Elevated error rates affecting requests across multiple regions'
    const component = {
      id: 'api',
      name: componentName,
      status: 'degraded_performance',
      updated_at: '',
    }
    const user = userEvent.setup()
    renderProviders([
      {
        ...provider,
        indicator: 'minor',
        components: [component],
        incidents: [
          {
            name: incidentName,
            status: 'investigating',
            impact: 'minor',
            message: 'Investigating errors.\nRequests are being retried.',
            updated_at: provider.checked_at,
            url: 'https://status.openai.com/incidents/api',
            components: [component],
          },
        ],
      },
    ])
    expect(screen.getByRole('heading', { name: incidentName })).toHaveClass(
      '[overflow-wrap:anywhere]'
    )
    const incidentToggle = screen.getByRole('button', { name: incidentName })
    expect(incidentToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Investigating errors/)).not.toBeInTheDocument()
    incidentToggle.focus()
    await user.keyboard('{Enter}')
    expect(incidentToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Investigating errors/)).toBeVisible()
    for (const label of screen.getAllByText(componentName)) {
      expect(label).toHaveClass('[overflow-wrap:anywhere]')
      expect(label).not.toHaveClass('truncate')
    }
    expect(screen.getByRole('link', { name: 'View incident' })).toHaveAttribute(
      'href',
      'https://status.openai.com/incidents/api'
    )
    const disclosure = screen.getByRole('button', {
      name: 'Service components 1',
    })
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    disclosure.focus()
    await user.keyboard('{Enter}')
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByText(componentName)).toHaveLength(1)
    await user.keyboard(' ')
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByText(componentName)).toHaveLength(2)
  })

  it('unavailable providers show a single unavailable status and a useful error without a healthy message', () => {
    renderProviders([{ ...provider, available: false, error_code: 'timeout' }])
    expect(screen.getAllByText('Official status unavailable')).toHaveLength(1)
    expect(screen.getByText('Official status request timed out')).toBeVisible()
    expect(screen.queryByText('No active incidents')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Open official status page' })
    ).toBeVisible()
  })

  it('loading placeholders follow the card columns and clip overflow until providers arrive', async () => {
    const rendered = render(
      <OfficialProviderStatuses
        response={null}
        loading
        failed={false}
        compact
      />
    )
    const placeholders = rendered.container.querySelectorAll(
      'section > div > [aria-hidden="true"]'
    )
    expect(placeholders).toHaveLength(3)
    expect(placeholders[0].parentElement).toHaveClass(
      'overflow-clip',
      'md:grid-cols-2',
      'xl:grid-cols-3'
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    rendered.rerender(
      <OfficialProviderStatuses
        response={{ success: true, data: { providers: [] } }}
        loading={false}
        failed={false}
        compact
      />
    )
    await waitFor(() =>
      expect(screen.getByText('Official status unavailable')).toBeVisible()
    )
  })
})
