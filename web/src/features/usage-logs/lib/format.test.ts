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

import { describe, test } from 'vitest'

import type { LogOtherData } from '../types'
import {
  getAuditParamEntries,
  getLoginMethodLabel,
  getOptionKeyLabel,
  getSecondFactorMethodLabel,
  getUpstreamRequestIds,
  humanizeAuditIdentifier,
  isDuplicateLogDiagnosticMessage,
  renderAuditContent,
  uniqueLogDiagnosticMessages,
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
    assert.equal(getOptionKeyLabel('theme.frontend', t), 'Frontend Theme')
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

describe('usage log diagnostic formatting', () => {
  test('keeps upstream request IDs ordered and deduplicated', () => {
    assert.deepEqual(
      getUpstreamRequestIds(
        [' upstream-1 ', 'upstream-2', 'upstream-1'],
        'upstream-2'
      ),
      ['upstream-1', 'upstream-2']
    )
    assert.deepEqual(getUpstreamRequestIds(undefined, 'legacy-upstream'), [
      'legacy-upstream',
    ])
  })

  test('matches the same error with and without a status-code prefix', () => {
    assert.equal(
      isDuplicateLogDiagnosticMessage(
        'quota exhausted on AmazonQ',
        'status_code=500, quota exhausted on AmazonQ'
      ),
      true
    )
  })

  test('ignores an upstream request ID suffix when comparing errors', () => {
    assert.equal(
      isDuplicateLogDiagnosticMessage(
        'status_code=403, 用户额度不足, 剩余额度: ¥0.000000 (request id: 202607181326491410859398268d9d69m06ojET)',
        'status_code=403, 用户额度不足, 剩余额度: ¥0.000000'
      ),
      true
    )
  })

  test('removes multiple trailing request ID variants when comparing errors', () => {
    assert.equal(
      isDuplicateLogDiagnosticMessage(
        'status_code=500, upstream failed (request id: upstream-123) (request_id: proxy-456) (request-id: local-789)',
        'upstream failed'
      ),
      true
    )
  })

  test('keeps distinct stream errors and removes repeated messages', () => {
    assert.deepEqual(
      uniqueLogDiagnosticMessages(
        [
          'quota exhausted on AmazonQ',
          'status_code=500, quota exhausted on AmazonQ',
          'scanner stopped unexpectedly',
          'scanner stopped unexpectedly',
        ],
        'status_code=500, quota exhausted on AmazonQ'
      ),
      ['scanner stopped unexpectedly']
    )
  })
})
