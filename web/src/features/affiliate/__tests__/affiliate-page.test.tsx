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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter } from 'axios'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { STATUS_STORAGE_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { Affiliate } from '..'

const i18n = createInstance()
const originalAdapter = api.defaults.adapter
const rewardsPath = '/api/user/aff/rewards'

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    resources: { zh },
  })
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  useAuthStore.getState().auth.setUser(null)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  localStorage.removeItem(STATUS_STORAGE_KEY)
})

function renderAffiliate(
  getRewards: (url: URL) => unknown,
  rebateRatio = 0.2,
  walletUsageEnabled = true
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const adapter: AxiosAdapter = async (config) => {
    const url = new URL(config.url ?? '', 'https://example.com')
    let data: unknown
    if (url.pathname === '/api/status') {
      data = {
        referral_program: {
          enabled: true,
          rate_percent: 5,
          wallet_usage_enabled: walletUsageEnabled,
          first_topup_rebate_ratio: rebateRatio,
          days: 60,
        },
      }
    } else if (url.pathname === '/api/user/self') {
      data = { aff_quota: 750000, aff_history_quota: 1250000, aff_count: 2 }
    } else if (url.pathname === '/api/user/aff') {
      data = 'invite-code'
    } else if (url.pathname === '/api/user/topup/info') {
      data = { payment_compliance_confirmed: true }
    } else if (url.pathname.startsWith(rewardsPath)) {
      data = await getRewards(url)
    }
    return {
      data: { success: true, data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  api.defaults.adapter = adapter
  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <Affiliate />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

test('shows the renamed program, its rules and the referral summary', async () => {
  renderAffiliate(() => ({ items: [], total: 0 }))

  expect(screen.getByRole('heading', { name: '推荐计划' })).toBeVisible()
  expect(await screen.findByText('首充返利')).toBeVisible()
  expect(await screen.findByText(/首笔付费充值按到账额返 20%/)).toBeVisible()
  expect(screen.getByText(/60 天内.*已结算的余额消费返 5%/)).toBeVisible()
  expect(
    screen.queryByText('奖励达到最低额度后可转入余额。')
  ).not.toBeInTheDocument()

  const summary = screen.getByRole('group', {
    name: i18n.t('Referral Program'),
  })
  expect(summary).toHaveClass('grid-cols-2', 'md:grid-cols-3')
  expect(within(summary).getByText('可转余额')).toBeVisible()
  expect(within(summary).getByText('累计收入')).toBeVisible()
  expect(within(summary).getByText('邀请人数')).toBeVisible()
  const transfer = within(summary).getByRole('button', {
    name: i18n.t('Transfer to Balance'),
  })
  expect(transfer.closest('[data-slot="card"]')).toHaveClass(
    'col-span-2',
    'md:row-span-2'
  )
  await waitFor(() => expect(transfer).toBeEnabled())
  const referralLink = await within(summary).findByRole('textbox', {
    name: i18n.t('Referral link'),
  })
  await waitFor(() =>
    expect(referralLink).toHaveProperty(
      'value',
      expect.stringContaining('?aff=invite-code')
    )
  )
  expect(
    within(summary).getByRole('button', { name: i18n.t('Copy referral link') })
  ).toHaveClass('sm:w-auto', 'whitespace-normal')
})

test('hides acquisition rules when all acquisition rewards are off', async () => {
  renderAffiliate(() => ({ items: [], total: 0 }), 0)

  expect(await screen.findByText('余额消费分成')).toBeVisible()
  expect(screen.queryByText('拉新奖励')).not.toBeInTheDocument()
  expect(
    screen.queryByText('好友通过链接注册，注册奖励按站点配置发放。')
  ).not.toBeInTheDocument()
  expect(screen.queryByText(/首充返利/)).not.toBeInTheDocument()
})

test('hides wallet commission rules when the switch is off', async () => {
  renderAffiliate(() => ({ items: [], total: 0 }), 0.2, false)

  expect(await screen.findByText('首充返利')).toBeVisible()
  expect(screen.queryByText('拉新奖励')).not.toBeInTheDocument()
  expect(screen.queryByText('余额消费分成')).not.toBeInTheDocument()
})

test('opens history from the page header with the keyboard and restores focus on Escape', async () => {
  const getRewards = vi.fn(() => ({ items: [], total: 0 }))
  renderAffiliate(getRewards)
  const user = userEvent.setup()
  const name = i18n.t('Invitation History')
  const trigger = screen.getByRole('button', { name })
  expect(trigger.closest('header')).toContainElement(
    screen.getByRole('heading', { name: i18n.t('Referral Program') })
  )
  expect(trigger).toHaveClass('ms-auto')
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('table', { name })).not.toBeInTheDocument()
  await screen.findByRole('textbox', { name: i18n.t('Referral link') })
  expect(getRewards).not.toHaveBeenCalled()

  trigger.focus()
  await user.keyboard('{Enter}')

  const dialog = within(await screen.findByRole('dialog', { name }))
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(dialog.getByRole('table', { name }).parentElement).toHaveClass(
    'overflow-x-auto'
  )
  expect(
    await dialog.findByText(i18n.t('No invitation records yet'))
  ).toBeVisible()
  expect(
    dialog.queryByRole('tab', { name: i18n.t('All records') })
  ).not.toBeInTheDocument()
  expect(dialog.getByRole('button', { name: i18n.t('Next') })).toBeDisabled()

  await user.keyboard('{Escape}')

  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name })).not.toBeInTheDocument()
  )
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

test('preserves visible records while an administrator switches scope and can paginate and filter all records', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 10 })
  let finishFirstAdminRequest: (() => void) | undefined
  const firstAdminRequest = new Promise<void>((resolve) => {
    finishFirstAdminRequest = resolve
  })
  const getRewards = vi.fn(async (url: URL) => {
    if (url.pathname === rewardsPath) {
      return {
        items: [
          {
            id: 1,
            type: 'registration',
            quota: 100000,
            invitee_display: 'i****e',
            created_at: 1_786_363_100,
          },
        ],
        total: 1,
      }
    }
    await firstAdminRequest
    const onSecondPage = url.searchParams.get('p') === '2'
    return {
      items: [
        {
          id: 2,
          type: 'wallet_usage',
          quota: 500000,
          inviter_id: 11,
          inviter_username: 'alice',
          invitee_id: 22,
          invitee_username: onSecondPage ? 'david' : 'bob',
          created_at: 1_786_363_200,
        },
      ],
      total: 11,
    }
  })
  renderAffiliate(getRewards)
  const user = userEvent.setup()
  const name = i18n.t('Invitation History')
  await user.click(screen.getByRole('button', { name }))
  const dialog = within(await screen.findByRole('dialog', { name }))
  expect(await dialog.findByText('i****e')).toBeVisible()

  const allRecords = dialog.getByRole('tab', { name: i18n.t('All records') })
  await user.click(allRecords)
  expect(allRecords).toHaveAttribute('aria-selected', 'true')
  expect(dialog.getByText('i****e')).toBeVisible()
  finishFirstAdminRequest?.()

  expect(await dialog.findByText('bob')).toBeVisible()
  expect(dialog.getByText('alice')).toBeVisible()
  expect(dialog.getByText(i18n.t('Wallet usage commission'))).toBeVisible()
  const rewardType = dialog.getByRole('combobox', { name: i18n.t('Type') })
  expect(rewardType).toHaveTextContent(i18n.t('All reward types'))

  await user.click(dialog.getByRole('button', { name: i18n.t('Next') }))
  expect(await dialog.findByText('david')).toBeVisible()

  await user.click(rewardType)
  await user.click(
    await screen.findByRole('option', {
      name: i18n.t('Wallet usage commission'),
    })
  )
  fireEvent.change(
    dialog.getByRole('textbox', {
      name: i18n.t('Search inviter by username or ID'),
    }),
    {
      target: { value: 'alice' },
    }
  )
  fireEvent.change(
    dialog.getByRole('textbox', {
      name: i18n.t('Search invitee by username or ID'),
    }),
    {
      target: { value: '22' },
    }
  )
  await user.click(dialog.getByRole('button', { name: i18n.t('Search') }))
  expect(await dialog.findByText('bob')).toBeVisible()
  expect(getRewards.mock.lastCall?.[0].searchParams.get('inviter')).toBe(
    'alice'
  )
  expect(getRewards.mock.lastCall?.[0].searchParams.get('invitee')).toBe('22')
  expect(getRewards.mock.lastCall?.[0].searchParams.get('type')).toBe(
    'wallet_usage'
  )
})
