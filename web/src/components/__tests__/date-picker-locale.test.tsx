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
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, expect, test } from 'vitest'

import { DatePicker } from '../date-picker'
import {
  getCalendarLocale,
  getReactAriaLocale,
} from '../date-time-picker-utils'
import { DateTimePicker } from '../datetime-picker'

const selected = new Date('2026-10-11T00:00:00')

async function setInterfaceLanguage(language: string) {
  if (!i18next.hasResourceBundle(language, 'translation')) {
    i18next.addResourceBundle(language, 'translation', {})
  }
  await act(() => i18next.changeLanguage(language))
}

async function openCalendar(label: string) {
  await userEvent.click(
    screen.getByRole('button', {
      name: (name) => name === label || name === `${label} ${label}`,
    })
  )
  return screen.findByRole('grid')
}

afterEach(async () => {
  await act(() => i18next.changeLanguage('en'))
})

test.each([
  ['zhCN', 'zh-CN'],
  ['zhTW', 'zh-TW'],
  ['en', 'en-US'],
  ['fr', 'fr'],
  ['ja', 'ja'],
  ['ru', 'ru'],
  ['vi', 'vi'],
  ['invalid_locale', 'en-US'],
])('selects the calendar locale for %s', (language, expected) => {
  expect(getCalendarLocale(language).code).toBe(expected)
  expect(getReactAriaLocale(language)).toBe(
    expected === 'en-US' ? 'en' : expected
  )
})

test('uses Chinese calendar locales for zhCN and zhTW in both date pickers', async () => {
  await setInterfaceLanguage('zhCN')
  const datePicker = render(
    <DatePicker
      placeholder='Choose date'
      selected={selected}
      onSelect={() => undefined}
    />
  )
  expect(await openCalendar('Choose date')).toHaveTextContent('日')
  datePicker.unmount()

  const dateTimePicker = render(
    <DateTimePicker
      placeholder='Choose time'
      value={selected}
      onChange={() => undefined}
    />
  )
  expect(await openCalendar('Choose time')).toHaveTextContent('日')
  dateTimePicker.unmount()

  await setInterfaceLanguage('zhTW')
  render(
    <DatePicker
      placeholder='Choose date'
      selected={selected}
      onSelect={() => undefined}
    />
  )
  expect(await openCalendar('Choose date')).toHaveTextContent('日')
})

test('keeps French on the French calendar locale', async () => {
  await setInterfaceLanguage('fr')
  render(
    <DatePicker
      placeholder='Choose date'
      selected={selected}
      onSelect={() => undefined}
    />
  )
  expect(await openCalendar('Choose date')).toHaveTextContent('dim.')
})
