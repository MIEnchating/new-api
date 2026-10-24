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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CacheMonitor } from '../cache-monitor'
import { ChannelTrend } from '../channel-trend'
import type { CacheMetricsResponse, MonitorHealth } from '../types'

function cacheResponse(): CacheMetricsResponse {
  const health: MonitorHealth = {
    overall: 'healthy',
    error_rate: 'healthy',
    ttft: 'healthy',
    cache: 'unknown',
    score: 100,
    error_rate_percent: 0,
    avg_ttft_ms: 1000,
  }
  return {
    success: true,
    data: {
      start_ts: 0,
      end_ts: 10800,
      bucket_seconds: 3600,
      baseline: 85,
      available_groups: ['Primary', 'Backup'],
      display_groups: ['Primary', 'Backup'],
      all_groups: true,
      counts_visible: false,
      summary: {
        health,
        has_data: false,
        cache_hit_rate: 0,
        series: [{ ts: 3600, health, has_data: false, cache_hit_rate: 0 }],
      },
      groups: [
        {
          group: 'Primary',
          health,
          has_data: false,
          cached_tokens: 0,
          cache_hit_rate: 0,
          avg_tps: 0,
          series: [
            {
              ts: 3600,
              health,
              has_data: false,
              cached_tokens: 0,
              cache_hit_rate: 0,
              avg_tps: 0,
            },
          ],
        },
      ],
    },
  }
}

function renderMonitor(response = cacheResponse(), failed = false) {
  return render(
    <CacheMonitor
      response={response}
      loading={false}
      failed={failed}
      onRefresh={vi.fn()}
    />
  )
}

