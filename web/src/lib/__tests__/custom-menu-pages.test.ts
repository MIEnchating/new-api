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

import { describe, expect, test } from 'vitest'

import {
  createCustomMenuPageId,
  parseCustomMenuPages,
  resolveCustomMenuPageUrl,
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
    assert.deepEqual(
      pages.map((page) => page.enabled),
      [true, true]
    )
    assert.deepEqual(
      pages.map((page) => page.openMode),
      ['iframe', 'iframe']
    )
  })

  test('preserves the external link opening method', () => {
    const pages = parseCustomMenuPages([
      {
        id: 'page_external',
        name: 'Documentation',
        url: 'https://example.com/docs',
        visibility: 'public',
        openMode: 'external',
      },
    ])

    assert.equal(pages[0]?.openMode, 'external')
  })

  test('resolves the current origin placeholder in external URLs', () => {
    const url = 'https://image.example.com/auth/sso/start?issuer={origin}'

    assert.equal(
      resolveCustomMenuPageUrl(url, 'https://example.com'),
      'https://image.example.com/auth/sso/start?issuer=https://example.com'
    )
    assert.equal(
      resolveCustomMenuPageUrl(url, 'https://www.example.com'),
      'https://image.example.com/auth/sso/start?issuer=https://www.example.com'
    )
  })

  test('preserves an explicitly disabled menu page', () => {
    const pages = parseCustomMenuPages([
      {
        id: 'page_disabled',
        name: 'Paused',
        url: 'https://example.com/paused',
        visibility: 'public',
        enabled: false,
      },
    ])

    assert.equal(pages[0]?.enabled, false)
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

describe('custom menu icon parsing', () => {
  test.each([
    'https://api.iconify.design/lucide/image-plus.svg?color=%23a1a1aa',
    'http://example.com/icon.png',
    'data:image/svg+xml;base64,PHN2Zy8+',
    '',
    undefined,
  ])('preserves a menu with supported icon %s', (icon) => {
    const pages = parseCustomMenuPages([
      {
        id: 'page_icons01',
        name: 'Help',
        url: 'https://example.com/help',
        visibility: 'public',
        icon,
      },
    ])
    expect(pages).toHaveLength(1)
    expect(pages[0].icon).toBe(icon)
  })

  test.each([
    '/icon.svg',
    '//example.com/icon.svg',
    'https:///icon.svg',
    'javascript:alert(1)',
    'file:///icon.svg',
    'data:text/html;base64,PHNjcmlwdD4=',
    `https://example.com/${'a'.repeat(32 * 1024)}`,
  ])('rejects a menu with unsupported icon %s', (icon) => {
    expect(
      parseCustomMenuPages([
        {
          id: 'page_icons01',
          name: 'Help',
          url: 'https://example.com/help',
          visibility: 'public',
          icon,
        },
      ])
    ).toEqual([])
  })
})
