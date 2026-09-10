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
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import { ChannelMonitorSettingsSection } from '@/features/system-settings/operations/channel-monitor-settings-section'
import { api } from '@/lib/api'
import { Route as SiteStatusRoute } from '@/routes/site-status'
import { useAuthStore } from '@/stores/auth-store'

import { StatusMonitor } from '..'
import { CacheMonitor } from '../cache-monitor'
import { SiteStatus } from '../site-status'
import { defaultHealthThresholds, type CacheMetricsResponse } from '../types'

async function renderSiteStatus(
  access = { enabled: true, requireAuth: false }
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {
    HeaderNavModules: { siteStatus: access },
    SidebarModulesAdmin: '{"console":{"enabled":false,"status":false}}',
  })
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()()
  const page = createRoute({
    getParentRoute: () => root,
    path: '/site-status/',
    beforeLoad: (options) =>
      SiteStatusRoute.options.beforeLoad?.({
        ...options,
        routeId: '/site-status/',
      }),
    component: SiteStatus,
  })
  const home = createRoute({ getParentRoute: () => root, path: '/' })
  const login = createRoute({ getParentRoute: () => root, path: '/sign-in' })
  const router = createRouter({
    routeTree: root.addChildren([page, home, login]),
    context: { queryClient: client },
    history: createMemoryHistory({ initialEntries: ['/site-status'] }),
  })
  await router.load()
  return {
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    ),
    router,
  }
}

