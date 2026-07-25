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
  resolveRouteCooldownToggle,
  resolveSameChannelRetryToggle,
} from '../route-cooldown'

describe('channel route cooldown toggle', () => {
  test('disabling cooldown writes zero and remembers the active value', () => {
    assert.deepEqual(resolveRouteCooldownToggle(180, true, 60), {
      value: 0,
      lastEnabledSeconds: 180,
    })
  })

  test('enabling cooldown restores the last active value', () => {
    assert.deepEqual(resolveRouteCooldownToggle(0, false, 180), {
      value: 180,
      lastEnabledSeconds: 180,
    })
  })

  test('enabling without a valid remembered value uses the default', () => {
    assert.deepEqual(resolveRouteCooldownToggle(0, false, 0), {
      value: 60,
      lastEnabledSeconds: 60,
    })
  })
})

describe('same-channel retry toggle', () => {
  test('disabling retries writes zero and remembers the active value', () => {
    assert.deepEqual(resolveSameChannelRetryToggle(3, true, 1), {
      value: 0,
      lastEnabledRetries: 3,
    })
  })

  test('enabling retries restores the last active value', () => {
    assert.deepEqual(resolveSameChannelRetryToggle(0, false, 3), {
      value: 3,
      lastEnabledRetries: 3,
    })
  })

  test('enabling without a valid remembered value uses one retry', () => {
    assert.deepEqual(resolveSameChannelRetryToggle(0, false, 0), {
      value: 1,
      lastEnabledRetries: 1,
    })
  })
})
