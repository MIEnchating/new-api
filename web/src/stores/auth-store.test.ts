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

import { test } from 'vitest'

import { useAuthStore } from './auth-store.ts'

test('auth reset removes both cached user and request identity', () => {
  const values = new Map<string, string>([
    ['user', JSON.stringify({ id: 42, username: 'stale-user' })],
    ['uid', '42'],
  ])
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  }
  const originalWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  })

  try {
    useAuthStore.getState().auth.reset()
    assert.equal(values.has('user'), false)
    assert.equal(values.has('uid'), false)
  } finally {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      })
    }
  }
})
