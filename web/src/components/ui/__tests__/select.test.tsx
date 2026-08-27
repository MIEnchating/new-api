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

const domWindow = new Window()
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLSelectElement',
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
const { NativeSelect, NativeSelectOption } = await import('../native-select')
const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } =
  await import('../select')

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

describe('global select controls', () => {
  afterAll(() => domWindow.close())

  test('fills its field and turns the single arrow upward while open', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () =>
      root.render(
        <Select defaultValue='one'>
          <SelectTrigger aria-label='Option'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='one'>One</SelectItem>
            <SelectItem value='two'>Two</SelectItem>
          </SelectContent>
        </Select>
      )
    )

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-slot="select-trigger"]'
    )
    const icon = trigger?.querySelector<HTMLElement>(
      '[data-slot="select-icon"]'
    )
    assert.ok(trigger)
    assert.ok(icon)
    assert.equal(trigger.classList.contains('w-full'), true)
    assert.equal(trigger.classList.contains('min-w-0'), true)
    assert.equal(trigger.classList.contains('w-fit'), false)
    assert.equal(trigger.dataset.pressAnimation, 'none')
    assert.equal(icon.classList.contains('data-popup-open:rotate-180'), true)
    assert.equal(trigger.hasAttribute('data-popup-open'), false)

    await act(async () => trigger.click())
    assert.equal(trigger.hasAttribute('data-popup-open'), true)
    assert.equal(icon.hasAttribute('data-popup-open'), true)

    await act(async () => root.unmount())
    container.remove()
  })

  test('makes native selects full width with one stateful arrow', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () =>
      root.render(
        <NativeSelect aria-label='Native option' defaultValue='one'>
          <NativeSelectOption value='one'>One</NativeSelectOption>
        </NativeSelect>
      )
    )

    const wrapper = container.querySelector<HTMLElement>(
      '[data-slot="native-select-wrapper"]'
    )
    const icon = container.querySelector<HTMLElement>(
      '[data-slot="native-select-icon"]'
    )
    assert.ok(wrapper)
    assert.ok(icon)
    assert.equal(wrapper.classList.contains('w-full'), true)
    assert.equal(wrapper.classList.contains('min-w-0'), true)
    assert.equal(wrapper.classList.contains('w-fit'), false)
    assert.equal(
      icon.classList.contains(
        'group-has-[select:open]/native-select:rotate-180'
      ),
      true
    )

    await act(async () => root.unmount())
    container.remove()
  })
})
