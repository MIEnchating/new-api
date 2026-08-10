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
import { after, test } from 'node:test'

import { Window } from 'happy-dom'

import zh from '@/i18n/locales/zh.json'

const domWindow = new Window({ url: 'https://example.com/affiliate' })
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Element',
  'Image',
  'MouseEvent',
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
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { api } = await import('@/lib/api')
const { useAuthStore } = await import('@/stores/auth-store')
const { Affiliate } = await import('..')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'zh',
  resources: { zh },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

async function flushRequests() {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

test('renders a translated referral summary and empty income state', async () => {
  document.body.replaceChildren()
  useAuthStore.getState().auth.setUser(null)
  api.defaults.adapter = async (config) => {
    let data: unknown = { success: true, data: null }
    if (config.url === '/api/user/self') {
      data = {
        success: true,
        data: { aff_quota: 750000, aff_history_quota: 1250000, aff_count: 2 },
      }
    } else if (config.url === '/api/user/aff') {
      data = { success: true, data: 'invite-code' }
    } else if (config.url?.startsWith('/api/user/aff/rewards')) {
      data = { success: true, data: { items: [], total: 0 } }
    } else if (config.url === '/api/user/topup/info') {
      data = {
        success: true,
        data: {
          pay_methods: [],
          stripe_min_topup: 0,
          amount_options: [],
          discount: {},
          creem_products: [],
          waffo_pay_methods: [],
          payment_compliance_confirmed: true,
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <Affiliate />
        </I18nextProvider>
      </QueryClientProvider>
    )
    await flushRequests()
  })

  assert.ok(container.querySelector('[data-testid="affiliate-summary"]'))
  assert.match(container.textContent || '', /可转余额/)
  assert.match(container.textContent || '', /累计收入/)
  assert.match(container.textContent || '', /邀请人数/)
  assert.match(container.textContent || '', /邀请记录/)
  assert.match(container.textContent || '', /暂无邀请记录/)
  assert.ok(
    container.querySelector('[data-testid="affiliate-records-pagination"]')
  )
  assert.doesNotMatch(container.textContent || '', /No records/)

  await act(async () => root.unmount())
})

test('keeps the current records visible while an administrator loads and searches all records', async () => {
  document.body.replaceChildren()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 10 })
  let resolveFirstAdminRequest: (() => void) | null = null
  let adminRequestCount = 0
  let latestAdminUrl = ''
  api.defaults.adapter = async (config) => {
    let data: unknown = { success: true, data: null }
    if (config.url === '/api/user/self') {
      data = {
        success: true,
        data: { aff_quota: 0, aff_history_quota: 0, aff_count: 1 },
      }
    } else if (config.url === '/api/user/aff') {
      data = { success: true, data: 'invite-code' }
    } else if (config.url?.startsWith('/api/user/aff/rewards/all')) {
      adminRequestCount += 1
      latestAdminUrl = config.url
      if (adminRequestCount === 1) {
        await new Promise<void>((resolve) => {
          resolveFirstAdminRequest = resolve
        })
      }
      data = {
        success: true,
        data: {
          items: [
            {
              id: 2,
              type: 'first_topup',
              quota: 500000,
              inviter_id: 11,
              inviter_username: 'alice',
              invitee_id: 22,
              invitee_username: 'bob',
              created_at: 1_786_363_200,
            },
          ],
          total: 1,
          page: 1,
          page_size: 10,
        },
      }
    } else if (config.url?.startsWith('/api/user/aff/rewards')) {
      data = {
        success: true,
        data: {
          items: [
            {
              id: 1,
              type: 'registration',
              quota: 100000,
              invitee_display: '****21',
              created_at: 1_786_363_100,
            },
          ],
          total: 1,
          page: 1,
          page_size: 10,
        },
      }
    } else if (config.url === '/api/user/topup/info') {
      data = {
        success: true,
        data: {
          pay_methods: [],
          stripe_min_topup: 0,
          amount_options: [],
          discount: {},
          creem_products: [],
          waffo_pay_methods: [],
          payment_compliance_confirmed: true,
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <Affiliate />
        </I18nextProvider>
      </QueryClientProvider>
    )
    await flushRequests()
  })
  assert.match(container.textContent || '', /用户 \*\*\*\*21/)

  const allRecordsButton = [...container.querySelectorAll('button')].find(
    (button) => button.textContent?.includes('全部记录')
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

  assert.match(container.textContent || '', /用户 \*\*\*\*21/)
  assert.equal(
    container.querySelector('[data-testid="affiliate-records-skeleton"]'),
    null
  )

  await act(async () => {
    resolveFirstAdminRequest?.()
    await flushRequests()
  })
  assert.match(container.textContent || '', /alice/)
  assert.match(container.textContent || '', /bob/)
  const rewardTypeTrigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="类型"]'
  )
  assert.equal(rewardTypeTrigger?.textContent?.trim(), '全部奖励类型')

  const inviterInput = container.querySelector<HTMLInputElement>(
    '[data-testid="affiliate-inviter-search"]'
  )
  const inviteeInput = container.querySelector<HTMLInputElement>(
    '[data-testid="affiliate-invitee-search"]'
  )
  assert.ok(inviterInput)
  assert.ok(inviteeInput)
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      domWindow.HTMLInputElement.prototype,
      'value'
    )?.set
    assert.ok(valueSetter)
    valueSetter.call(inviterInput, 'alice')
    inviterInput.dispatchEvent(
      new domWindow.Event('input', { bubbles: true }) as unknown as Event
    )
    valueSetter.call(inviteeInput, '22')
    inviteeInput.dispatchEvent(
      new domWindow.Event('input', { bubbles: true }) as unknown as Event
    )
  })
  const searchButton = [...container.querySelectorAll('button')].find(
    (button) => button.textContent?.includes('搜索')
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
  assert.match(latestAdminUrl, /inviter=alice/)
  assert.match(latestAdminUrl, /invitee=22/)

  await act(async () => root.unmount())
})

after(() => domWindow.close())
