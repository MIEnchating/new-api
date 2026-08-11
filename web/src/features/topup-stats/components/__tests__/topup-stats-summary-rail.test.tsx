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
import { after, describe, test } from 'node:test'

import { Window } from 'happy-dom'

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

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { TopUpStatsSummaryRail } = await import('../topup-stats-summary-rail')

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
  after(() => domWindow.close())

  test('keeps all eight summaries in one non-wrapping mobile rail', async () => {
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
            summary={{
              order_count: 4,
              user_count: 3,
              total_money: 10,
              invoice_count: 2,
            }}
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
    assert.equal(rail.querySelectorAll('[data-summary-item]').length, 8)
    assert.equal(rail.textContent?.includes('Lottery amount'), true)
    assert.equal(rail.textContent?.includes('Total Quota'), true)
    assert.equal(rail.textContent?.includes('Successful orders'), true)

    await act(async () => root.unmount())
    container.remove()
  })
})
