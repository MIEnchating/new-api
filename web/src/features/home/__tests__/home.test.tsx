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
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { ThemeProvider } from '@/context/theme-provider'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { Home } from '..'
import { HeroTerminalDemo } from '../components/hero-terminal-demo'

afterEach(() => {
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  localStorage.clear()
})

async function renderHome(
  options: {
    authenticated?: boolean
    content?: string
    docs?: string
    waitForContent?: Promise<void>
    client?: QueryClient
  } = {}
) {
  if (options.authenticated) {
    useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role: 1 })
  }
  useSystemConfigStore.getState().setConfig({ systemName: 'Example Gateway' })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/home_page_content') await options.waitForContent
    return {
      data: {
        success: true,
        data: url === '/api/home_page_content' ? (options.content ?? '') : '',
      },
    }
  })
  const client =
    options.client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  client.setQueryData(['status'], {
    docs_link: options.docs ?? 'https://example.com/docs',
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: Home }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <ThemeProvider defaultTheme='light'>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
  return { ...view, client }
}

test('visitors see the enterprise homepage with working start, model, and configured documentation links', async () => {
  const { unmount, client } = await renderHome()
  await screen.findByRole('heading', { level: 1, name: /Connect with AI/ })
  const main = within(screen.getByRole('main'))
  expect(main.getAllByRole('link', { name: /Get Started/ })).toHaveLength(2)
  for (const link of main.getAllByRole('link', { name: /Get Started/ })) {
    expect(link).toHaveAttribute('href', '/sign-up')
  }
  for (const link of main.getAllByRole('link', { name: /Explore models/ })) {
    expect(link).toHaveAttribute('href', '/pricing')
  }
  expect(
    main.getAllByRole('link', { name: /Read the documentation/ })[0]
  ).toHaveAttribute('href', 'https://example.com/docs')
  expect(
    main.getAllByRole('link', { name: /Read the documentation/ })[0]
  ).toHaveAttribute('rel', 'noopener noreferrer')
  expect(main.getByText('Example Gateway')).toBeVisible()
  const hero = within(screen.getByRole('region', { name: /Connect with AI/ }))
  expect(hero.getAllByRole('link')).toHaveLength(5)
  expect(hero.getByRole('link', { name: 'Media workspace' })).toHaveAttribute(
    'href',
    `https://image.yunmian.tech/auth/sso/start?issuer=${window.location.origin}`
  )
  expect(hero.getByRole('link', { name: 'Site status' })).toHaveAttribute(
    'href',
    '/site-status'
  )
  expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent(
    'AI image creation'
  )
  expect(main.getByRole('link', { name: 'Start creating' })).toHaveAttribute(
    'href',
    `https://image.yunmian.tech/auth/sso/start?issuer=${window.location.origin}`
  )
  expect(
    main.getByRole('img', { name: 'AI-generated blue product visual' })
  ).toHaveAttribute('src', '/images/home/ai-product-visual.png')
  for (const strength of [
    'Cost-effective access',
    'Stable service',
    'Broad model coverage',
    'Service support',
  ]) {
    expect(main.getByText(strength)).toBeVisible()
  }
  const overview = within(
    main.getByRole('figure', { name: 'Integration overview' })
  )
  expect(
    overview.getByRole('img', { name: 'Example Gateway' })
  ).toBeInTheDocument()
  const models = within(
    overview.getByRole('list', { name: 'Model ecosystems' })
  )
  expect(models.getAllByRole('listitem')).toHaveLength(6)
  for (const name of [
    'OpenAI',
    'Claude',
    'Gemini',
    'DeepSeek',
    'Qwen',
    'Llama',
  ]) {
    expect(models.getByText(name, { selector: 'span' })).toBeVisible()
  }
  expect(main.getByRole('heading', { name: 'Media workspace' })).toBeVisible()
  expect(
    main.queryByRole('link', { name: /Contact|Enterprise partnership/ })
  ).not.toBeInTheDocument()
  unmount()
  client.clear()
})

test('signed-in users get dashboard actions and internal documentation stays in the app', async () => {
  const { unmount, client } = await renderHome({
    authenticated: true,
    docs: '/docs',
  })
  await screen.findByRole('heading', { level: 1, name: /Connect with AI/ })
  const main = within(screen.getByRole('main'))
  expect(
    main.queryByRole('link', { name: 'Get Started' })
  ).not.toBeInTheDocument()
  for (const link of main.getAllByRole('link', { name: /Go to Dashboard/ })) {
    expect(link).toHaveAttribute('href', '/dashboard')
  }
  expect(
    main.getAllByRole('link', { name: /Read the documentation/ })[0]
  ).toHaveAttribute('href', '/docs')
  expect(
    main.getAllByRole('link', { name: /Read the documentation/ })[0]
  ).not.toHaveAttribute('target')
  unmount()
  client.clear()
})

test('an administrator-configured homepage URL still replaces the default landing page', async () => {
  const { unmount, client } = await renderHome({
    content: 'https://example.com/custom',
  })
  const frame = await screen.findByTitle('Custom Home Page')
  expect(frame).toHaveAttribute('src', 'https://example.com/custom')
  expect(frame).toHaveAttribute(
    'sandbox',
    'allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation'
  )
  expect(
    screen.queryByRole('heading', { level: 1, name: /Connect with AI/ })
  ).not.toBeInTheDocument()
  unmount()
  client.clear()
})

