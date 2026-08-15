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
import { afterAll, beforeEach, describe, test } from 'vitest'

const domWindow = new Window()
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Element',
  'MouseEvent',
  'MutationObserver',
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}
Object.defineProperty(domWindow, 'matchMedia', {
  configurable: true,
  value: () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }),
})
Object.defineProperty(globalThis, 'getComputedStyle', {
  configurable: true,
  value: domWindow.getComputedStyle.bind(domWindow),
})
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
const { api } = await import('@/lib/api')
const { useAuthStore } = await import('@/stores/auth-store')
const { Lottery } = await import('..')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

const baseStatus = {
  available_chances: 0,
  weekly_spend_quota: 0,
  weekly_target_quota: 25_000_000,
  weekly_earned_chances: 0,
  weekly_chance_limit: 5,
  today_spend_quota: 0,
  daily_active_quota: 10_000_000,
  today_active: false,
  current_streak: 1,
  prizes: [
    { type: 'quota_1', amount: 1, probability: 50 },
    { type: 'quota_5', amount: 5, probability: 20 },
    { type: 'quota_8', amount: 8, probability: 5 },
    { type: 'none', amount: 0, probability: 25 },
  ],
  recent_draws: [],
  recent_activity: [],
} as const

async function flushRequests() {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('lottery center', () => {
  afterAll(() => domWindow.close())

  beforeEach(() => {
    document.body.replaceChildren()
    useAuthStore.getState().auth.setUser(null)
  })

  test('disables drawing when no chance is available', async () => {
    api.defaults.adapter = async (config) => {
      const data = config.url?.includes('/draws/self')
        ? {
            success: true,
            data: { items: [], total: 0, page: 1, page_size: 10 },
          }
        : { success: true, data: baseStatus }
      return {
        data,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <Lottery />
        </I18nextProvider>
      )
      await flushRequests()
    })

    const mysteryBoxes = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="lottery-mystery-box"]'
    )
    assert.equal(mysteryBoxes.length, 3)
    assert.equal(
      [...mysteryBoxes].every((box) => box.disabled),
      true
    )
    assert.match(container.textContent || '', /50\.00 Yuan/)
    assert.match(container.textContent || '', /20\.00 Yuan/)
    assert.ok(container.querySelector('[data-testid="lottery-mystery-card"]'))
    const rulesGrid = container.querySelector(
      '[data-testid="lottery-rules-grid"]'
    )
    assert.ok(rulesGrid)
    assert.equal(rulesGrid.classList.contains('xl:grid-cols-2'), true)
    const streak = container.querySelector(
      '[data-testid="lottery-current-streak"]'
    )
    assert.equal(streak?.textContent?.replaceAll(/\s/g, ''), '1day')
    assert.doesNotMatch(container.textContent || '', /1 days/)
    assert.doesNotMatch(container.textContent || '', /1 Yuan|5 Yuan|8 Yuan/)
    assert.ok(
      container.querySelector('[data-testid="lottery-records-pagination"]')
    )

    await act(async () => root.unmount())
  })

  test('updates the remaining chance and result after a successful draw', async () => {
    let drawRequested = false
    api.defaults.adapter = async (config) => {
      if (config.url?.endsWith('/draw')) {
        drawRequested = true
        return {
          data: {
            success: true,
            data: {
              draw: {
                id: 9,
                prize: 'quota_5',
                quota: 2_500_000,
                status: 'awarded',
                revoked_at: 0,
                created_at: 1_786_363_200,
              },
              status: {
                ...baseStatus,
                recent_draws: [
                  {
                    id: 9,
                    prize: 'quota_5',
                    quota: 2_500_000,
                    status: 'awarded',
                    revoked_at: 0,
                    created_at: 1_786_363_200,
                  },
                ],
              },
            },
          },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      }
      if (config.url?.includes('/draws/self')) {
        return {
          data: {
            success: true,
            data: { items: [], total: 0, page: 1, page_size: 10 },
          },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      }
      return {
        data: {
          success: true,
          data: { ...baseStatus, available_chances: 1 },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <Lottery />
        </I18nextProvider>
      )
      await flushRequests()
    })
    const mysteryBoxes = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="lottery-mystery-box"]'
    )
    assert.equal(mysteryBoxes.length, 3)
    const selectedBox = mysteryBoxes[1]
    assert.equal(selectedBox.disabled, false)

    await act(async () => {
      selectedBox.dispatchEvent(
        new domWindow.MouseEvent('click', {
          bubbles: true,
        }) as unknown as MouseEvent
      )
      await flushRequests()
    })

    assert.equal(drawRequested, true)
    assert.equal(selectedBox.disabled, true)
    assert.equal(selectedBox.dataset.state, 'drawing')

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1150))
    })

    assert.equal(selectedBox.dataset.state, 'revealed')
    assert.match(container.textContent || '', /Won/)
    assert.match(container.textContent || '', /\$5/)

    await act(async () => root.unmount())
  })

  test('lets administrators configure prizes and view all draw records', async () => {
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'admin',
      role: 10,
    })
    let resolveAllRecords: (() => void) | null = null
    let delayAllRecords = true
    let latestAdminUrl = ''
    let revokeRequested = false
    api.defaults.adapter = async (config) => {
      let data: unknown = { success: true, data: baseStatus }
      if (config.url?.includes('/revoke')) {
        revokeRequested = true
        data = { success: true, data: null }
      } else if (config.url?.includes('/draws/self')) {
        data = {
          success: true,
          data: { items: [], total: 0, page: 1, page_size: 10 },
        }
      } else if (config.url?.startsWith('/api/user/lottery/draws?')) {
        latestAdminUrl = config.url
        if (delayAllRecords) {
          await new Promise<void>((resolve) => {
            resolveAllRecords = resolve
          })
          delayAllRecords = false
        }
        data = {
          success: true,
          data: {
            items: [
              {
                id: 18,
                user_id: 27,
                username: 'draw-user',
                prize: 'quota_5',
                quota: 2_500_000,
                status: 'awarded',
                event_reference: 'lottery-draw:test-reference',
                revoked_at: 0,
                revoked_by: 0,
                revoke_reason: '',
                created_at: 1_786_363_200,
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
          },
        }
      }
      return {
        data,
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <Lottery />
        </I18nextProvider>
      )
      await flushRequests()
    })

    const settingsButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Lottery settings')
    )
    assert.ok(settingsButton)
    await act(async () => {
      settingsButton.dispatchEvent(
        new domWindow.MouseEvent('click', {
          bubbles: true,
        }) as unknown as MouseEvent
      )
    })
    assert.equal(
      document.querySelectorAll('[data-testid="lottery-prize-setting-row"]')
        .length,
      4
    )
    const cancelButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Cancel')
    )
    assert.ok(cancelButton)
    await act(async () => {
      cancelButton.dispatchEvent(
        new domWindow.MouseEvent('click', {
          bubbles: true,
        }) as unknown as MouseEvent
      )
      await flushRequests()
    })

    const allRecordsButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('All records')
    )
    assert.ok(allRecordsButton)
    await act(async () => {
      allRecordsButton.dispatchEvent(
        new domWindow.MouseEvent('click', {
          bubbles: true,
        }) as unknown as MouseEvent
      )
      await flushRequests()
    })
    assert.match(container.textContent || '', /No lottery results yet/)
    assert.equal(
      container.querySelector('[data-testid="lottery-records-skeleton"]'),
      null
    )
    await act(async () => {
      resolveAllRecords?.()
      await flushRequests()
    })
    assert.match(container.textContent || '', /draw-user/)
    assert.match(container.textContent || '', /ID: 27/)
    const resultTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Result"]'
    )
    assert.equal(resultTrigger?.textContent?.trim(), 'All results')

    const userInput = container.querySelector<HTMLInputElement>(
      '[data-testid="lottery-user-search"]'
    )
    assert.ok(userInput)
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        domWindow.HTMLInputElement.prototype,
        'value'
      )?.set
      assert.ok(valueSetter)
      valueSetter.call(userInput, 'draw-user')
      userInput.dispatchEvent(
        new domWindow.Event('input', { bubbles: true }) as unknown as Event
      )
    })
    const searchButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Search')
    )
    assert.ok(searchButton)
    await act(async () => {
      searchButton.dispatchEvent(
        new domWindow.MouseEvent('click', {
          bubbles: true,
        }) as unknown as MouseEvent
      )
      await flushRequests()
    })
    assert.match(latestAdminUrl, /user=draw-user/)

    const reverseButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Reverse reward')
    )
    assert.ok(reverseButton)
    await act(async () => {
      reverseButton.dispatchEvent(
        new domWindow.MouseEvent('click', {
          bubbles: true,
        }) as unknown as MouseEvent
      )
    })
    const reasonInput = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Reason"]'
    )
    assert.ok(reasonInput)
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        domWindow.HTMLTextAreaElement.prototype,
        'value'
      )?.set
      assert.ok(valueSetter)
      valueSetter.call(reasonInput, 'fraud review')
      reasonInput.dispatchEvent(
        new domWindow.Event('input', { bubbles: true }) as unknown as Event
      )
    })
    const confirmButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Confirm reversal')
    )
    assert.ok(confirmButton)
    await act(async () => {
      confirmButton.dispatchEvent(
        new domWindow.MouseEvent('click', {
          bubbles: true,
        }) as unknown as MouseEvent
      )
      await flushRequests()
    })
    assert.equal(revokeRequested, true)

    await act(async () => root.unmount())
  })
})
