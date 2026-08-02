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
  canDisableGroupRoute,
  canConfigureGroupRouteCooldown,
  getApiKeyFormDefaultValues,
  getAutomaticGroupRoutePriorities,
  getApiKeyFormSchema,
  parseApiKeyGroupRouteConfig,
  transformFormDataToPayload,
} from './api-key-form'

const schema = getApiKeyFormSchema(t)

describe('API key form schema', () => {
  test('does not preselect a group for new keys or route rows', () => {
    const defaults = getApiKeyFormDefaultValues()

    assert.equal(defaults.group, '')
    assert.equal(defaults.cross_group_retry, false)
    assert.equal(defaults.group_routes?.[0]?.group, '')
    assert.equal(defaults.group_routes?.[0]?.enabled, true)
  })

  test('ignores hidden route constraints when group routing is disabled', () => {
    const result = schema.safeParse({
      ...API_KEY_FORM_DEFAULT_VALUES,
      name: 'test-key',
      group: 'default',
      group_route_enabled: false,
      group_routes: [
        { group: '', priority: -1, cooldown_seconds: 0 },
        { group: '', priority: -1, cooldown_seconds: 31536001 },
      ],
    })

    assert.equal(result.success, true)
  })

  test('requires a group when group routing is disabled', () => {
    const result = schema.safeParse({
      ...API_KEY_FORM_DEFAULT_VALUES,
      name: 'test-key',
      group: '',
      group_route_enabled: false,
    })

    assert.equal(result.success, false)
    if (result.success) return
    assert.equal(
      result.error.issues.some((issue) => issue.path.join('.') === 'group'),
      true
    )
  })

  test('validates route constraints when group routing is enabled', () => {
    const result = schema.safeParse({
      ...API_KEY_FORM_DEFAULT_VALUES,
      name: 'test-key',
      group_route_enabled: true,
      group_routes: [
        { group: 'default', priority: -1, cooldown_seconds: -1 },
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

  test('allows zero to disable group route cooldown', () => {
    const result = schema.safeParse({
      ...API_KEY_FORM_DEFAULT_VALUES,
      name: 'test-key',
      group_route_enabled: true,
      group_routes: [{ group: 'default', priority: 1, cooldown_seconds: 0 }],
    })

    assert.equal(result.success, true)
  })

  test('assigns automatic priorities from the list length down to one', () => {
    assert.deepEqual(getAutomaticGroupRoutePriorities(3), [3, 2, 1])
    assert.deepEqual(getAutomaticGroupRoutePriorities(1), [1])
    assert.deepEqual(getAutomaticGroupRoutePriorities(0), [])
  })

  test('enables cooldown for two enabled route rows before groups are selected', () => {
    assert.equal(
      canConfigureGroupRouteCooldown([
        { group: '', priority: 2, cooldown_seconds: 60, enabled: true },
        { group: '', priority: 1, cooldown_seconds: 60, enabled: true },
      ]),
      true
    )
    assert.equal(
      canConfigureGroupRouteCooldown([
        { group: 'primary', priority: 2, cooldown_seconds: 60, enabled: true },
        {
          group: 'fallback',
          priority: 1,
          cooldown_seconds: 60,
          enabled: false,
        },
      ]),
      false
    )
    assert.equal(
      canConfigureGroupRouteCooldown([
        { group: 'primary', priority: 2, cooldown_seconds: 60, enabled: true },
        { group: 'fallback', priority: 1, cooldown_seconds: 60 },
      ]),
      true
    )
  })

  test('keeps at least one route enabled in the quick route editor', () => {
    const routes = [
      { group: 'primary', priority: 2, cooldown_seconds: 60, enabled: true },
      { group: 'fallback', priority: 1, cooldown_seconds: 60, enabled: true },
    ]

    assert.equal(canDisableGroupRoute(routes, 0), true)
    const oneEnabledRoute = routes.map((route, index) => ({
      ...route,
      enabled: index === 0 ? false : route.enabled,
    }))
    assert.equal(canDisableGroupRoute(oneEnabledRoute, 1), false)
    assert.equal(canDisableGroupRoute(oneEnabledRoute, 0), true)
  })

  test('requires one enabled route group when group routing is enabled', () => {
    const result = schema.safeParse({
      ...API_KEY_FORM_DEFAULT_VALUES,
      name: 'test-key',
      group_route_enabled: true,
      group_routes: [
        {
          group: 'default',
          priority: 1,
          cooldown_seconds: 60,
          enabled: false,
        },
      ],
    })

    assert.equal(result.success, false)
    if (result.success) return
    assert.equal(
      result.error.issues.some(
        (issue) => issue.path.join('.') === 'group_routes'
      ),
      true
    )
  })

  test('treats legacy routes as enabled and preserves disabled routes', () => {
    const legacyRoutes = parseApiKeyGroupRouteConfig(
      '[{"group":"default","priority":1,"cooldown_seconds":60}]'
    )
    assert.equal(legacyRoutes[0]?.enabled, true)

    const payload = transformFormDataToPayload({
      ...API_KEY_FORM_DEFAULT_VALUES,
      name: 'test-key',
      group_route_enabled: true,
      group_routes: [
        {
          group: 'default',
          priority: 1,
          cooldown_seconds: 60,
          enabled: false,
        },
        {
          group: 'fallback',
          priority: 0,
          cooldown_seconds: 60,
          enabled: true,
        },
      ],
    })
    const storedRoutes = JSON.parse(payload.group_route_config) as Array<{
      enabled: boolean
    }>

    assert.equal(storedRoutes[0]?.enabled, false)
    assert.equal(storedRoutes[1]?.enabled, true)
  })
})
