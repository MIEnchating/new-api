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
import { describe, expect, it } from 'vitest'

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
