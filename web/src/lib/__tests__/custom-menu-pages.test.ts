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
import { describe, test } from 'node:test'

import {
  createCustomMenuPageId,
  parseCustomMenuPages,
} from '../custom-menu-pages'

describe('custom menu pages', () => {
  test('creates an id without requiring a secure browser context', () => {
    const id = createCustomMenuPageId()
    assert.match(id, /^[a-zA-Z0-9_-]{8,64}$/)
  })

  test('keeps valid public and admin menu pages in order', () => {
    const pages = parseCustomMenuPages(
      JSON.stringify([
        {
          id: 'page_public1',
          name: 'Help',
          url: 'https://example.com/help',
          visibility: 'public',
        },
        {
          id: 'page_admin01',
          name: 'Internal',
          url: 'https://example.com/admin',
          visibility: 'admin',
        },
      ])
    )

    assert.deepEqual(
      pages.map((page) => page.id),
      ['page_public1', 'page_admin01']
    )
  })

  test('drops malformed menu entries from API data', () => {
    assert.deepEqual(
      parseCustomMenuPages([
        { id: 'bad', name: 'Bad', url: 'javascript:alert(1)' },
      ]),
      []
    )
  })
})
