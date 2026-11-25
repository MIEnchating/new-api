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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from 'vitest'

test.each([
  {
    name: 'shared cards',
    filename: 'index.css',
    card: /\[data-slot=['"]card['"]\]/,
  },
  { name: 'home entry cards', filename: 'home.css', card: /\.home-entry\b/ },
])('keeps $name stationary on hover', ({ filename, card }) => {
  const styles = readFileSync(resolve('src/styles', filename), 'utf8')
  const hoverEffects = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(
      ([, selector, declarations]) =>
        card.test(selector) &&
        selector.includes(':hover') &&
        /(?:^|;)\s*(?:transform|translate|scale|box-shadow)\s*:/.test(
          declarations
        )
    )
    .map(([, selector]) => selector.trim())

  expect(hoverEffects).toEqual([])
})
