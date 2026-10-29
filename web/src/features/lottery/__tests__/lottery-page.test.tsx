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
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

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
const { DEFAULT_CURRENCY_CONFIG, useSystemConfigStore } =
  await import('@/stores/system-config-store')
const { Lottery } = await import('..')
const { LotterySettingsDialog } = await import('../lottery-settings-dialog')

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
  afterEach(() => {
    useSystemConfigStore.getState().setConfig({
      currency: { ...DEFAULT_CURRENCY_CONFIG },
    })
  })

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
      container.querySelectorAll('[data-lottery-grid-cell="true"]').length,
      9
    )
    assert.equal(
      [...mysteryBoxes].every((box) => box.disabled),
      true
    )
    assert.equal(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="lottery-draw-button"]'
      )?.disabled,
      true
    )
    assert.match(container.textContent || '', /every \$50 spent/)
    assert.match(container.textContent || '', /Spend \$20 in a single day/)
    assert.ok(container.querySelector('[data-testid="lottery-mystery-card"]'))
    const rulesGrid = container.querySelector(
      '[data-testid="lottery-rules-grid"]'
    )
    assert.ok(rulesGrid)
    expect(rulesGrid.classList.contains('sm:grid-cols-2')).toBe(true)
    const overview = container.querySelector('[data-testid="lottery-overview"]')
    expect(
      overview?.classList.contains(
        'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]'
      )
    ).toBe(true)
    expect(
      container.querySelector(
        '[role="progressbar"][aria-label="Weekly spending"]'
      )
    ).not.toBeNull()
    expect(
      container.querySelector('[role="progressbar"][aria-label="Today spent"]')
    ).not.toBeNull()
    const history = container.querySelector('table')
    expect(history?.getAttribute('aria-label')).toBe('Lottery records')
    expect(history?.parentElement?.classList.contains('overflow-x-auto')).toBe(
      true
    )
    const grid = container.querySelector(
      '[role="group"][aria-label="Mystery gifts"]'
    )
    expect(grid?.classList.contains('grid-cols-3')).toBe(true)
    expect(grid?.classList.contains('max-w-xs')).toBe(true)
    expect(
      container
        .querySelector('[data-testid="lottery-draw-button"]')
        ?.getAttribute('aria-label')
    ).toBe('Draw now')
    const streak = container.querySelector(
      '[data-testid="lottery-current-streak"]'
    )
    assert.equal(streak?.textContent?.replaceAll(/\s/g, ''), '1day')
    assert.doesNotMatch(container.textContent || '', /1 days/)
    expect(container.textContent).toContain('No lottery chances available')
    const drawLabel = container.querySelector(
      '[data-testid="lottery-draw-button"] span.whitespace-normal'
    )
    expect(drawLabel).not.toBeNull()
    assert.doesNotMatch(container.textContent || '', /1 Yuan|5 Yuan|8 Yuan/)
    assert.ok(
      container.querySelector('[data-testid="lottery-records-pagination"]')
    )

    await act(async () => root.unmount())
  })

  test('converts USD earning thresholds to site currency and updates after a currency change', async () => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'CNY',
        usdExchangeRate: 7,
      },
    })
    api.defaults.adapter = async (config) => ({
      data: {
        success: true,
        data: config.url?.includes('/draws/self')
          ? { items: [], total: 0, page: 1, page_size: 10 }
          : {
              ...baseStatus,
              active_grant_rules: [
                {
                  id: 'recharge',
                  type: 'recharge',
                  name: 'Recharge offer',
                  threshold: 50,
                  chances: 1,
                  enabled: true,
                  start_at: 0,
                  end_at: 0,
                },
              ],
            },
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
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

    assert.match(container.textContent || '', /every ¥350 spent/)
    assert.match(container.textContent || '', /Spend ¥140 in a single day/)
    assert.match(container.textContent || '', /Recharge threshold:\s*¥350/)

    await act(async () => {
      useSystemConfigStore.getState().setConfig({
        currency: { ...DEFAULT_CURRENCY_CONFIG },
      })
    })
    assert.match(container.textContent || '', /every \$50 spent/)
    assert.match(container.textContent || '', /Spend \$20 in a single day/)
    assert.match(container.textContent || '', /Recharge threshold:\s*\$50/)
    await act(async () => root.unmount())
  })

  test('labels prize amounts as USD even when the site displays CNY', async () => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'CNY',
        usdExchangeRate: 7,
      },
    })
    api.defaults.adapter = async (config) => ({
      data: config.url?.endsWith('/config')
        ? {
            success: true,
            data: {
              rules: {
                weekly_spend_amount: 50,
                weekly_chance_limit: 5,
                daily_active_amount: 20,
                streak_rewards: [],
              },
              prizes: [
                {
                  type: 'quota_1',
                  name: '1 元额度',
                  amount: 1,
                  probability: 50,
                },
                { type: 'none', name: 'No prize', amount: 0, probability: 50 },
              ],
              grant_rules: [],
            },
          }
        : { success: true, data: baseStatus },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <LotterySettingsDialog
            open
            onOpenChange={() => {}}
            onSaved={() => {}}
          />
        </I18nextProvider>
      )
      await flushRequests()
    })
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog)
    assert.match(dialog.textContent || '', /USD/)
    assert.doesNotMatch(dialog.textContent || '', /Yuan/)
    assert.equal(dialog.querySelector('input')?.value, '1 USD')
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
    const drawButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="lottery-draw-button"]'
    )
    assert.ok(drawButton)
    assert.equal(drawButton.disabled, false)

    await act(async () => {
      drawButton.dispatchEvent(
        new domWindow.MouseEvent('click', {
          bubbles: true,
        }) as unknown as MouseEvent
      )
      await flushRequests()
    })

    assert.equal(drawRequested, true)
    assert.equal(drawButton.disabled, true)
    assert.equal(drawButton.dataset.state, 'drawing')
    const drawProgress = container.querySelector(
      '[data-testid="lottery-draw-progress"]'
    )
    assert.ok(drawProgress)
    expect(
      drawProgress.closest('[role="status"]')?.getAttribute('aria-live')
    ).toBe('polite')
    assert.match(drawProgress.textContent || '', /Drawing/)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2450))
    })

    assert.ok(
      container.querySelector(
        '[data-lottery-grid-cell="true"][data-state="revealed"]'
      )
    )
    assert.equal(
      container.querySelector('[data-testid="lottery-draw-progress"]'),
      null
    )
    assert.match(container.textContent || '', /Won/)
    assert.match(container.textContent || '', /\$5/)

    await act(async () => root.unmount())
  })

  test.each([10, 100])(
    'draws %i times with one request and shows every result',
    async (count) => {
      const draws = Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        prize: 'quota_1',
        quota: 500_000,
        status: 'awarded',
        revoked_at: 0,
        created_at: 1_786_363_200,
      }))
      const requests: unknown[] = []
      api.defaults.adapter = async (config) => {
        let data: unknown = { ...baseStatus, available_chances: count }
        if (config.url?.includes('/draws/self')) {
          data = { items: [], total: 0, page: 1, page_size: 10 }
        } else if (config.url?.endsWith('/draw')) {
          requests.push(JSON.parse(config.data))
          data = {
            draw: draws.at(-1),
            draws,
            status: { ...baseStatus, recent_draws: draws.slice(-10).reverse() },
          }
        }
        return {
          data: { success: true, data },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      }
      let reveal: (() => void) | undefined
      const originalTimeout = window.setTimeout.bind(window)
      const timerSpy = vi
        .spyOn(window, 'setTimeout')
        .mockImplementation((callback, delay, ...args) => {
          if (delay !== undefined && delay > 2000 && delay <= 2400) {
            reveal = callback as () => void
            return 0 as unknown as ReturnType<typeof window.setTimeout>
          }
          return originalTimeout(
            callback,
            delay,
            ...args
          ) as unknown as ReturnType<typeof window.setTimeout>
        })
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      try {
        await act(async () => {
          root.render(
            <I18nextProvider i18n={i18n}>
              <Lottery />
            </I18nextProvider>
          )
          await flushRequests()
        })
        const button = container.querySelector<HTMLButtonElement>(
          `[data-testid="lottery-draw-${count}"]`
        )
        assert.ok(button)
        assert.equal(button.disabled, false)
        if (count === 10) {
          expect(
            container.querySelector<HTMLButtonElement>(
              '[data-testid="lottery-draw-100"]'
            )?.disabled
          ).toBe(true)
        }
        await act(async () => {
          button.click()
          button.click()
          await flushRequests()
        })
        expect(requests).toEqual([{ count }])
        expect(button.disabled).toBe(true)
        assert.ok(reveal)
        await act(async () => reveal?.())
        const dialog = document.querySelector('[role="dialog"]')
        assert.ok(dialog)
        expect(dialog.textContent).toContain('Batch draw results')
        expect(dialog.textContent).toContain(`Completed ${count} draws`)
        expect(dialog.textContent).toContain(`$${count}`)
        expect(
          dialog.querySelectorAll('[data-testid="lottery-batch-result"]').length
        ).toBe(count)
        expect(button.disabled).toBe(true)
      } finally {
        await act(async () => root.unmount())
        timerSpy.mockRestore()
        container.remove()
      }
    }
  )

  test.each(['business', 'network'])(
    'allows another batch attempt after a %s failure without showing rewards',
    async (failure) => {
      let drawRequests = 0
      api.defaults.adapter = async (config) => {
        if (config.url?.endsWith('/draw')) {
          drawRequests++
          if (failure === 'network') throw new Error('Network error')
          return {
            data: { success: false, message: 'Not enough lottery chances' },
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          }
        }
        const data = config.url?.includes('/draws/self')
          ? { items: [], total: 0, page: 1, page_size: 10 }
          : { ...baseStatus, available_chances: 10 }
        return {
          data: { success: true, data },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      }
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      try {
        await act(async () => {
          root.render(
            <I18nextProvider i18n={i18n}>
              <Lottery />
            </I18nextProvider>
          )
          await flushRequests()
        })
        const button = container.querySelector<HTMLButtonElement>(
          '[data-testid="lottery-draw-10"]'
        )
        assert.ok(button)
        await act(async () => {
          button.click()
          await flushRequests()
        })
        expect(drawRequests).toBe(1)
        expect(button.disabled).toBe(false)
        expect(
          container.querySelector('[data-testid="lottery-draw-progress"]')
        ).toBeNull()
        expect(document.querySelector('[role="dialog"]')).toBeNull()
        expect(container.textContent).not.toContain('Completed 10 draws')
        await act(async () => {
          button.click()
          await flushRequests()
        })
        expect(drawRequests).toBe(2)
      } finally {
        await act(async () => root.unmount())
        container.remove()
      }
    }
  )

  test('lets administrators manage draws and inspect chance grants', async () => {
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'admin',
      role: 10,
    })
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'CNY',
        usdExchangeRate: 7,
      },
    })
    let resolveAllRecords: (() => void) | null = null
    let delayAllRecords = true
    let latestAdminUrl = ''
    let latestGrantUrl = ''
    let grantLoadCount = 0
    const manualGrantBodies: Record<string, unknown>[] = []
    let revokeRequested = false
    const dailyRechargeRule = {
      id: 'daily-recharge-repair',
      type: 'recharge',
      name: 'Daily recharge',
      enabled: true,
      threshold: 50,
      limit: 'daily',
      reclaim: false,
      chances: 2,
      start_at: 1_780_000_000,
      end_at: 1_820_000_000,
    } as const
    api.defaults.adapter = async (config) => {
      let data: unknown = {
        success: true,
        data: {
          ...baseStatus,
          grant_rules: [dailyRechargeRule],
          active_grant_rules: [dailyRechargeRule],
        },
      }
      if (config.url?.includes('/revoke')) {
        revokeRequested = true
        data = { success: true, data: null }
      } else if (config.url?.includes('/draws/self')) {
        data = {
          success: true,
          data: { items: [], total: 0, page: 1, page_size: 10 },
        }
      } else if (config.url === '/api/user/lottery/grants/manual') {
        manualGrantBodies.push(
          typeof config.data === 'string'
            ? JSON.parse(config.data)
            : config.data
        )
        data = {
          success: true,
          data: {
            id: 32,
            user_id: 27,
            username: 'draw-user',
            type: 'manual',
            source_name: 'Manual grant',
            event_reference: 'manual:1:test-request',
            chances: 2,
            consumed: 0,
            expires_at: 0,
            created_at: 1_786_363_300,
            operator_user_id: 1,
            detail: 'repair missed recharge grant',
          },
        }
      } else if (config.url?.startsWith('/api/user/lottery/grants?')) {
        grantLoadCount += 1
        latestGrantUrl = config.url
        data = {
          success: true,
          data: {
            items: [
              {
                id: 31,
                user_id: 27,
                username: 'draw-user',
                type: 'recharge_summer',
                source_name: 'Summer recharge',
                event_reference: 'recharge:summer:topup:88',
                chances: 3,
                consumed: 1,
                expires_at: 0,
                created_at: 1_786_363_200,
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
          },
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
    const lotteryDialog = document.querySelector('[role="dialog"]')
    assert.match(lotteryDialog?.textContent || '', /USD/)
    assert.doesNotMatch(lotteryDialog?.textContent || '', /Yuan/)
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

    const grantRecordsButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Chance grant records')
    )
    assert.ok(grantRecordsButton)
    await act(async () => {
      grantRecordsButton.dispatchEvent(
        new domWindow.MouseEvent('click', {
          bubbles: true,
        }) as unknown as MouseEvent
      )
      await flushRequests()
    })
    assert.match(container.textContent || '', /Summer recharge/)
    assert.match(container.textContent || '', /1\s*\/\s*2/)
    assert.match(container.textContent || '', /Never expires/)
    assert.equal(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Source"]')
        ?.textContent?.trim(),
      'All sources'
    )
    assert.equal(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Status"]')
        ?.textContent?.trim(),
      'All statuses'
    )

    const manualGrantButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Manual grant')
    )
    assert.ok(manualGrantButton)
    await act(async () => {
      manualGrantButton.dispatchEvent(
        new domWindow.MouseEvent('click', {
          bubbles: true,
        }) as unknown as MouseEvent
      )
    })
    const manualUserInput = document.querySelector<HTMLInputElement>(
      '#lottery-manual-grant-user'
    )
    const manualChancesInput = document.querySelector<HTMLInputElement>(
      '#lottery-manual-grant-chances'
    )
    const manualReasonInput = document.querySelector<HTMLTextAreaElement>(
      '#lottery-manual-grant-reason'
    )
    const linkRechargeCheckbox = document.querySelector<HTMLElement>(
      '#lottery-manual-grant-link-recharge'
    )
    assert.ok(manualUserInput)
    assert.ok(manualChancesInput)
    assert.ok(manualReasonInput)
    assert.ok(linkRechargeCheckbox)
    await act(async () => {
      linkRechargeCheckbox.dispatchEvent(
        new domWindow.MouseEvent('click', {
          bubbles: true,
        }) as unknown as MouseEvent
      )
    })
    const rechargeDateInput = document.querySelector<HTMLInputElement>(
      '#lottery-manual-grant-recharge-date'
    )
    assert.ok(rechargeDateInput)
    assert.equal(manualChancesInput.disabled, true)
    await act(async () => {
      const inputValueSetter = Object.getOwnPropertyDescriptor(
        domWindow.HTMLInputElement.prototype,
        'value'
      )?.set
      const textareaValueSetter = Object.getOwnPropertyDescriptor(
        domWindow.HTMLTextAreaElement.prototype,
        'value'
      )?.set
      assert.ok(inputValueSetter)
      assert.ok(textareaValueSetter)
      inputValueSetter.call(manualUserInput, 'draw-user')
      manualUserInput.dispatchEvent(
        new domWindow.Event('input', { bubbles: true }) as unknown as Event
      )
      inputValueSetter.call(rechargeDateInput, '2026-09-03')
      rechargeDateInput.dispatchEvent(
        new domWindow.Event('input', { bubbles: true }) as unknown as Event
      )
      textareaValueSetter.call(
        manualReasonInput,
        'repair missed recharge grant'
      )
      manualReasonInput.dispatchEvent(
        new domWindow.Event('input', { bubbles: true }) as unknown as Event
      )
    })
    const grantButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Grant'
    )
    assert.ok(grantButton)
    await act(async () => {
      grantButton.dispatchEvent(
        new domWindow.MouseEvent('click', {
          bubbles: true,
        }) as unknown as MouseEvent
      )
      await flushRequests()
    })
    const manualGrantBody = manualGrantBodies.at(-1)
    assert.ok(manualGrantBody)
    assert.equal(manualGrantBody.user, 'draw-user')
    assert.equal(manualGrantBody.chances, 2)
    assert.equal(manualGrantBody.reason, 'repair missed recharge grant')
    assert.equal(manualGrantBody.expires_at, 0)
    assert.equal(manualGrantBody.recharge_rule_id, dailyRechargeRule.id)
    assert.equal(manualGrantBody.recharge_date, '2026-09-03')
    assert.equal(typeof manualGrantBody.request_id, 'string')
    assert.ok(grantLoadCount >= 2)

    const grantUserInput = container.querySelector<HTMLInputElement>(
      '[data-testid="lottery-grant-user-search"]'
    )
    assert.ok(grantUserInput)
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        domWindow.HTMLInputElement.prototype,
        'value'
      )?.set
      assert.ok(valueSetter)
      valueSetter.call(grantUserInput, 'draw-user')
      grantUserInput.dispatchEvent(
        new domWindow.Event('input', { bubbles: true }) as unknown as Event
      )
    })
    const grantSearchButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Search')
    )
    assert.ok(grantSearchButton)
    await act(async () => {
      grantSearchButton.dispatchEvent(
        new domWindow.MouseEvent('click', {
          bubbles: true,
        }) as unknown as MouseEvent
      )
      await flushRequests()
    })
    assert.match(latestGrantUrl, /user=draw-user/)

    await act(async () => root.unmount())
  })
})
