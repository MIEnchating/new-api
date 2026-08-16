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

import type { TFunction } from 'i18next'
import { describe, test } from 'vitest'

import {
  createRoutingReliabilitySchema,
  optionShouldBeSaved,
} from '../routing-reliability-section'

const translate = ((key: string, options?: { number?: number }) =>
  key.replace('{{number}}', String(options?.number ?? ''))) as TFunction

function values() {
  return {
    RetryTimes: 2,
    ChannelRouteCooldownEnabled: true,
    ChannelRouteCooldownSeconds: 60,
    ChannelRouteCooldownExcludedGroups: '[]',
    ChannelRouteSameChannelRetries: 2,
    ChannelRouteGroupExclusionsEnabled: false,
    ChannelRouteGroupExclusions: '{}',
    ChannelDisableThreshold: '',
    AutomaticDisableChannelEnabled: false,
    AutomaticEnableChannelEnabled: false,
    AutomaticDisableKeywords: '',
    AutomaticDisableStatusCodes: '401',
    AutomaticRetryStatusCodes: '500-599',
    monitor_setting: {
      auto_test_channel_enabled: false,
      auto_test_channel_minutes: 10,
      channel_test_mode: 'scheduled_all' as const,
    },
    error_response_setting: {
      enabled: false,
      rules: [
        {
          name: '',
          description: '',
          priority: 0,
          enabled: true,
          match_mode: 'any' as const,
          status_codes: '',
          message_contains: '',
          message_match_mode: 'contains' as const,
          response_status_code: 500,
          response_message: '',
          pass_through_status_code: false,
          pass_through_message: false,
        },
      ],
    },
    request_error_routing_setting: {
      enabled: false,
      rules: '{invalid json',
    },
  }
}

describe('routing reliability view validation', () => {
  test('saves only options owned by the visible and enabled feature', () => {
    const enabled = {
      'error_response_setting.enabled': true,
      'request_error_routing_setting.enabled': true,
    }
    assert.equal(
      optionShouldBeSaved('RetryTimes', 'custom-errors', enabled),
      false
    )
    assert.equal(
      optionShouldBeSaved(
        'error_response_setting.rules',
        'custom-errors',
        enabled
      ),
      true
    )
    assert.equal(
      optionShouldBeSaved('error_response_setting.rules', 'routing', enabled),
      false
    )
    assert.equal(
      optionShouldBeSaved('request_error_routing_setting.rules', 'routing', {
        ...enabled,
      }),
      false
    )
  })

  test('does not validate disabled or hidden rule sets', () => {
    assert.equal(
      createRoutingReliabilitySchema('routing', translate).safeParse(values())
        .success,
      true
    )
    assert.equal(
      createRoutingReliabilitySchema('custom-errors', translate).safeParse({
        ...values(),
        RetryTimes: 99,
        ChannelRouteCooldownSeconds: -1,
        ChannelRouteSameChannelRetries: 99,
        ChannelDisableThreshold: '-1',
        AutomaticDisableStatusCodes: 'invalid',
        AutomaticRetryStatusCodes: 'invalid',
        monitor_setting: {
          ...values().monitor_setting,
          auto_test_channel_minutes: 0,
        },
        request_error_routing_setting: {
          enabled: true,
          rules: '{invalid json',
        },
      }).success,
      true
    )
  })

  test('ignores legacy request routing rules and validates custom responses', () => {
    assert.equal(
      createRoutingReliabilitySchema('routing', translate).safeParse({
        ...values(),
        request_error_routing_setting: {
          enabled: true,
          rules: '{invalid json',
        },
      }).success,
      true
    )
    assert.equal(
      createRoutingReliabilitySchema('custom-errors', translate).safeParse({
        ...values(),
        error_response_setting: {
          ...values().error_response_setting,
          enabled: true,
        },
      }).success,
      false
    )
  })
})
