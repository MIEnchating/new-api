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
import { Window } from 'happy-dom'
import { afterAll, describe, expect, test } from 'vitest'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'localStorage',
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
] as const

for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} = await import('@tanstack/react-router')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { ChannelsPrimaryButtons } = await import('../channels-primary-buttons')
const { ChannelsProvider } = await import('../channels-provider')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

describe('channel management mobile primary actions', () => {
  afterAll(() => domWindow.close())

  test('keeps the compact create action without the removed channel execution entry', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const rootRoute = createRootRoute()
    const authenticated = createRoute({
      getParentRoute: () => rootRoute,
      id: '_authenticated',
    })
    const channels = createRoute({
      getParentRoute: () => authenticated,
      path: '/channels/',
      component: () => (
        <ChannelsProvider>
          <ChannelsPrimaryButtons />
        </ChannelsProvider>
      ),
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([authenticated.addChildren([channels])]),
      history: createMemoryHistory({ initialEntries: ['/channels/'] }),
    })
    await router.load()

    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </I18nextProvider>
      )
    )

    expect(
      container.querySelector('button[aria-label="Channel execution"]')
    ).toBeNull()

    const button = container.querySelector<HTMLButtonElement>(
      '[data-mobile-compact-action="create"]'
    )
    expect(button?.getAttribute('aria-label')).toBe('Create Channel')
    const label = button?.querySelector<HTMLElement>('span')
    expect(label?.classList.contains('sr-only')).toBe(true)
    expect(label?.classList.contains('sm:not-sr-only')).toBe(true)

    await act(async () => root.unmount())
    queryClient.clear()
    container.remove()
  })
})
