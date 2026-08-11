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
  parseGroupList,
  parseGroupExclusions,
  serializeGroupList,
  serializeGroupExclusions,
} from '../route-exclusions'

describe('route exclusion settings', () => {
  test('upgrades legacy string rules as enabled rules', () => {
    assert.deepEqual(
      parseGroupExclusions(
        JSON.stringify({ default: 'same_channel_retry', premium: 'all' })
      ),
      {
        default: { mode: 'same_channel_retry', enabled: true },
        premium: { mode: 'all', enabled: true },
      }
    )
  })

  test('preserves disabled rules', () => {
    assert.deepEqual(
      parseGroupExclusions(
        JSON.stringify({
          default: { mode: 'next_channel', enabled: false },
        })
      ),
      {
        default: { mode: 'next_channel', enabled: false },
      }
    )
  })

  test('serializes individual enabled states', () => {
    assert.equal(
      serializeGroupExclusions({
        default: { mode: 'all', enabled: false },
      }),
      '{"default":{"mode":"all","enabled":false}}'
    )
  })

  test('normalizes cooldown exclusion group lists', () => {
    assert.deepEqual(parseGroupList('[" premium ","default","default"]'), [
      'default',
      'premium',
    ])
    assert.equal(
      serializeGroupList(['premium', 'default', 'premium']),
      '["default","premium"]'
    )
  })
})