describe('status page separation', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    useAuthStore.getState().auth.reset()
    useAuthStore.setState((state) => ({
      auth: { ...state.auth, bootstrapState: 'complete' },
    }))
  })

  afterEach(() => {
    useAuthStore.getState().auth.reset()
  })

  it('pending uptime data shows a non-scrolling skeleton until content is ready', async () => {
    let resolveResponse!: (value: {
      data: { success: boolean; data: [] }
    }) => void
    const response = new Promise<{ data: { success: boolean; data: [] } }>(
      (resolve) => {
        resolveResponse = resolve
      }
    )
    vi.spyOn(api, 'get').mockImplementation((url) =>
      url === '/api/uptime/status'
        ? response
        : Promise.resolve({ data: { success: true, data: '' } })
    )
    await renderSiteStatus()
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('aria-busy', 'true')
    const skeleton = main.querySelector('[data-slot="site-status-skeleton"]')
    expect(skeleton).toHaveClass('overflow-clip')
    expect(skeleton?.parentElement).toHaveClass('overflow-clip')
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeDisabled()
    resolveResponse({ data: { success: true, data: [] } })
    await waitFor(() => expect(main).toHaveAttribute('aria-busy', 'false'))
    expect(
      main.querySelector('[data-slot="site-status-skeleton"]')
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText('No uptime monitoring configured')).toBeVisible()
    )
  })

  it('opening site status uses its own top-level route and public header', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: { success: true, data: url === '/api/notice' ? '' : [] },
    }))
    const rendered = await renderSiteStatus()
    expect(
      await screen.findByRole('main', { name: 'Site status' })
    ).toBeVisible()
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: 'Toggle navigation menu' })
        .parentElement
    ).toHaveClass('lg:hidden')
    expect(
      screen.queryByRole('button', { name: 'Toggle Sidebar' })
    ).not.toBeInTheDocument()
    expect(
      rendered.container.querySelector('[data-slot="sidebar"]')
    ).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('overflow-hidden', 'h-full')
    expect(screen.getByRole('main').parentElement).toHaveClass(
      'h-dvh',
      'overflow-hidden',
      'pt-16'
    )
    expect(
      screen.queryByRole('heading', { name: 'Site status' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Service health')).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        'Live service availability, response times, and uptime history.'
      )
    ).not.toBeInTheDocument()
  })

  it.each([
    [{ enabled: false, requireAuth: false }, '/'],
    [{ enabled: true, requireAuth: true }, '/sign-in'],
  ])(
    'site status route enforces its own navigation configuration (%j)',
    async (access, destination) => {
      const rendered = await renderSiteStatus(access)
      expect(rendered.router.state.location.pathname).toBe(destination)
      rendered.unmount()
    }
  )

  it('site status shows uptime alone and refreshes only uptime data', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: { success: true, data: url === '/api/notice' ? '' : [] },
    }))
    const user = userEvent.setup()
    await renderSiteStatus()

    expect(screen.getByRole('main', { name: 'Site status' })).toBeVisible()
    await waitFor(() =>
      expect(screen.getByText('No uptime monitoring configured')).toBeVisible()
    )
    expect(
      screen.queryByRole('tab', { name: 'Cache analytics' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Official status' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: /Refresh/ }))
    await waitFor(() =>
      expect(
        get.mock.calls.filter(([url]) => url === '/api/uptime/status')
      ).toHaveLength(2)
    )
    expect(
      get.mock.calls.map(([url]) => url).filter((url) => url !== '/api/notice')
    ).toEqual(['/api/uptime/status', '/api/uptime/status'])
  })

  it('status monitor retains cache analytics without loading official or site status', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue({ data: { success: false } })
    render(<StatusMonitor />)
    expect(
      screen.getByRole('heading', { name: 'Channel Monitor' })
    ).toBeVisible()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/api/status-monitor/cache', {
        params: { hours: 24 },
      })
    )
    expect(get.mock.calls.map(([url]) => url)).toEqual([
      '/api/status-monitor/cache',
    ])
  })

  it('official status loads on selection and refreshes independently on the public page', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/api/notice') return { data: { success: true, data: '' } }
      if (url === '/api/status-monitor/providers') {
        return {
          data: {
            success: true,
            data: {
              providers: [
                {
                  provider: 'openai',
                  available: true,
                  indicator: 'none',
                  description: '',
                  status_url: 'https://status.openai.com',
                  subscribe_url: '',
                  checked_at: '',
                  components: [],
                  incidents: [],
                },
              ],
            },
          },
        }
      }
      return { data: { success: true, data: [] } }
    })
    const user = userEvent.setup()
    await renderSiteStatus()
    expect(
      get.mock.calls.some(([url]) => url === '/api/status-monitor/providers')
    ).toBe(false)
    await user.click(screen.getByRole('tab', { name: 'Official status' }))
    expect(await screen.findByText('No active incidents')).toBeVisible()
    const panel = screen.getByRole('tabpanel', { name: 'Official status' })
    expect(panel).toHaveClass('overflow-y-auto')
    expect(within(panel).getByRole('article').parentElement).not.toHaveClass(
      'xl:grid-cols-3'
    )
    expect(panel).not.toContainElement(
      screen.getByRole('tab', { name: 'Official status' })
    )
    await user.click(screen.getByRole('button', { name: /Refresh/ }))
    await waitFor(() =>
      expect(
        get.mock.calls.filter(
          ([url]) => url === '/api/status-monitor/providers'
        )
      ).toHaveLength(2)
    )
    expect(
      get.mock.calls.filter(([url]) => url === '/api/uptime/status')
    ).toHaveLength(1)
    expect(
      screen.queryByRole('heading', { name: 'Official provider status' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Site status' }))
    await waitFor(() =>
      expect(screen.getByText('No uptime monitoring configured')).toBeVisible()
    )
  })

  it('official status errors can be retried without replacing the site monitors', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/api/status-monitor/providers') {
        return { data: { success: false } }
      }
      return { data: { success: true, data: url === '/api/notice' ? '' : [] } }
    })
    const user = userEvent.setup()
    await renderSiteStatus()
    await user.click(screen.getByRole('tab', { name: 'Official status' }))
    expect(await screen.findByText('Official status unavailable')).toBeVisible()
    get.mockResolvedValue({ data: { success: true, data: { providers: [] } } })
    await user.click(screen.getByRole('button', { name: /Refresh/ }))
    await waitFor(() =>
      expect(
        get.mock.calls.filter(
          ([url]) => url === '/api/status-monitor/providers'
        )
      ).toHaveLength(2)
    )
    await user.click(screen.getByRole('tab', { name: 'Site status' }))
    await waitFor(() =>
      expect(screen.getByText('No uptime monitoring configured')).toBeVisible()
    )
  })

  it('only monitor cards scroll below fixed group tabs and filtering updates the cards', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data:
          url === '/api/notice'
            ? ''
            : [
                {
                  categoryName: 'API',
                  monitors: [
                    {
                      name: 'Primary API',
                      group: 'Core',
                      status: 1,
                      uptime: 1,
                    },
                    {
                      name: 'Image API',
                      group: 'Images',
                      status: 0,
                      uptime: 0.98,
                    },
                  ],
                },
              ],
      },
    }))
    const user = userEvent.setup()
    await renderSiteStatus()
    const main = screen.getByRole('main')
    const cards = await within(main).findAllByRole('article')
    expect(within(main).queryByRole('status')).not.toBeInTheDocument()
    const panel = within(main).getByRole('tabpanel', { name: 'All 2' })
    expect(panel).toHaveClass(
      'min-h-0',
      'overflow-y-auto',
      'overscroll-contain'
    )
    expect(panel).not.toContainElement(
      within(main).getByRole('tab', { name: 'All 2' }).closest('[role=tablist]')
    )
    expect(panel).not.toContainElement(
      within(main).getByRole('button', { name: /Refresh/ })
    )
    expect(within(main).queryByText('Total monitors')).not.toBeInTheDocument()
    expect(
      within(main).queryByText('Affected monitors')
    ).not.toBeInTheDocument()
    expect(within(main).queryByText('Average uptime')).not.toBeInTheDocument()
    const tabList = within(main)
      .getByRole('tab', { name: 'All 2' })
      .closest<HTMLElement>('[role=tablist]')
    if (!tabList) throw new Error('Group tab list is missing')
    expect(tabList).toHaveClass('w-full', 'gap-1.5', 'overflow-x-auto')
    const allTab = within(tabList).getByRole('tab', { name: 'All 2' })
    expect(allTab).toHaveAttribute('aria-selected', 'true')
    expect(within(allTab).getByText('2')).toHaveClass(
      'rounded-md',
      'tabular-nums'
    )
    expect(cards).toHaveLength(2)
    expect(cards[0].parentElement).toHaveClass(
      'grid',
      'md:grid-cols-2',
      'xl:grid-cols-3'
    )
    await user.click(screen.getByRole('tab', { name: /Core/ }))
    expect(within(main).getAllByRole('article')).toHaveLength(1)
    expect(
      within(main).getByRole('button', { name: /Primary API/ })
    ).toBeVisible()
    expect(
      within(main).queryByRole('button', { name: /Image API/ })
    ).not.toBeInTheDocument()
    expect(within(main).queryByRole('status')).not.toBeInTheDocument()
  })

  it('failed uptime responses show a retryable error without a healthy service banner', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data:
        url === '/api/notice'
          ? { success: true, data: '' }
          : { success: false },
    }))
    const user = userEvent.setup()
    await renderSiteStatus()
    await waitFor(() =>
      expect(
        screen.getByText('Failed to load status monitoring data')
      ).toBeVisible()
    )
    expect(
      within(screen.getByRole('main')).queryByRole('status')
    ).not.toBeInTheDocument()
    get.mockResolvedValue({ data: { success: true, data: [] } })
    await user.click(screen.getByRole('button', { name: /Refresh/ }))
    await waitFor(() =>
      expect(screen.getByText('No uptime monitoring configured')).toBeVisible()
    )
  })
})

