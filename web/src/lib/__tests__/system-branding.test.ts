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
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, test } from 'vitest'

import { DEFAULT_LOGO } from '../constants'
import { normalizeSystemLogo } from '../system-branding'

function initializeBootstrapTheme(options: {
  cookie?: string
  systemDark: boolean
  cookiesUnavailable?: boolean
}): Document {
  const indexHtml = readFileSync(resolve('index.html'), 'utf8')
  const document = new DOMParser().parseFromString(indexHtml, 'text/html')
  const initializer = document.querySelector('#app-bootstrap-theme')

  expect(
    initializer,
    'the theme initializes before the loader is displayed'
  ).not.toBeNull()
  expect(document.body.firstElementChild).toBe(initializer)

  Object.defineProperty(document, 'cookie', {
    get() {
      if (options.cookiesUnavailable) throw new Error('Cookies unavailable')
      return options.cookie ?? ''
    },
  })

  runInNewContext(initializer?.textContent ?? '', {
    document,
    window: {
      matchMedia: () => ({ matches: options.systemDark }),
    },
  })

  return document
}

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
    const indexHtml = readFileSync(resolve('index.html'), 'utf8')
    const document = new DOMParser().parseFromString(indexHtml, 'text/html')
    const bootstrap = document.querySelector('#root #app-bootstrap')
    const progress = bootstrap?.querySelector('#app-bootstrap-progress')
    const spinner = bootstrap?.querySelector('#app-bootstrap-mark')

    expect(bootstrap).not.toBeNull()
    expect(spinner).not.toBeNull()
    expect(spinner?.getAttribute('aria-hidden')).toBe('true')
    expect(bootstrap?.querySelector('img')).toBeNull()
    expect(progress).not.toBeNull()
    expect(progress?.getAttribute('role')).toBe('progressbar')
    expect(progress?.getAttribute('aria-label')).toBe('Loading')
    expect(progress?.closest('[aria-hidden="true"]')).toBeNull()
    expect(progress?.hasAttribute('aria-valuenow')).toBe(false)
    expect(progress?.textContent).not.toMatch(/\d+%/)
  })

  test.each([
    { cookie: 'vite-ui-theme=light', systemDark: true, expected: 'light' },
    { cookie: 'vite-ui-theme=dark', systemDark: false, expected: 'dark' },
    { cookie: 'vite-ui-theme=system', systemDark: true, expected: 'dark' },
    { cookie: 'vite-ui-theme=system', systemDark: false, expected: 'light' },
    { cookie: 'vite-ui-theme=invalid', systemDark: true, expected: 'dark' },
    { cookie: 'vite-ui-theme=%E0%A4%A', systemDark: true, expected: 'dark' },
    { cookie: '', systemDark: false, expected: 'light' },
  ])(
    'uses $expected before React mounts with cookie "$cookie" and systemDark=$systemDark',
    ({ cookie, systemDark, expected }) => {
      const document = initializeBootstrapTheme({ cookie, systemDark })

      expect(document.documentElement.classList.contains(expected)).toBe(true)
      expect(
        document.documentElement.classList.contains(
          expected === 'dark' ? 'light' : 'dark'
        )
      ).toBe(false)
    }
  )

  test('applies the saved color preset before React mounts', () => {
    const document = initializeBootstrapTheme({
      cookie: 'vite-ui-theme=dark; theme_preset=ocean-breeze',
      systemDark: false,
    })

    expect(document.body.getAttribute('data-theme-preset')).toBe('ocean-breeze')
  })

  test.each(['ocean-breeze%22%20invalid', 'unknown-preset'])(
    'ignores invalid saved preset %s before React mounts',
    (preset) => {
      const document = initializeBootstrapTheme({
        cookie: `theme_preset=${preset}`,
        systemDark: false,
      })

      expect(document.body.hasAttribute('data-theme-preset')).toBe(false)
    }
  )

  test('uses the system theme when cookies are unavailable', () => {
    const document = initializeBootstrapTheme({
      systemDark: true,
      cookiesUnavailable: true,
    })

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.body.hasAttribute('data-theme-preset')).toBe(false)
  })
})
