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
import { after, describe, test } from 'node:test'

import { Window } from 'happy-dom'

const domWindow = new Window()
for (const key of [
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
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

Object.defineProperty(domWindow, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    matches: query.includes('max-width: 640px'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }),
})

const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { DataTableFacetedFilter } = await import('../faceted-filter')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

const options = [
  { label: 'Enabled', value: 'enabled' },
  { label: 'Disabled', value: 'disabled' },
]

async function renderFilter(singleSelect: boolean) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  function Harness() {
    const [selected, setSelected] = useState<string[]>([])
    return (
      <I18nextProvider i18n={i18n}>
        <DataTableFacetedFilter
          title='Status'
          options={options}
          singleSelect={singleSelect}
          selectedValues={selected}
          onSelectedValuesChange={setSelected}
        />
        <output data-selected-values>{selected.join(',')}</output>
      </I18nextProvider>
    )
  }

  await act(async () => root.render(<Harness />))
  const trigger = container.querySelector<HTMLButtonElement>('button')
  assert.ok(trigger)
  await act(async () => trigger.click())
  await act(async () => {
    await Promise.resolve()
  })

  return { container, root }
}

function getMobileOption(value: string) {
  const option = document.querySelector<HTMLButtonElement>(
    `[data-mobile-faceted-option="${value}"]`
  )
  assert.ok(option)
  return option
}

describe('data table faceted filter mobile selection', () => {
  after(() => domWindow.close())

  test('commits a single-select option from the mobile drawer', async () => {
    const { container, root } = await renderFilter(true)

    await act(async () => getMobileOption('enabled').click())
    assert.equal(
      container.querySelector('[data-selected-values]')?.textContent,
      'enabled'
    )

    await act(async () => root.unmount())
    container.remove()
  })

  test('toggles multiple options and clears them from the mobile drawer', async () => {
    const { container, root } = await renderFilter(false)

    await act(async () => getMobileOption('enabled').click())
    await act(async () => getMobileOption('disabled').click())
    assert.equal(
      container.querySelector('[data-selected-values]')?.textContent,
      'enabled,disabled'
    )

    const clearButton = [
      ...document.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent?.trim() === 'Clear filters')
    assert.ok(clearButton)
    await act(async () => clearButton.click())
    assert.equal(
      container.querySelector('[data-selected-values]')?.textContent,
      ''
    )

    await act(async () => root.unmount())
    container.remove()
  })
})
