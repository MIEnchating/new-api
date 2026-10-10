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
import { THEME_STORAGE_KEYS } from '../theme-storage'

function initializeBootstrapTheme(options: {
  cookie?: string
  systemDark: boolean
  mode?: string
  preset?: string
  storageUnavailable?: boolean
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
      return options.cookie ?? ''
    },
  })

  runInNewContext(initializer?.textContent ?? '', {
    document,
    window: {
      matchMedia: () => ({ matches: options.systemDark }),
      localStorage: {
        getItem(key: string) {
          if (options.storageUnavailable) throw new Error('Storage unavailable')
          if (key === THEME_STORAGE_KEYS.mode) return options.mode ?? null
          if (key === THEME_STORAGE_KEYS.preset) return options.preset ?? null
          return null
        },
      },
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
    { mode: 'light', systemDark: true, expected: 'light' },
    { mode: 'dark', systemDark: false, expected: 'dark' },
    { mode: 'system', systemDark: true, expected: 'dark' },
    { mode: 'system', systemDark: false, expected: 'light' },
    { mode: 'invalid', systemDark: true, expected: 'dark' },
    { mode: undefined, systemDark: false, expected: 'light' },
  ])(
    'uses $expected before React mounts with saved mode "$mode" and systemDark=$systemDark',
    ({ mode, systemDark, expected }) => {
      const document = initializeBootstrapTheme({ mode, systemDark })

      expect(document.documentElement.classList.contains(expected)).toBe(true)
      expect(
        document.documentElement.classList.contains(
          expected === 'dark' ? 'light' : 'dark'
        )
      ).toBe(false)
    }
  )

  test.each(['light', undefined])(
    'ignores legacy dark cookies when the local mode is %s',
    (mode) => {
      const document = initializeBootstrapTheme({
        cookie: 'vite-ui-theme=dark; theme_preset=ocean-breeze',
        mode,
        systemDark: false,
      })

      expect(document.documentElement.classList.contains('light')).toBe(true)
      expect(document.body.hasAttribute('data-theme-preset')).toBe(false)
    }
  )

  test('applies the saved color preset before React mounts', () => {
    const document = initializeBootstrapTheme({
      cookie: 'theme_preset=rose-garden',
      preset: 'ocean-breeze',
      systemDark: false,
    })

    expect(document.body.getAttribute('data-theme-preset')).toBe('ocean-breeze')
  })

  test.each(['ocean-breeze%22%20invalid', 'unknown-preset', 'default'])(
    'ignores invalid saved preset %s before React mounts',
    (preset) => {
      const document = initializeBootstrapTheme({
        preset,
        systemDark: false,
      })

      expect(document.body.hasAttribute('data-theme-preset')).toBe(false)
    }
  )

  test('uses the system theme when local storage is unavailable', () => {
    const document = initializeBootstrapTheme({
      systemDark: true,
      storageUnavailable: true,
    })

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.body.hasAttribute('data-theme-preset')).toBe(false)
  })
})
