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
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
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
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { DatePicker } = await import('../date-picker')
const { getCalendarPopoverPlacement } =
  await import('../date-time-picker-utils')
const { Dialog, DialogContent } = await import('../ui/dialog')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

describe('date picker year and month dropdowns', () => {
  after(() => domWindow.close())

  test('keeps the calendar open and selects the current year', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    function Harness() {
      const [date, setDate] = useState(new Date(2026, 7, 7))
      return (
        <I18nextProvider i18n={i18n}>
          <Dialog open>
            <DialogContent>
              <DatePicker
                selected={date}
                onSelect={(nextDate) => nextDate && setDate(nextDate)}
              />
            </DialogContent>
          </Dialog>
        </I18nextProvider>
      )
    }

    await act(async () => root.render(<Harness />))
    const calendarButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Pick a date"]'
    )
    assert.ok(calendarButton)
    await act(async () => calendarButton.click())
    await act(async () => undefined)

    const getYearTrigger = () =>
      document.querySelector<HTMLButtonElement>('button[aria-label="year"]')
    const getMonthTrigger = () =>
      document.querySelector<HTMLButtonElement>('button[aria-label="month"]')
    const yearTrigger = getYearTrigger()
    const monthTrigger = getMonthTrigger()
    assert.ok(yearTrigger)
    assert.ok(monthTrigger)
    assert.equal(yearTrigger.textContent?.trim(), '2026')

    const findSelectItem = (label: string) =>
      [
        ...document.querySelectorAll<HTMLElement>('[data-slot="select-item"]'),
      ].find((item) => item.textContent?.trim() === label)

    await act(async () => yearTrigger.click())
    const nextYear = findSelectItem('2027')
    assert.ok(nextYear)

    await act(async () => monthTrigger.click())
    assert.ok(document.querySelector('[data-trigger="DatePicker"]'))
    const december = findSelectItem('December')
    assert.ok(december)
    await act(async () => december.click())

    await act(async () => getYearTrigger()?.click())
    const reopenedNextYear = findSelectItem('2027')
    assert.ok(reopenedNextYear)
    await act(async () => reopenedNextYear.click())

    assert.equal(getYearTrigger()?.textContent?.trim(), '2027')
    assert.equal(getMonthTrigger()?.textContent?.trim(), 'December')
    assert.ok(document.querySelector('[data-trigger="DatePicker"]'))

    await act(async () => root.unmount())
    container.remove()
  })

  test('places the calendar above a trigger near the dialog footer', () => {
    const body = document.createElement('div')
    body.setAttribute('data-slot', 'dialog-body')
    const trigger = document.createElement('div')
    body.append(trigger)
    body.getBoundingClientRect = () => ({ top: 100, bottom: 700 }) as DOMRect
    trigger.getBoundingClientRect = () => ({ top: 620, bottom: 656 }) as DOMRect

    assert.equal(getCalendarPopoverPlacement(trigger), 'top start')
  })
})
