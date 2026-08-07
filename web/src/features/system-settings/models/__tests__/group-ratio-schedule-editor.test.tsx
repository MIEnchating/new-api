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
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'KeyboardEvent',
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

const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { GroupRatioScheduleEditor } =
  await import('../group-ratio-schedule-editor')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: { translation: {} },
    zh: { translation: { 'Specific date': '指定日期' } },
  },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

function findButton(label: string): HTMLButtonElement {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((candidate) => candidate.textContent?.trim() === label)
  assert.ok(button)
  return button
}

async function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    domWindow.HTMLInputElement.prototype,
    'value'
  )?.set
  assert.ok(setter)
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(
      new domWindow.Event('input', { bubbles: true }) as unknown as Event
    )
  })
}

describe('group ratio schedule editor', () => {
  after(() => {
    domWindow.close()
  })

  test('adds a daily period, preserves an empty ratio input, and saves the policy', async () => {
    const savedValues: string[] = []
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <I18nextProvider i18n={i18n}>
          <GroupRatioScheduleEditor
            open={open}
            onOpenChange={setOpen}
            groupName='vip'
            baseRatio={1}
            value='{}'
            onChange={(value) => savedValues.push(value)}
          />
        </I18nextProvider>
      )
    }

    await act(async () => root.render(<Harness />))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const masterSwitch = document.querySelector<HTMLElement>(
      '[role="switch"][aria-label="Enable time-based ratio"]'
    )
    assert.ok(masterSwitch)
    assert.equal(masterSwitch.getAttribute('aria-checked'), 'false')
    assert.ok(
      document.body.textContent?.includes('No ratio periods configured.')
    )

    await act(async () => masterSwitch.click())
    await act(async () => findButton('Add period').click())

    const scopeValue = document.querySelector<HTMLElement>(
      '[data-slot="select-value"]'
    )
    assert.ok(scopeValue)
    assert.equal(scopeValue.textContent?.trim(), 'Every day')

    const ratioInput = document.querySelector<HTMLInputElement>(
      'input[type="number"]'
    )
    assert.ok(ratioInput)
    assert.equal(ratioInput.value, '1')

    const nameInput = document.querySelector<HTMLInputElement>(
      'input[aria-label="Period name"]'
    )
    assert.ok(nameInput)
    await setInputValue(nameInput, '  Member Day  ')

    await setInputValue(ratioInput, '')
    assert.equal(ratioInput.value, '')
    assert.equal(findButton('Save changes').disabled, false)
    await act(async () => findButton('Save changes').click())
    assert.equal(savedValues.length, 0)
    assert.ok(
      document.body.textContent?.includes(
        'Complete the time, scope, and ratio for this period.'
      )
    )

    await setInputValue(ratioInput, '0.25')
    assert.equal(findButton('Save changes').disabled, false)
    await act(async () => findButton('Save changes').click())

    assert.equal(savedValues.length, 1)
    assert.deepEqual(JSON.parse(savedValues[0]), {
      vip: {
        enabled: true,
        periods: [
          {
            name: 'Member Day',
            start: '00:00',
            end: '23:59',
            ratio: 0.25,
            enabled: true,
          },
        ],
      },
    })

    await act(async () => root.unmount())
    container.remove()
  })

  test('uses the localized specific-date label for a dated period', async () => {
    await i18n.changeLanguage('zh')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <GroupRatioScheduleEditor
            open
            onOpenChange={() => {}}
            groupName='vip'
            baseRatio={1}
            value={JSON.stringify({
              vip: {
                enabled: true,
                periods: [
                  {
                    start: '00:00',
                    end: '23:59',
                    ratio: 1.2,
                    enabled: true,
                    date: '2026-08-06',
                  },
                ],
              },
            })}
            onChange={() => {}}
          />
        </I18nextProvider>
      )
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    assert.ok(document.body.textContent?.includes('指定日期'))
    const scopeValue = document.querySelector<HTMLElement>(
      '[data-slot="select-value"]'
    )
    assert.ok(scopeValue)
    assert.equal(scopeValue.textContent?.trim(), '指定日期')
    assert.equal(
      [...document.querySelectorAll('label')].some(
        (label) => label.textContent?.trim() === 'Date'
      ),
      false
    )

    await act(async () => root.unmount())
    container.remove()
    await i18n.changeLanguage('en')
  })

  test('moves the period label together with its content', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <GroupRatioScheduleEditor
            open
            onOpenChange={() => {}}
            groupName='vip'
            baseRatio={1}
            value={JSON.stringify({
              vip: {
                enabled: true,
                periods: [
                  {
                    name: 'Morning',
                    start: '08:00',
                    end: '10:00',
                    ratio: 1,
                    enabled: true,
                  },
                  {
                    name: 'Evening',
                    start: '18:00',
                    end: '20:00',
                    ratio: 2,
                    enabled: true,
                  },
                ],
              },
            })}
            onChange={() => {}}
          />
        </I18nextProvider>
      )
    )
    await act(async () => undefined)

    const moveDown = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Move down"]'
    )
    assert.ok(moveDown)
    await act(async () => moveDown.click())

    const periodNames = [
      ...document.querySelectorAll<HTMLInputElement>(
        'input[aria-label="Period name"]'
      ),
    ].map((input) => ({ value: input.value, placeholder: input.placeholder }))
    assert.deepEqual(periodNames, [
      { value: 'Evening', placeholder: 'Period 2' },
      { value: 'Morning', placeholder: 'Period 1' },
    ])
    const times = [
      ...document.querySelectorAll<HTMLInputElement>('input[type="time"]'),
    ].map((input) => input.value)
    assert.deepEqual(times, ['18:00', '20:00', '08:00', '10:00'])

    await act(async () => root.unmount())
    container.remove()
  })
})
