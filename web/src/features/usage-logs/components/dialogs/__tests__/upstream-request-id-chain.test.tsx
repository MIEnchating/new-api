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
import type React from 'react'
import { afterAll, describe, test } from 'vitest'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'MouseEvent',
  'CustomEvent',
  'MutationObserver',
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

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Upstream Request ID': 'Upstream Request ID',
        'Upstream Request ID Chain': 'Upstream Request ID Chain',
        'Copy to clipboard': 'Copy to clipboard',
        Copied: 'Copied',
        Expand: 'Expand',
        Collapse: 'Collapse',
        '+{{count}} more': '+{{count}} more',
        'Not recorded': 'Not recorded',
        'Sub2API / other upstream (X-Request-Id)':
          'Sub2API / other upstream (X-Request-Id)',
      },
    },
  },
})

const { UpstreamRequestIdChain } = await import('../execution-trace-dialog')
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

type RenderedChain = {
  container: HTMLDivElement
  root: ReturnType<typeof createRoot>
}

async function renderChain(
  props: React.ComponentProps<typeof UpstreamRequestIdChain>
): Promise<RenderedChain> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <UpstreamRequestIdChain {...props} />
      </I18nextProvider>
    )
  })

  return { container, root }
}

async function unmountChain(rendered: RenderedChain) {
  await act(async () => rendered.root.unmount())
  rendered.container.remove()
}

function click(element: Element) {
  element.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true })
  )
}

describe('upstream request ID chain', () => {
  afterAll(() => {
    domWindow.close()
  })

  test('shows up to three request IDs without collapse controls', async () => {
    const requestIds = ['request-one', 'request-two', 'request-three']
    const rendered = await renderChain({ requestIds })

    for (const requestId of requestIds) {
      assert.equal(rendered.container.textContent?.includes(requestId), true)
    }
    assert.equal(
      rendered.container.querySelector('button[aria-label="Expand"]'),
      null
    )
    assert.equal(
      rendered.container.querySelector('button[aria-label="Collapse"]'),
      null
    )

    await unmountChain(rendered)
  })

  test('summarizes a long chain with the first and final request IDs', async () => {
    const requestIds = [
      'request-one',
      'request-two',
      'request-three',
      'request-four',
    ]
    const rendered = await renderChain({ requestIds })

    assert.equal(rendered.container.textContent?.includes('request-one'), true)
    assert.equal(rendered.container.textContent?.includes('request-two'), false)
    assert.equal(
      rendered.container.textContent?.includes('request-three'),
      false
    )
    assert.equal(rendered.container.textContent?.includes('request-four'), true)
    assert.equal(rendered.container.textContent?.includes('+2 more'), true)

    const rows = rendered.container.querySelectorAll('ol > li')
    assert.equal(rows.length, 3)
    assert.equal(rows[0]?.querySelector('span')?.textContent?.trim(), '1')
    assert.equal(rows[2]?.querySelector('span')?.textContent?.trim(), '4')

    const expandButton = rendered.container.querySelector(
      'button[aria-label="Expand"]'
    )
    assert.ok(expandButton)
    assert.equal(expandButton.getAttribute('aria-expanded'), 'false')

    await unmountChain(rendered)
  })

  test('expands the complete chain in order and can collapse it again', async () => {
    const requestIds = [
      'request-one',
      'request-two',
      'request-three',
      'request-four',
    ]
    const rendered = await renderChain({
      requestIds,
      sources: {
        'request-two': 'x-request-id',
      },
    })

    const expandButton = rendered.container.querySelector(
      'button[aria-label="Expand"]'
    )
    assert.ok(expandButton)
    await act(async () => click(expandButton))

    const expandedRows = rendered.container.querySelectorAll('ol > li')
    assert.equal(expandedRows.length, 4)
    assert.deepEqual(
      [...expandedRows].map((row) =>
        row.querySelector('div.font-mono')?.textContent?.trim()
      ),
      requestIds
    )
    assert.equal(
      rendered.container.textContent?.includes(
        'Sub2API / other upstream (X-Request-Id)'
      ),
      true
    )

    const collapseButton = rendered.container.querySelector(
      'button[aria-label="Collapse"]'
    )
    assert.ok(collapseButton)
    assert.equal(collapseButton.getAttribute('aria-expanded'), 'true')
    await act(async () => click(collapseButton))

    assert.equal(rendered.container.querySelectorAll('ol > li').length, 3)
    assert.equal(rendered.container.textContent?.includes('request-two'), false)
    assert.equal(rendered.container.textContent?.includes('request-four'), true)

    await unmountChain(rendered)
  })
})
