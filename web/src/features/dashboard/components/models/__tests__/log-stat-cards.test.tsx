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
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { LogStatCards } from '../log-stat-cards'

describe('model log statistics', () => {
  it('shows separate cache totals without adding them again to total tokens', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            created_at: 3600,
            token_used: 100,
            cache_read_tokens: 20,
            cache_creation_tokens: 5,
          },
          {
            created_at: 7200,
            token_used: 200,
            cache_read_tokens: 40,
            cache_creation_tokens: 10,
          },
          { created_at: 10800, token_used: 50 },
        ],
      },
    })
    render(<LogStatCards />)
    const read = screen.getByRole('group', { name: 'Cache Read' })
    const write = screen.getByRole('group', { name: 'Cache Write' })
    expect(read.getAttribute('aria-busy')).toBe('true')
    await waitFor(() => expect(read.getAttribute('aria-busy')).toBe('false'))
    expect(within(read).getByTitle('60').textContent).toBe('60')
    expect(within(write).getByTitle('15').textContent).toBe('15')
    expect(
      within(screen.getByRole('group', { name: 'Total Tokens' })).getByTitle(
        '350'
      ).textContent
    ).toBe('350')
    expect(screen.getAllByRole('group')).toHaveLength(7)
    expect(
      screen.getByText(
        'Cache usage is recorded only after the upgrade; historical data is not backfilled.'
      )
    ).toBeTruthy()
  })

  it('uses zero for historical rows and ignores invalid cache counters', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: [
          { created_at: 3600, token_used: 100 },
          {
            created_at: 7200,
            cache_read_tokens: -20,
            cache_creation_tokens: Number.NaN,
          },
          {
            created_at: 10800,
            cache_read_tokens: Number.POSITIVE_INFINITY,
          },
        ],
      },
    })
    render(<LogStatCards />)
    const read = screen.getByRole('group', { name: 'Cache Read' })
    await waitFor(() => expect(read.getAttribute('aria-busy')).toBe('false'))
    expect(within(read).getByTitle('0').textContent).toBe('0')
    expect(
      within(screen.getByRole('group', { name: 'Cache Write' })).getByTitle('0')
        .textContent
    ).toBe('0')
  })

  it('shows unavailable cache values when the statistics request fails', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('statistics unavailable'))
    render(<LogStatCards />)
    const read = screen.getByRole('group', { name: 'Cache Read' })
    await waitFor(() => expect(read.getAttribute('aria-busy')).toBe('false'))
    expect(within(read).getByText('--')).toBeTruthy()
    expect(
      within(screen.getByRole('group', { name: 'Cache Write' })).getByText('--')
    ).toBeTruthy()
  })
})
