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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, expect, test, vi } from 'vitest'

import type { SystemStatus } from '@/features/auth/types'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { STATUS_STORAGE_KEY } from '@/lib/status-query'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { ReferralProgramAction } from '../referral-program-action'

afterEach(() => {
  localStorage.removeItem(STATUS_STORAGE_KEY)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

async function renderReferralAction(
  initialPath: string,
  program: NonNullable<SystemStatus['referral_program']>
) {
  const request = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/status') {
      return {
        data: {
          success: true,
          data: { referral_program: program },
        },
      }
    }
    if (url === '/api/user/aff') {
      return { data: { success: true, data: 'invite-code' } }
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    resources: { zh },
  })

  const root = createRootRoute({ component: ReferralProgramAction })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/dashboard/$section' }),
      createRoute({ getParentRoute: () => root, path: '/affiliate' }),
      createRoute({ getParentRoute: () => root, path: '/wallet' }),
    ]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  await router.load()
  const client = new QueryClient()
  const view = render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>
  )

  return {
    i18n,
    router,
    request,
    cleanup() {
      view.unmount()
      client.clear()
    },
  }
}

test('offers the referral link and terms across console pages', async () => {
  const user = userEvent.setup()
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText')
  const { i18n, router, request, cleanup } = await renderReferralAction(
    '/dashboard/overview',
    {
      enabled: true,
      registration_rewards_enabled: true,
      wallet_usage_enabled: true,
      rate_percent: 7.5,
      first_topup_rebate_ratio: 0.125,
      days: 60,
    }
  )

  try {
    const name = '邀请好友赚 7.5%'
    const trigger = await screen.findByRole('button', { name })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(request).not.toHaveBeenCalledWith('/api/user/aff')
    expect(request).not.toHaveBeenCalledWith('/api/user/topup/info')

    trigger.focus()
    await user.keyboard('{Enter}')
    const popup = await screen.findByRole('dialog', {
      name: i18n.t('Referral Program'),
    })
    expect(popup).toHaveClass('max-h-(--available-height)', 'overflow-y-auto')
    const dialog = within(popup)
    expect(dialog.getByText('拉新奖励')).toBeVisible()
    expect(
      dialog.getByText('好友通过链接注册，注册奖励按站点配置发放。')
    ).toBeVisible()
    expect(
      await dialog.findByText(/首笔付费充值按到账额返 12\.5%/)
    ).toBeVisible()
    expect(dialog.getByText(/60 天内.*已结算的余额消费返 7\.5%/)).toBeVisible()
    expect(
      dialog.queryByText('奖励达到最低额度后可转入余额。')
    ).not.toBeInTheDocument()
    await user.click(
      dialog.getByRole('button', { name: i18n.t('Copy referral link') })
    )
    await waitFor(() =>
      expect(clipboard).toHaveBeenCalledWith(
        `${window.location.origin}/sign-up?aff=invite-code`
      )
    )
    await user.keyboard('{Escape}')

    await act(() =>
      router.navigate({
        to: '/dashboard/$section',
        params: { section: 'models' },
      })
    )
    expect(screen.getByRole('button', { name })).toBeVisible()

    await act(() => router.navigate({ to: '/wallet' }))
    expect(screen.getByRole('button', { name })).toBeVisible()
  } finally {
    cleanup()
  }
})

test.each([
  {
    name: 'wallet commission',
    walletUsageEnabled: true,
    firstTopupRebateRatio: 0,
    label: '邀请好友赚 5%',
    activeRule: '余额消费分成',
    hiddenRule: '首充返利',
  },
  {
    name: 'first top-up rebate',
    walletUsageEnabled: false,
    firstTopupRebateRatio: 0.125,
    label: '推荐计划',
    activeRule: '首充返利',
    hiddenRule: '余额消费分成',
  },
])(
  'shows only $name on the referral page when it is the sole reward',
  async (scenario) => {
    const user = userEvent.setup()
    const { i18n, cleanup } = await renderReferralAction('/affiliate', {
      enabled: true,
      registration_rewards_enabled: false,
      wallet_usage_enabled: scenario.walletUsageEnabled,
      first_topup_rebate_ratio: scenario.firstTopupRebateRatio,
      rate_percent: 5,
      days: 60,
    })

    try {
      await user.click(
        await screen.findByRole('button', { name: scenario.label })
      )
      const popup = await screen.findByRole('dialog', {
        name: i18n.t('Referral Program'),
      })
      expect(within(popup).getByText(scenario.activeRule)).toBeVisible()
      expect(within(popup).queryByText('拉新奖励')).not.toBeInTheDocument()
      expect(
        within(popup).queryByText('好友通过链接注册，注册奖励按站点配置发放。')
      ).not.toBeInTheDocument()
      expect(
        within(popup).queryByText(scenario.hiddenRule)
      ).not.toBeInTheDocument()
    } finally {
      cleanup()
    }
  }
)