test('protocol examples switch with the keyboard and copy the selected complete request', async () => {
  const user = userEvent.setup()
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  render(<HeroTerminalDemo />)
  const openai = screen.getByRole('tab', { name: 'OpenAI' })
  expect(openai).toHaveAttribute('aria-selected', 'true')
  openai.focus()
  await user.keyboard('{ArrowRight}{Enter}')
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: 'Responses' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  )
  expect(screen.getByRole('tabpanel')).toHaveTextContent('/v1/responses')
  await user.click(screen.getByRole('tab', { name: 'Claude' }))
  const panel = screen.getByRole('tabpanel')
  expect(panel).toHaveTextContent('/v1/messages')
  expect(panel).toHaveTextContent('anthropic-version: 2023-06-01')
  await user.click(within(panel).getByRole('button', { name: 'Copy example' }))
  await waitFor(() => expect(copy).toHaveBeenCalled())
  const request = copy.mock.calls[0][0]
  expect(request).toContain(`curl "${window.location.origin}/v1/messages"`)
  expect(request).toContain('Content-Type: application/json')
  expect(request).toContain('x-api-key: $API_KEY')
  expect(request).toContain('\\\n')
  expect(JSON.parse(request.split("-d '")[1].slice(0, -1))).toEqual({
    model: 'your-model',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello' }],
  })
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Gemini' }))
  expect(screen.getByRole('tabpanel')).toHaveTextContent(
    '/v1beta/models/your-model:generateContent'
  )
})

test('homepage icon buttons preserve balanced padding and remain visible with reduced motion', async () => {
  const { unmount, client } = await renderHome()
  const title = await screen.findByRole('heading', {
    level: 1,
    name: /Connect with AI/,
  })
  const hero = within(screen.getByRole('region', { name: /Connect with AI/ }))
  for (const name of ['Get Started', 'Explore models']) {
    expect(hero.getByRole('link', { name })).toHaveClass(
      'p-4',
      'has-data-[icon=inline-end]:pr-4'
    )
  }
  const cta = within(
    screen.getByRole('region', {
      name: /Put AI to work for your business/,
    })
  )
  expect(cta.getByRole('link', { name: 'Get Started' })).toHaveClass(
    'px-7',
    'has-data-[icon=inline-end]:pr-7'
  )
  expect(title).toBeVisible()
  expect(hero.getByRole('figure')).toBeVisible()
  expect(cta.getByRole('link', { name: 'Get Started' })).toBeVisible()
  unmount()
  client.clear()
})

test('visitors can expand API examples and use the configured footer navigation', async () => {
  const user = userEvent.setup()
  const { unmount, client } = await renderHome()
  const trigger = await screen.findByRole('button', {
    name: 'View API example',
  })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('tab', { name: 'Claude' })).not.toBeInTheDocument()
  trigger.focus()
  await user.keyboard('{Enter}')
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(await screen.findByRole('tab', { name: 'Claude' })).toBeVisible()
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  const footer = within(screen.getByRole('contentinfo'))
  expect(footer.getByRole('link', { name: 'Media workspace' })).toHaveAttribute(
    'href',
    `https://image.yunmian.tech/auth/sso/start?issuer=${window.location.origin}`
  )
  expect(footer.getByRole('link', { name: 'Model Square' })).toHaveAttribute(
    'href',
    '/pricing'
  )
  expect(
    footer.getByRole('link', { name: 'Read the documentation' })
  ).toHaveAttribute('href', 'https://example.com/docs')
  expect(footer.getByRole('link', { name: 'New API' })).toHaveAttribute(
    'href',
    'https://github.com/QuantumNous/new-api'
  )
  unmount()
  client.clear()
})

test.each(['', 'https://example.com/custom'])(
  'loading remains accessible until homepage configuration resolves (%s)',
  async (content) => {
    let finishLoading!: () => void
    const waitForContent = new Promise<void>((resolve) => {
      finishLoading = resolve
    })
    const { unmount, client } = await renderHome({ content, waitForContent })
    expect(screen.getByText('Loading...')).toBeVisible()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    await act(async () => {
      finishLoading()
    })
    if (content) {
      expect(await screen.findByTitle('Custom Home Page')).toHaveAttribute(
        'src',
        content
      )
      expect(
        screen.queryByRole('heading', { level: 1 })
      ).not.toBeInTheDocument()
    } else {
      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: /Connect with AI/,
        })
      ).toBeVisible()
    }
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
    unmount()
    client.clear()
  }
)

test('homepage remounts reuse resolved content without replaying full-page loading or repeating the request', async () => {
  const first = await renderHome()
  await screen.findByRole('heading', { level: 1, name: /Connect with AI/ })
  first.unmount()
  const second = await renderHome({ client: first.client })
  expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
  expect(
    screen.getByRole('heading', { level: 1, name: /Connect with AI/ })
  ).toBeVisible()
  expect(
    vi
      .mocked(api.get)
      .mock.calls.filter(([url]) => url === '/api/home_page_content')
  ).toHaveLength(1)
  second.unmount()
  first.client.clear()
})