describe('user channel monitor', () => {
  it('shows overall metrics and colors intervals by health score while protecting private counts', async () => {
    const response: CacheMetricsResponse = {
      success: true,
      data: {
        start_ts: 0,
        end_ts: 7200,
        bucket_seconds: 3600,
        baseline: 85,
        counts_visible: false,
        all_groups: true,
        available_groups: ['Active', 'Empty'],
        display_groups: ['Active', 'Empty'],
        summary: {
          health: {
            overall: 'healthy',
            error_rate: 'healthy',
            ttft: 'healthy',
            cache: 'healthy',
            score: 90,
            error_rate_percent: 4.9,
            avg_ttft_ms: 5000,
          },
          has_data: true,
          cache_hit_rate: 86.5,
        },
        groups: [
          {
            group: 'Active',
            health: {
              overall: 'critical',
              error_rate: 'critical',
              ttft: 'healthy',
              cache: 'healthy',
              score: 20,
              error_rate_percent: 30,
              avg_ttft_ms: 1000,
            },
            has_data: true,
            cache_hit_rate: 95,
            cached_tokens: 120,
            avg_tps: 12,
            series: [
              {
                ts: 3600,
                health: {
                  overall: 'critical',
                  error_rate: 'critical',
                  ttft: 'healthy',
                  cache: 'healthy',
                  score: 20,
                  error_rate_percent: 30,
                  avg_ttft_ms: 1000,
                },
                has_data: true,
                cache_hit_rate: 95,
                cached_tokens: 120,
                avg_tps: 12,
                request_count: 100,
                hit_count: 95,
              },
              {
                ts: 7200,
                health: {
                  overall: 'critical',
                  error_rate: 'critical',
                  ttft: 'unknown',
                  cache: 'unknown',
                  score: 0,
                  error_rate_percent: 100,
                  avg_ttft_ms: null,
                },
                has_data: false,
                cache_hit_rate: 0,
                cached_tokens: 0,
                avg_tps: 0,
              },
            ],
          },
        ],
      },
    }
    const user = userEvent.setup()
    const rendered = render(
      <CacheMonitor
        response={response}
        loading={false}
        failed={false}
        onRefresh={() => {}}
      />
    )
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getAllByRole('article')[0].parentElement).toHaveClass(
      'grid-cols-3'
    )
    expect(screen.getByText('60 min intervals')).toBeVisible()
    expect(
      within(screen.getByRole('article', { name: 'Success rate' })).getByText(
        '95.1%'
      )
    ).toBeVisible()
    expect(
      within(screen.getByRole('article', { name: 'Average TTFT' })).getByText(
        '5.0 s'
      )
    ).toBeVisible()
    expect(
      within(screen.getByRole('article', { name: 'Cache rate' })).getByText(
        '86.5%'
      )
    ).toBeVisible()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Pulse matrix' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Line chart' })).toBeVisible()
    expect(screen.getAllByRole('article')[0].closest('section')).toHaveClass(
      'h-full',
      'overflow-hidden'
    )
    const matrix = screen.getByRole('region', { name: 'Availability trends' })
    expect(matrix).toHaveClass('min-h-0', 'overflow-auto', 'overscroll-contain')
    expect(matrix).not.toContainElement(
      screen.getByRole('tablist', { name: 'View' })
    )
    expect(matrix).not.toContainElement(screen.getAllByRole('article')[0])
    expect(matrix).not.toContainElement(screen.getByText('Healthy (≥80)'))
    expect(screen.queryByText('Cache hits')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Line chart' }))
    expect(screen.getByRole('tabpanel', { name: 'Line chart' })).toBeVisible()
    expect(
      screen.queryByRole('combobox', { name: 'Group' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Overall channel trend' })
    ).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Pulse matrix' }))
    const table = screen.getByRole('table', { name: 'Channel health' })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3)
    const cells = within(rows[1]).getAllByRole('cell')
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'Active',
      '70.0%',
      '1.0 s',
      '95.0%',
      '',
    ])
    const pulses = cells[4]
    expect(within(pulses).getAllByRole('img')).toHaveLength(3)
    const critical = within(pulses).getByRole('img', {
      name: /Health score: 20/,
    })
    expect(critical).toHaveAccessibleName(/Critical/)
    expect(critical).not.toHaveAccessibleName(/Hits \/ Requests/)
    expect(critical.style.backgroundColor).toContain('var(--destructive)')
    expect(
      within(pulses).getByRole('img', { name: /Health score: 0/ })
    ).toHaveAccessibleName(/Success rate: 0.0%/)
    const emptyPulses = within(rows[2]).getAllByRole('cell')[4]
    expect(within(emptyPulses).getAllByRole('img')).toHaveLength(3)
    expect(
      within(emptyPulses).getAllByRole('img')[0].style.backgroundColor
    ).toContain('var(--muted-foreground)')
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(within(pulses).getAllByRole('img')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Reset zoom' }))
    expect(within(pulses).getAllByRole('img')).toHaveLength(3)
    fireEvent.wheel(pulses, { deltaY: -100, ctrlKey: true })
    expect(within(pulses).getAllByRole('img')).toHaveLength(3)
    fireEvent.wheel(pulses, { deltaY: -100, clientX: 0 })
    expect(within(pulses).getAllByRole('img')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Reset zoom' }))
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeDisabled()
    rendered.rerender(
      <CacheMonitor
        response={{
          ...response,
          data: { ...response.data, counts_visible: true },
        }}
        loading={false}
        failed={false}
        onRefresh={() => {}}
      />
    )
    expect(
      within(pulses).getByRole('img', { name: /Health score: 20/ })
    ).toHaveAccessibleName(/Hits \/ Requests: 95 \/ 100/)
  })
})

