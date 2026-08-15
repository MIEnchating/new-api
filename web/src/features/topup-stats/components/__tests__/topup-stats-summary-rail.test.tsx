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
import assert from 'node:assert/strict'

import { Window } from 'happy-dom'
import { afterAll, describe, test } from 'vitest'

const domWindow = new Window()
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Element',
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}
Object.defineProperty(globalThis, 'requestAnimationFrame', {
  configurable: true,
  value: (callback: FrameRequestCallback) => setTimeout(callback, 0),
})
Object.defineProperty(globalThis, 'cancelAnimationFrame', {
  configurable: true,
  value: (handle: number) => clearTimeout(handle),
})

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { TopUpStatsSummaryDialog, TopUpStatsSummaryRail } =
  await import('../topup-stats-summary-rail')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

describe('order management mobile summary rail', () => {
  afterAll(() => domWindow.close())

  test('keeps five quota summaries in one non-wrapping mobile rail', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
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
        </I18nextProvider>
      )
    )

    const rail = container.querySelector<HTMLElement>(
      '[data-mobile-summary-rail]'
    )
    assert.ok(rail)
    assert.equal(rail.classList.contains('overflow-x-auto'), true)
    assert.equal(rail.classList.contains('no-scrollbar'), true)
    assert.equal(rail.querySelectorAll('[data-summary-item]').length, 5)
    assert.equal(rail.textContent?.includes('Lottery amount'), true)
    assert.equal(rail.textContent?.includes('Total Quota'), true)
    assert.equal(rail.textContent?.includes('Successful orders'), false)
    assert.equal(rail.textContent?.includes('Paying users'), false)
    assert.equal(rail.textContent?.includes('Invoiced orders'), false)

    await act(async () => root.unmount())
    container.remove()
  })

  test('shows the daily quota trend chart in the statistics dialog', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <TopUpStatsSummaryDialog
            open
            onOpenChange={() => {}}
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
            dailyStats={[
              {
                date: '2026-08-13',
                online_topup: 100,
                redemption: 20,
                admin_adjustment: 0,
                lottery: 0,
                total: 120,
              },
            ]}
            dailyStatsLoading={false}
            statisticsRange={{ start: new Date(), end: new Date() }}
            onStatisticsRangeChange={() => {}}
          />
        </I18nextProvider>
      )
    )

    assert.ok(document.querySelector('[data-statistics-chart]'))
    assert.ok(document.querySelector('[data-slot="chart"]'))
    assert.equal(document.querySelectorAll('[data-statistics-item]').length, 0)
    assert.match(document.body.textContent || '', /Quota trend/)
    assert.match(document.body.textContent || '', /Daily quota changes/)
    assert.equal(
      document.body.textContent?.includes('Successful orders'),
      false
    )
    assert.equal(document.body.textContent?.includes('Paying users'), false)
    assert.equal(document.body.textContent?.includes('Invoiced orders'), false)

    await act(async () => root.unmount())
    container.remove()
  })
})
