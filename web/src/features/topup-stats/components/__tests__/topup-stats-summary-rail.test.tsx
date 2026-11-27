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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import {
  TopUpStatsSummaryDialog,
  TopUpStatsSummaryRail,
} from '../topup-stats-summary-rail'

const statisticsRange = {
  start: new Date(2026, 7, 7, 0),
  end: new Date(2026, 7, 13, 23),
}
const dailyStats = [
  {
    date: '2026-08-13',
    online_topup: 100,
    redemption: 20,
    admin_adjustment: 0,
    lottery: 0,
    total: 120,
  },
]

describe('order management mobile summary rail', () => {
  test('keeps five quota summaries in one non-wrapping mobile rail', () => {
    const { container } = render(
      <TopUpStatsSummaryRail
        typeQuotas={{
          online_topup: 100,
          redemption: 200,
          affiliate_transfer: 0,
          admin_adjustment: 300,
          lottery_reward: 80,
          lottery_reversal: -20,
        }}
        lotteryQuota={60}
        totalQuota={540}
        loading={false}
      />
    )

    const rail = container.querySelector<HTMLElement>(
      '[data-mobile-summary-rail]'
    )
    expect(rail).toHaveClass('overflow-x-auto', 'no-scrollbar')
    expect(rail?.querySelectorAll('[data-summary-item]')).toHaveLength(5)
    expect(screen.getByText('Lottery amount')).toBeVisible()
    expect(screen.getByText('Total Quota')).toBeVisible()
    expect(screen.queryByText('Successful orders')).toBeNull()
    expect(screen.queryByText('Paying users')).toBeNull()
    expect(screen.queryByText('Invoiced orders')).toBeNull()
    const valueTones = [
      ...container.querySelectorAll<HTMLElement>('[data-summary-value]'),
    ].map((value) =>
      [...value.classList].find((className) => className.startsWith('text-'))
    )
    expect(valueTones).toEqual([
      'text-success',
      'text-chart-2',
      'text-warning',
      'text-chart-5',
      'text-primary',
    ])
  })
})

describe('order management statistics dialog', () => {
  test('keeps the header outside the scrollable chart body and stacks the date controls on narrow screens', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const measure = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains('recharts-responsive-container')) {
          return new DOMRect(0, 0, 320, 256)
        }
        return measure.call(this)
      }
    )
    render(
      <TopUpStatsSummaryDialog
        open
        onOpenChange={onOpenChange}
        dailyStats={dailyStats}
        dailyStatsLoading={false}
        dailyStatsError={false}
        onRetry={() => {}}
        statisticsRange={statisticsRange}
        onStatisticsRangeChange={() => {}}
      />
    )

    const dialog = screen.getByRole('dialog', { name: 'Top-up Stats' })
    const chartRegion = within(dialog).getByRole('region', {
      name: 'Daily quota changes',
    })
    const scrollBody = chartRegion.closest('[data-slot="dialog-body"]')
    expect(scrollBody).toHaveClass('overflow-y-auto')
    expect(scrollBody).not.toContainElement(
      within(dialog).getByRole('button', { name: 'Close' })
    )
    expect(within(chartRegion).getByRole('heading').parentElement).toHaveClass(
      'flex-col',
      'sm:flex-row',
      'sm:flex-wrap'
    )
    const dateRange = within(chartRegion).getByRole('button', {
      name: /2026-08-07.*2026-08-13/,
    })
    expect(dateRange).toHaveClass('h-auto', '[&>span]:whitespace-normal')
    const legend = await within(chartRegion).findByText('Total Quota')
    expect(
      legend.closest('.recharts-legend-wrapper')?.firstElementChild
    ).toHaveClass('flex-wrap')
    expect(
      chartRegion.querySelector('.recharts-line-dots circle')
    ).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
  })

  test('distinguishes loading, empty, and failed date ranges and lets the user retry', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const props = {
      open: true,
      onOpenChange: () => {},
      dailyStats: [],
      statisticsRange,
      onStatisticsRangeChange: () => {},
      onRetry,
    }
    const { rerender } = render(
      <TopUpStatsSummaryDialog
        {...props}
        dailyStatsLoading
        dailyStatsError={false}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Loading...')
    expect(screen.queryByText('No data available')).toBeNull()

    rerender(
      <TopUpStatsSummaryDialog
        {...props}
        dailyStatsLoading={false}
        dailyStatsError={false}
      />
    )
    expect(screen.getByText('No data available')).toBeVisible()

    rerender(
      <TopUpStatsSummaryDialog
        {...props}
        dailyStatsLoading={false}
        dailyStatsError
      />
    )
    expect(screen.getByText('Failed to load top-up stats')).toBeVisible()
    expect(screen.queryByText('No data available')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