describe('channel monitor configuration in system settings', () => {
  it('loads saved configuration, retains drafts after a failed save, and retries only unsaved changes', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const data = {
      baseline: 85,
      health_thresholds: defaultHealthThresholds(),
      all_groups: true,
      available_groups: ['Primary', 'Backup'],
      display_groups: ['Primary', 'Backup'],
      groups: [],
      counts_visible: true,
      start_ts: 0,
      end_ts: 7200,
      bucket_seconds: 3600,
    }
    vi.spyOn(api, 'get').mockImplementation(async () => ({
      data: { success: true, data: { ...data } },
    }))
    let failGroups = true
    const put = vi.spyOn(api, 'put').mockImplementation(async (url, body) => {
      if (url === '/api/status-monitor/cache/health-thresholds') {
        data.health_thresholds = body as typeof data.health_thresholds
        return { data: { success: true, data: data.health_thresholds } }
      }
      if (failGroups) {
        return { data: { success: false, message: 'Settings save failed' } }
      }
      const request = body as { all_groups: boolean; groups: string[] }
      data.all_groups = request.all_groups
      data.display_groups = request.groups
      return {
        data: {
          success: true,
          data: {
            all_groups: data.all_groups,
            display_groups: data.display_groups,
          },
        },
      }
    })
    const actions = document.createElement('div')
    document.body.append(actions)
    const user = userEvent.setup()
    const rendered = render(
      <QueryClientProvider client={client}>
        <SettingsPageProvider actionsContainer={actions}>
          <ChannelMonitorSettingsSection />
        </SettingsPageProvider>
      </QueryClientProvider>
    )
    try {
      const baselineInput = await screen.findByRole('spinbutton', {
        name: 'Warning cache rate (%)',
      })
      expect(baselineInput).toHaveValue(85)
      expect(screen.getAllByRole('spinbutton')).toHaveLength(8)
      expect(
        screen.getByRole('spinbutton', { name: 'Minimum sample count' })
      ).toHaveValue(50)
      expect(
        screen.getByRole('spinbutton', { name: 'Warning TTFT (ms)' })
      ).toHaveValue(8000)
      const critical = screen.getByRole('spinbutton', {
        name: 'Critical cache rate (%)',
      })
      expect(critical).toHaveValue(60)
      await user.clear(critical)
      await user.type(critical, '90')
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))
      expect(
        await screen.findByText(
          'Critical cache rate cannot exceed the warning rate.'
        )
      ).toBeVisible()
      expect(put).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'Reset' }))
      expect(critical).toHaveValue(60)
      await user.click(
        screen.getByRole('switch', { name: 'Automatically show all groups' })
      )
      await user.click(screen.getByRole('checkbox', { name: 'Backup' }))
      await user.clear(baselineInput)
      await user.type(baselineInput, '86')
      expect(baselineInput).toHaveValue(86)
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))
      await waitFor(() =>
        expect(put).toHaveBeenCalledWith('/api/status-monitor/cache/groups', {
          all_groups: false,
          groups: ['Primary'],
        })
      )
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Save Changes' })
        ).toBeEnabled()
      )
      expect(screen.getByRole('checkbox', { name: 'Backup' })).not.toBeChecked()
      failGroups = false
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Save Changes' })
        ).toBeDisabled()
      )
      expect(
        put.mock.calls.filter(
          ([url]) => url === '/api/status-monitor/cache/health-thresholds'
        )
      ).toHaveLength(1)
      expect(data.health_thresholds.warning_cache_rate).toBe(86)
      expect(data.display_groups).toEqual(['Primary'])
      expect(data.all_groups).toBe(false)
      await user.click(screen.getByRole('checkbox', { name: 'Primary' }))
      expect(
        screen.getByRole('button', { name: 'Save Changes' })
      ).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'Reset' }))
      expect(screen.getByRole('checkbox', { name: 'Primary' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Backup' })).not.toBeChecked()
    } finally {
      rendered.unmount()
      client.clear()
      actions.remove()
    }
  })
})
