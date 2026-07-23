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
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

import { DEFAULT_LOGO } from '../constants'
import { normalizeSystemLogo } from '../system-branding'

describe('system branding', () => {
  test('uses the local logo when no logo is configured', () => {
    assert.equal(normalizeSystemLogo(undefined), DEFAULT_LOGO)
    assert.equal(normalizeSystemLogo('  '), DEFAULT_LOGO)
  })

  test('preserves a configured Yunmian icon', () => {
    assert.equal(
      normalizeSystemLogo('https://yunmian.tech/icon'),
      'https://yunmian.tech/icon'
    )
  })

  test('canonicalizes remote copies of the local default logo', () => {
    assert.equal(
      normalizeSystemLogo('https://www.yunmian.tech/logo.png'),
      DEFAULT_LOGO
    )
  })

  test('preserves another custom logo URL', () => {
    const customLogo = 'https://assets.example.com/custom-logo.png'
    assert.equal(normalizeSystemLogo(customLogo), customLogo)
  })

  test('shows a logo-free loading indicator before React mounts', () => {
    const indexHtml = readFileSync(
      new URL('../../../index.html', import.meta.url),
      'utf8'
    )

    assert.match(indexHtml, /id="app-bootstrap-mark"/)
    assert.match(indexHtml, /app-bootstrap-wave/)
    assert.match(indexHtml, /span:nth-child\(7\)/)
    assert.doesNotMatch(indexHtml, /<img[^>]+loading-logo/)
  })
})
