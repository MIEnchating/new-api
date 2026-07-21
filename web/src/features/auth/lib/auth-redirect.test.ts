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

import type { AuthBundle, AuthUser } from '@/stores/auth-store'

import {
  completeAuthenticationRedirect,
  getSavedLanguage,
  sanitizeAuthRedirect,
} from './auth-redirect'

const origin = 'https://dashboard.example.com'

function buildAuthBundle(language: string): AuthBundle {
  return {
    access_token: 'access-token',
    token_type: 'Bearer',
    access_expires_at: 2_000_000_000,
    user: { id: 1, username: 'user', role: 1, language },
    session: {
      sid: 'session-id',
      current: true,
      login_method: 'password',
      ip: '127.0.0.1',
      user_agent: 'test',
      created_at: 1,
      last_active_at: 1,
      expires_at: 2_000_000_000,
    },
  }
}

describe('authentication redirect validation', () => {
  test('preserves safe internal paths, search parameters, and fragments', () => {
    assert.equal(
      sanitizeAuthRedirect('/console?tab=usage#recent', origin),
      '/console?tab=usage#recent'
    )
    assert.equal(
      sanitizeAuthRedirect(
        'https://dashboard.example.com/dashboard?tab=quota#daily',
        origin
      ),
      '/dashboard?tab=quota#daily'
    )
  })

  test('rejects external and ambiguously parsed redirect targets', () => {
    const unsafeTargets: unknown[] = [
      undefined,
      '',
      'dashboard',
      '//attacker.example/path',
      'https://attacker.example/path',
      'javascript:alert(1)',
      '/\\attacker.example/path',
      'https:\\attacker.example/path',
    ]

    for (const target of unsafeTargets) {
      assert.equal(sanitizeAuthRedirect(target, origin), null)
    }
  })

  test('rejects invalid or non-HTTP application origins', () => {
    assert.equal(sanitizeAuthRedirect('/dashboard', 'not-an-origin'), null)
    assert.equal(sanitizeAuthRedirect('/dashboard', 'file:///tmp/app'), null)
  })
})

describe('saved authentication language', () => {
  const user: AuthUser = { id: 1, username: 'user', role: 1 }

  test('prefers the explicit user language', () => {
    assert.equal(
      getSavedLanguage({
        ...user,
        language: 'ja',
        setting: { language: 'fr' },
      }),
      'ja'
    )
  })

  test('reads object and JSON string settings', () => {
    assert.equal(
      getSavedLanguage({ ...user, setting: { language: 'fr' } }),
      'fr'
    )
    assert.equal(
      getSavedLanguage({ ...user, setting: '{"language":"ru"}' }),
      'ru'
    )
  })

  test('ignores malformed and non-string setting languages', () => {
    assert.equal(getSavedLanguage({ ...user, setting: '{' }), undefined)
    assert.equal(
      getSavedLanguage({ ...user, setting: { language: 123 } }),
      undefined
    )
  })
})

describe('successful authentication redirect', () => {
  test('starts navigation before scheduling a saved language change', async () => {
    const events: string[] = []
    const bundle = buildAuthBundle('zh-CN')

    const target = await completeAuthenticationRedirect({
      bundle,
      redirectTo: '/usage-logs/common',
      origin,
      currentLanguage: 'en',
      applyBundle: () => events.push('bundle'),
      navigate: (path) => {
        events.push(`navigate:${path}`)
      },
      scheduleLanguageChange: (language) => events.push(`language:${language}`),
    })

    assert.equal(target, '/usage-logs/common')
    assert.deepEqual(events, [
      'bundle',
      'navigate:/usage-logs/common',
      'language:zh-CN',
    ])
  })

  test('does not wait for the language request before completing navigation', async () => {
    let resolveNavigation!: () => void
    const navigation = new Promise<void>((resolve) => {
      resolveNavigation = resolve
    })
    let languageFinished = false
    const languageRequest = new Promise<void>(() => {})
    const bundle = buildAuthBundle('ja')

    const completion = completeAuthenticationRedirect({
      bundle,
      origin,
      currentLanguage: 'en',
      applyBundle: () => {},
      navigate: () => navigation,
      scheduleLanguageChange: () => {
        void languageRequest.then(() => {
          languageFinished = true
        })
      },
    })
    resolveNavigation()

    assert.equal(await completion, '/dashboard')
    assert.equal(languageFinished, false)
  })
})
