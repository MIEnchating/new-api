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
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { CompactDateTimeRangePicker } from '../compact-date-time-range-picker'

test('keeps the clicked date mounted and focused when updating the draft range', async () => {
  const user = userEvent.setup()
  render(
    <CompactDateTimeRangePicker
      start={new Date(2026, 9, 21)}
      end={new Date(2026, 9, 21, 11, 27, 17)}
      onChange={() => undefined}
    />
  )
  await user.click(screen.getByRole('button'))
  const date = screen.getByRole('button', { name: /October 9th, 2026/ })
  await user.click(date)

  expect(screen.getByRole('button', { name: /October 9th, 2026/ })).toBe(date)
  expect(date).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeVisible()
})

test('moves keyboard focus to the next date after selecting a range endpoint', async () => {
  const user = userEvent.setup()
  render(
    <CompactDateTimeRangePicker
      start={new Date(2026, 9, 21)}
      end={new Date(2026, 9, 21, 11, 27, 17)}
      onChange={() => undefined}
    />
  )
  await user.click(screen.getByRole('button'))
  await user.click(screen.getByRole('button', { name: /October 9th, 2026/ }))
  await user.keyboard('{ArrowRight}')

  expect(
    screen.getByRole('button', { name: /October 10th, 2026/ })
  ).toHaveFocus()
})

test('preserves edited times while changing dates and applies them only on confirmation', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <CompactDateTimeRangePicker
      start={new Date(2026, 9, 21)}
      end={new Date(2026, 9, 21, 11, 27, 17)}
      onChange={onChange}
    />
  )
  await user.click(screen.getByRole('button'))
  fireEvent.change(screen.getByLabelText('Start Time'), {
    target: { value: '08:30:45' },
  })
  fireEvent.change(screen.getByLabelText('End Time'), {
    target: { value: '19:15:30' },
  })
  await user.click(screen.getByRole('button', { name: /October 9th, 2026/ }))
  await user.click(screen.getByRole('button', { name: /October 23rd, 2026/ }))

  expect(screen.getByLabelText('Start Time')).toHaveValue('08:30:45')
  expect(screen.getByLabelText('End Time')).toHaveValue('19:15:30')
  expect(onChange).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    start: new Date(2026, 9, 9, 8, 30, 45),
    end: new Date(2026, 9, 23, 19, 15, 30),
  })
})

test('gives the selected interval a contrasting background between both endpoints', async () => {
  const user = userEvent.setup()
  render(
    <CompactDateTimeRangePicker
      start={new Date(2026, 9, 9)}
      end={new Date(2026, 9, 23)}
      onChange={() => undefined}
    />
  )
  await user.click(screen.getByRole('button'))

  expect(screen.getAllByRole('gridcell', { selected: true })).toHaveLength(15)
  expect(
    screen.getByRole('button', { name: /October 16th, 2026/ })
  ).toHaveClass('data-[range-middle=true]:bg-(--range-background)')
})

test.each([/October 9th, 2026/, /October 23rd, 2026/])(
  'keeps the selected endpoint %s opaque when hovered in dark mode',
  async (name) => {
    const user = userEvent.setup()
    render(
      <CompactDateTimeRangePicker
        start={new Date(2026, 9, 9)}
        end={new Date(2026, 9, 23)}
        onChange={() => undefined}
      />
    )
    await user.click(screen.getByRole('button'))
    const endpoint = screen.getByRole('button', { name })
    await user.hover(endpoint)

    expect(endpoint).toHaveClass('hover:bg-primary', 'dark:hover:bg-primary')
    expect(endpoint).not.toHaveClass('dark:hover:bg-muted/50')
  }
)
