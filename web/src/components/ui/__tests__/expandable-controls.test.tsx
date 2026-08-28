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
import { describe, expect, test } from 'vitest'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../accordion'
import { ComboboxInput } from '../combobox-input'

describe('global expandable controls', () => {
  test('uses one rotating arrow and no press scaling for accordion triggers', () => {
    render(
      <Accordion>
        <AccordionItem value='one'>
          <AccordionTrigger>Details</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    )

    const trigger = screen.getByRole('button', { name: 'Details' })
    const icons = trigger.querySelectorAll(
      '[data-slot="accordion-trigger-icon"]'
    )
    expect(trigger).toHaveAttribute('data-press-animation', 'none')
    expect(icons).toHaveLength(1)
    expect(icons[0]).toHaveClass(
      'group-aria-expanded/accordion-trigger:rotate-180'
    )

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  test('turns the input combobox arrow upward while open', () => {
    render(
      <ComboboxInput
        options={[{ value: 'one', label: 'One' }]}
        value='one'
        onValueChange={() => undefined}
      />
    )

    const input = screen.getByRole('combobox')
    const root = document.querySelector('[data-slot="combobox-input-root"]')
    const icon = document.querySelector('[data-slot="combobox-input-icon"]')
    expect(root).toHaveClass('w-full', 'min-w-0')
    expect(icon).not.toHaveClass('rotate-180')

    fireEvent.focus(input)
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(icon).toHaveClass('rotate-180')
  })
})