describe('channel monitoring overview', () => {
  it('failed refresh keeps previous metrics and explicitly marks them as outdated', () => {
    renderMonitor(cacheResponse(), true)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Refresh failed. Showing the last available data.'
    )
    expect(
      within(screen.getByRole('article', { name: 'Success rate' })).getByText(
        '100.0%'
      )
    ).toBeVisible()
  })

  it('mobile metrics stay in one compact row above a scrollable group matrix', () => {
    renderMonitor()
    const metric = screen.getByRole('article', { name: 'Success rate' })
    expect(metric.parentElement).toHaveClass('grid-cols-3')
    expect(metric.closest('section')).toHaveClass(
      '[@media(max-height:700px)]:overflow-y-auto'
    )
    expect(
      screen.getByRole('tablist', { name: 'View' }).closest('[data-slot=tabs]')
    ).toHaveClass('[@media(max-height:700px)]:min-h-[28rem]')
    const matrix = screen.getByRole('region', { name: 'Availability trends' })
    expect(matrix).toHaveClass('overflow-auto', 'min-h-0')
    expect(matrix).not.toContainElement(metric)
    expect(
      screen.getByRole('table', { name: 'Channel health' })
    ).not.toHaveClass('lg:min-w-[800px]')
    expect(
      screen.getByText(
        'Each row is a monitored group. Each block is a time interval; hover or focus for details.'
      )
    ).toHaveClass('sm:block')
    expect(screen.getByText('Reset zoom')).toHaveClass(
      '@min-[60rem]/trends:not-sr-only'
    )
    expect(screen.getByText('Time to first token')).toHaveClass(
      'sr-only',
      'sm:not-sr-only'
    )
    const header = screen
      .getByRole('columnheader', { name: 'Success rate' })
      .closest('[role=row]')
    expect(header).not.toHaveClass('sticky')
    expect(header).toHaveClass('@min-[48rem]:sticky')
  })

  it('narrow layouts wrap the search and timeline controls and label each group metric', () => {
    renderMonitor()
    const search = screen.getByRole('searchbox', { name: 'Search groups...' })
    const toolbar = search.closest('[data-monitor-toolbar]')
    expect(toolbar).toHaveClass('flex-wrap')
    const zoom = screen.getByRole('group', { name: 'Zoom' })
    expect(toolbar).toContainElement(zoom)
    expect(zoom.parentElement).toHaveClass('w-full', 'sm:w-auto')
    const row = screen
      .getByRole('cell', { name: /Primary/ })
      .closest('[role=row]')
    expect(row).not.toBeNull()
    for (const label of ['Success rate', 'Average TTFT', 'Cache rate']) {
      expect(within(row as HTMLElement).getByText(label)).toHaveClass(
        '@min-[48rem]:hidden'
      )
    }
  })

  it('an unmatched group search offers a clear action that restores the configured groups', async () => {
    renderMonitor()
    const user = userEvent.setup()
    await user.type(
      screen.getByRole('searchbox', { name: 'Search groups...' }),
      'missing'
    )
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(
      screen.getByRole('searchbox', { name: 'Search groups...' })
    ).toHaveValue('')
    expect(screen.getByRole('cell', { name: /Primary/ })).toBeVisible()
    expect(screen.getByRole('cell', { name: /Backup/ })).toBeVisible()
  })

  it('groups with requests but no cache samples retain success and latency while cache stays unknown', () => {
    renderMonitor()
    expect(
      within(screen.getByRole('article', { name: 'Cache rate' })).getByText(
        '--'
      )
    ).toBeVisible()
    const row = screen
      .getByRole('cell', { name: /Primary/ })
      .closest<HTMLElement>('[role=row]')
    if (!row) throw new Error('Primary group row is missing')
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual([
      'Primary',
      'Success rate100.0%',
      'Average TTFT1.0 s',
      'Cache rate--',
      '',
    ])
    expect(
      within(row).getByRole('img', { name: /Health score: 100/ })
    ).toHaveAccessibleName(/Success rate: 100.0%/)
  })

  it('search filters group names and clearing an unmatched search restores configured empty groups', async () => {
    renderMonitor()
    const user = userEvent.setup()
    const search = screen.getByRole('searchbox', { name: 'Search groups...' })
    await user.type(search, ' primary ')
    expect(screen.getByRole('cell', { name: /Primary/ })).toBeVisible()
    expect(
      screen.queryByRole('cell', { name: /Backup/ })
    ).not.toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'missing')
    expect(screen.getByText('No results found')).toBeVisible()
    await user.clear(search)
    expect(screen.getByRole('cell', { name: /Backup/ })).toBeVisible()
  })

  it('ordinary wheel scrolling never changes the time window and keyboard controls can navigate older intervals', async () => {
    renderMonitor()
    const user = userEvent.setup()
    const row = screen
      .getByRole('cell', { name: /Primary/ })
      .closest<HTMLElement>('[role=row]')
    if (!row) throw new Error('Primary group row is missing')
    const pulses = within(row).getAllByRole('cell')[4]
    expect(within(pulses).getAllByRole('img')).toHaveLength(4)
    const wheel = new WheelEvent('wheel', {
      deltaY: -100,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(pulses, wheel)
    expect(wheel.defaultPrevented).toBe(false)
    expect(within(pulses).getAllByRole('img')).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(
      within(pulses).queryByRole('img', { name: /Health score: 100/ })
    ).not.toBeInTheDocument()
    const earlier = screen.getByRole('button', { name: 'Earlier intervals' })
    earlier.focus()
    await user.keyboard('{Enter}')
    expect(
      within(pulses).getByRole('img', { name: /Health score: 100/ })
    ).toBeVisible()
    expect(earlier).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Later intervals' }))
    expect(
      within(pulses).queryByRole('img', { name: /Health score: 100/ })
    ).not.toBeInTheDocument()
  })

  it('line chart reports no data when every metric is missing', async () => {
    render(
      <ChannelTrend
        points={[{ ts: 0, has_data: false, cache_hit_rate: null }]}
      />
    )
    await waitFor(() =>
      expect(screen.getByText('No data or insufficient samples')).toBeVisible()
    )
  })

  it('line chart legend wraps with explicit units and preserves a readable plot height', () => {
    const summary = cacheResponse().data.summary
    if (!summary?.series) throw new Error('Summary series fixture is missing')
    render(<ChannelTrend points={summary.series} />)
    const chart = screen.getByRole('region', { name: 'Overall channel trend' })
    expect(chart).toHaveClass('min-h-96', 'flex-col')
    expect(within(chart).getByRole('group')).toHaveClass('flex-wrap')
    expect(
      within(chart).getByRole('button', { name: 'Cache rate' })
    ).toHaveTextContent('%')
    expect(
      within(chart).getByRole('button', { name: 'Health score' })
    ).toHaveTextContent('/100')
    expect(
      within(chart).getByRole('button', { name: 'Average TTFT' })
    ).toHaveTextContent('s')
    expect(chart.querySelector('[data-slot=chart]')).toHaveClass('min-h-64')
  })

  it('line chart legend hides and restores a series with pointer and keyboard input', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 640, 360)
    )
    const series = cacheResponse().data.summary?.series
    if (!series) throw new Error('Summary series fixture is missing')
    const points = [3600, 7200].map((ts) => ({
      ...series[0],
      ts,
      has_data: true,
      cache_hit_rate: 85,
    }))
    render(<ChannelTrend points={points} />)
    const user = userEvent.setup()
    const cache = screen.getByRole('button', { name: 'Cache rate' })
    const chart = screen.getByRole('region', { name: 'Overall channel trend' })
    await waitFor(() =>
      expect(chart.querySelectorAll('.recharts-line-curve')).toHaveLength(4)
    )
    await user.click(cache)
    expect(cache).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() =>
      expect(chart.querySelectorAll('.recharts-line-curve')).toHaveLength(3)
    )
    cache.focus()
    await user.keyboard(' ')
    expect(cache).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() =>
      expect(chart.querySelectorAll('.recharts-line-curve')).toHaveLength(4)
    )
  })

  it('line chart keeps one metric selected and reports missing data for that selection', async () => {
    const summary = cacheResponse().data.summary
    if (!summary?.series) throw new Error('Summary series fixture is missing')
    render(<ChannelTrend points={summary.series} />)
    const user = userEvent.setup()
    for (const name of ['Success rate', 'Health score', 'Average TTFT']) {
      await user.click(screen.getByRole('button', { name }))
    }
    const cache = screen.getByRole('button', { name: 'Cache rate' })
    expect(cache).toBeDisabled()
    expect(cache).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('No data or insufficient samples')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Success rate' }))
    expect(cache).not.toBeDisabled()
    expect(
      screen.queryByText('No data or insufficient samples')
    ).not.toBeInTheDocument()
  })

  it('line chart keeps error-only intervals even when no cache requests were recorded', async () => {
    const response = cacheResponse()
    const summary = response.data.summary
    if (!summary) throw new Error('Summary fixture is missing')
    summary.series = [
      {
        ts: 3600,
        health: {
          ...summary.health,
          overall: 'critical',
          score: 0,
          error_rate_percent: 100,
          avg_ttft_ms: null,
        },
        has_data: false,
        cache_hit_rate: 0,
      },
    ]
    renderMonitor(response)
    await userEvent
      .setup()
      .click(screen.getByRole('tab', { name: 'Line chart' }))
    const chart = screen.getByRole('region', { name: 'Overall channel trend' })
    expect(chart).toBeVisible()
    expect(
      within(chart).queryByText('No data or insufficient samples')
    ).not.toBeInTheDocument()
  })

  it('fine-grained buckets use bounded spacing so the pulse row can shrink on mobile', () => {
    const response = cacheResponse()
    response.data.bucket_seconds = 300
    response.data.end_ts = 28_500
    response.data.display_groups = ['Primary']
    renderMonitor(response)
    const row = screen
      .getByRole('cell', { name: /Primary/ })
      .closest<HTMLElement>('[role=row]')
    if (!row) throw new Error('Primary group row is missing')
    const pulses = within(row).getAllByRole('cell')[4]
    expect(pulses.style.columnGap).toBe('min(2px, 0.2604166666666667%)')
  })
})
