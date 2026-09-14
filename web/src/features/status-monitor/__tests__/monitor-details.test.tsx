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
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { RecentRequestStats } from '@/features/dashboard/types'

import { MonitorDetailsDrawer } from '../monitor-details-drawer'
import { getMonitorRequestStats } from '../monitor-utils'

const emptyWindow = {
  has_data: false,
  request_count: 0,
  success_count: 0,
  failure_count: 0,
  success_rate: 0,
}
const emptyStats: RecentRequestStats = {
  '5m': emptyWindow,
  '30m': emptyWindow,
  '1h': emptyWindow,
}

function renderDetails(stats: RecentRequestStats | null, unavailable = false) {
  return render(
    <MonitorDetailsDrawer
      open
      monitor={{ id: 1, name: 'Primary API', status: -1, uptime: 0 }}
      requestStats={stats}
      requestStatsUnavailable={unavailable}
      onOpenChange={() => {}}
    />
  )
}

describe('monitor request statistics', () => {
  it('a failed statistics load does not claim that requests or a matching group are absent', async () => {
    renderDetails(null, true)
    await waitFor(() =>
      expect(screen.getByText('Request statistics unavailable')).toBeVisible()
    )
    expect(
      screen.queryByText('No request group matches this monitor.')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('No requests recorded in the past hour.')
    ).not.toBeInTheDocument()
  })

  it('an unmatched group explains why request statistics are absent', async () => {
    renderDetails(null)
    await waitFor(() =>
      expect(
        screen.getByText('No request group matches this monitor.')
      ).toBeVisible()
    )
  })

  it('a matched group without samples explains the measured time window', async () => {
    renderDetails(emptyStats)
    await waitFor(() =>
      expect(
        screen.getByText('No requests recorded in the past hour.')
      ).toBeVisible()
    )
  })

  it('matches owned groups by monitor name first and ignores inherited object properties', () => {
    const nameStats = { ...emptyStats }
    const groupStats = { ...emptyStats }
    const stats = {
      ...emptyStats,
      by_group: { 'Primary API': nameStats, Core: groupStats },
    }
    expect(getMonitorRequestStats(stats, ' Primary API ', 'Core')).toBe(
      nameStats
    )
    expect(getMonitorRequestStats(stats, 'Other API', 'Core')).toBe(groupStats)
    expect(getMonitorRequestStats(stats, 'toString', '__proto__')).toBeNull()
    expect(
      getMonitorRequestStats(
        { ...emptyStats, by_group: { ['__proto__']: groupStats } },
        '__proto__'
      )
    ).toBe(groupStats)
  })
})
