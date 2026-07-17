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

import type { LogOtherData } from '../types'
import {
  getAuditParamEntries,
  getLoginMethodLabel,
  getOptionKeyLabel,
  getSecondFactorMethodLabel,
  humanizeAuditIdentifier,
  renderAuditContent,
} from './format'

const t = (key: string, opts: Record<string, unknown> = {}) =>
  key.replaceAll(/\{\{(\w+)\}\}/g, (match, name: string) =>
    opts[name] == null ? match : String(opts[name])
  )

function operation(
  action: string,
  params: NonNullable<NonNullable<LogOtherData['op']>['params']> = {}
): LogOtherData {
  return { op: { action, params } }
}

describe('usage log audit formatting', () => {
  test('renders every manually recorded audit action with a readable template', () => {
    const cases: Array<[string, LogOtherData]> = [
      [
        'Updated cache hit-rate baseline to 75%',
        operation('cache_hit_rate_baseline.update', { baseline: 75 }),
      ],
      [
        'Updated cache monitoring groups: alpha, beta',
        operation('cache_monitor_groups.update', {
          all_groups: false,
          group_count: 2,
          display_groups: ['alpha', 'beta'],
        }),
      ],
      [
        'Restored route availability for channel (ID: 9) in groups alpha, beta',
        operation('channel.route_cooldown_clear', {
          id: 9,
          groups: ['alpha', 'beta'],
        }),
      ],
      [
        'Updated channel 9 status to Disabled',
        operation('channel.status_update', { id: 9, status: 2 }),
      ],
      [
        'Updated 3 of 4 channels to Enabled',
        operation('channel.status_update_batch', {
          count: 3,
          total: 4,
          status: 1,
        }),
      ],
      [
        'Started upstream model detection task task-1',
        operation('channel.upstream_detect_all', { task_id: 'task-1' }),
      ],
      [
        'Reset 5 subscriptions for plan Pro',
        operation('subscription.plan_reset', {
          reset_count: 5,
          plan_title: 'Pro',
        }),
      ],
      [
        'Reset 1 subscriptions for user 42 on plan Pro',
        operation('subscription.user_plan_reset', {
          reset_count: 1,
          target_user_id: 42,
          plan_title: 'Pro',
        }),
      ],
    ]

    for (const [expected, other] of cases) {
      assert.equal(renderAuditContent(other, t), expected)
    }
  })

  test('uses friendly labels for login methods, second factors, and option keys', () => {
    assert.equal(getLoginMethodLabel('password', t), 'Password')
    assert.equal(getLoginMethodLabel('2fa', t), 'Two-factor authentication')
    assert.equal(getLoginMethodLabel('oauth:github', t), 'OAuth (github)')
    assert.equal(getSecondFactorMethodLabel('backup_code', t), 'Backup code')
    assert.equal(
      getOptionKeyLabel('ChannelRouteCooldownEnabled', t),
      'Channel routing'
    )
    assert.equal(
      renderAuditContent(
        operation('option.update', { key: 'ChannelRouteStickyEnabled' }),
        t
      ),
      'Updated system setting Channel route stickiness'
    )
    assert.deepEqual(
      getAuditParamEntries(
        operation('option.update', {
          key: 'ChannelRouteStickyEnabled',
          from: 'false',
          to: 'true',
        }),
        t
      ),
      [
        {
          key: 'key',
          label: 'Setting',
          value: 'Channel route stickiness (ChannelRouteStickyEnabled)',
        },
        { key: 'from', label: 'Previous value', value: 'Disabled' },
        { key: 'to', label: 'New value', value: 'Enabled' },
      ]
    )
  })

  test('keeps unknown actions readable and exposes their structured params', () => {
    const other = operation('future_feature.rollout_started', {
      all_groups: true,
      groups: ['alpha', 'beta'],
      changed: false,
    })

    assert.equal(
      renderAuditContent(other, t),
      'Performed operation Future feature rollout started'
    )
    assert.equal(
      humanizeAuditIdentifier('future_feature.rollout_started'),
      'Future feature rollout started'
    )
    assert.deepEqual(getAuditParamEntries(other, t), [
      { key: 'all_groups', label: 'All groups', value: 'Yes' },
      { key: 'groups', label: 'Groups', value: 'alpha, beta' },
      { key: 'changed', label: 'Changed', value: 'No' },
    ])
  })
})
