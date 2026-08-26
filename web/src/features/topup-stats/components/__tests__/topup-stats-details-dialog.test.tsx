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

import type { TopUpStatsItem } from '../../types'

const domWindow = new Window()
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'PointerEvent',
  'CustomEvent',
  'MutationObserver',
  'ResizeObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
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
const { TopUpStatsDetailsDialog } =
  await import('../topup-stats-details-dialog')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

const baseItem: TopUpStatsItem = {
  id: 'topup:1',
  type: 'online_topup',
  reference: 'order-1',
  user_id: 1,
  username: 'user',
  display_name: 'User',
  payment_method: 'stripe',
  payment_provider: 'stripe',
  quota: 100,
  money: 1,
  status: 'success',
  created_at: 1,
  invoice_status: 0,
  invoiced_at: 0,
  invoiced_by: 0,
  invoice_returned_at: 0,
  invoice_returned_by: 0,
  invoice_eligible: true,
  excluded_from_stats: false,
}

describe('order management details', () => {
  afterAll(() => domWindow.close())

  test('hides empty operational metadata and shows populated values', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    const renderItem = async (item: TopUpStatsItem) =>
      act(async () =>
        root.render(
          <I18nextProvider i18n={i18n}>
            <TopUpStatsDetailsDialog item={item} onOpenChange={() => {}} />
          </I18nextProvider>
        )
      )

    await renderItem(baseItem)
    assert.equal(
      document.querySelector('[data-detail-label="Operator Admin"]'),
      null
    )
    assert.equal(document.querySelector('[data-detail-label="Details"]'), null)

    await renderItem({
      ...baseItem,
      id: 'billing:1',
      type: 'admin_adjustment',
      operator_user_id: 42,
      detail: ' add ',
    })
    assert.match(
      document.querySelector('[data-detail-label="Operator Admin"]')
        ?.textContent ?? '',
      /#42/
    )
    assert.match(
      document.querySelector('[data-detail-label="Details"]')?.textContent ??
        '',
      /add/
    )

    await act(async () => root.unmount())
    container.remove()
  })
})
