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

import { t } from 'i18next'

import {
  API_KEY_FORM_DEFAULT_VALUES,
  getApiKeyFormSchema,
} from './api-key-form'

const schema = getApiKeyFormSchema(t)

describe('API key form schema', () => {
  test('ignores hidden route constraints when group routing is disabled', () => {
    const result = schema.safeParse({
      ...API_KEY_FORM_DEFAULT_VALUES,
      name: 'test-key',
      group_route_enabled: false,
      group_routes: [
        { group: '', priority: -1, cooldown_seconds: 0 },
        { group: '', priority: -1, cooldown_seconds: 31536001 },
      ],
    })

    assert.equal(result.success, true)
  })

  test('validates route constraints when group routing is enabled', () => {
    const result = schema.safeParse({
      ...API_KEY_FORM_DEFAULT_VALUES,
      name: 'test-key',
      group_route_enabled: true,
      group_routes: [
        { group: 'default', priority: -1, cooldown_seconds: 0 },
        { group: 'default', priority: 1, cooldown_seconds: 31536001 },
      ],
    })

    assert.equal(result.success, false)
    if (result.success) return

    const issuePaths = new Set(
      result.error.issues.map((issue) => issue.path.join('.'))
    )
    assert.equal(issuePaths.has('group_routes.0.priority'), true)
    assert.equal(issuePaths.has('group_routes.0.cooldown_seconds'), true)
    assert.equal(issuePaths.has('group_routes.1.group'), true)
    assert.equal(issuePaths.has('group_routes.1.cooldown_seconds'), true)
  })
})
