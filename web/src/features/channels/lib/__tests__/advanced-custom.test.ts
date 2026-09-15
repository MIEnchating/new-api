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
import { describe, expect, test } from 'vitest'

import { channelSchema, type AdvancedCustomConfig } from '../../types'
import {
  CHANNEL_TYPE_ADVANCED_CUSTOM,
  parseAdvancedCustomConfig,
  stringifyAdvancedCustomConfig,
  validateAdvancedCustomConfig,
} from '../advanced-custom'
import { getChannelConfigurationState } from '../channel-configuration'
import {
  transformChannelToFormDefaults,
  transformFormDataToUpdatePayload,
} from '../channel-form'

function advancedCustomChannel(passThrough: boolean) {
  return channelSchema.parse({
    id: 42,
    name: 'Native upstream',
    type: CHANNEL_TYPE_ADVANCED_CUSTOM,
    key: '',
    status: 1,
    created_time: 1,
    test_time: 0,
    response_time: 0,
    balance_updated_time: 0,
    models: 'native-model',
    group: 'default',
    setting: JSON.stringify({ pass_through_body_enabled: passThrough }),
    settings: JSON.stringify({
      advanced_custom: {
        advanced_routes: [
          {
            incoming_path: '/v1/chat/completions',
            upstream_path: 'https://upstream.example/v1/chat/completions',
            converter: 'none',
          },
        ],
      },
    }),
  })
}

describe('advanced custom pass-through compatibility', () => {
  test('renaming a legacy channel preserves channel-level pass-through and its configured indicator', () => {
    const channel = advancedCustomChannel(true)
    const form = transformChannelToFormDefaults(channel)
    const payload = transformFormDataToUpdatePayload(
      { ...form, name: 'Renamed upstream' },
      channel.id
    )

    expect(JSON.parse(payload.setting || '{}')).toMatchObject({
      pass_through_body_enabled: true,
    })
    expect(
      getChannelConfigurationState(form, {}, true).blocks.requestProcessing
    ).toBe('configured')
    expect(JSON.parse(payload.settings || '{}').advanced_custom).toEqual(
      JSON.parse(channel.settings).advanced_custom
    )
  })

  test('disabling legacy channel-level pass-through preserves enabled route flags', () => {
    const channel = advancedCustomChannel(true)
    const form = transformChannelToFormDefaults(channel)
    const config: AdvancedCustomConfig = {
      advanced_routes: [
        {
          incoming_path: '/v1/chat/completions',
          upstream_path: '/v1/chat/completions',
          converter: 'none',
          pass_through_body_enabled: true,
        },
      ],
    }
    const payload = transformFormDataToUpdatePayload(
      {
        ...form,
        pass_through_body_enabled: false,
        advanced_custom: stringifyAdvancedCustomConfig(config),
      },
      channel.id
    )

    expect(JSON.parse(payload.setting || '{}')).toMatchObject({
      pass_through_body_enabled: false,
    })
    expect(
      JSON.parse(payload.settings || '{}').advanced_custom.advanced_routes
    ).toEqual([expect.objectContaining({ pass_through_body_enabled: true })])
  })

  test('route flags survive JSON round trips without enabling other routes', () => {
    const config: AdvancedCustomConfig = {
      advanced_routes: [
        {
          incoming_path: '/v1/chat/completions',
          upstream_path: '/v1/chat/completions',
          converter: 'none',
          models: ['native-model'],
          pass_through_body_enabled: true,
        },
        {
          incoming_path: '/v1/chat/completions',
          upstream_path: '/v1/messages',
          converter: 'openai_chat_completions_to_anthropic_messages',
        },
      ],
    }

    expect(validateAdvancedCustomConfig(config)).toBeNull()
    expect(
      parseAdvancedCustomConfig(stringifyAdvancedCustomConfig(config))
    ).toEqual(config)
  })

  test.each([
    [
      '/v1/messages',
      'anthropic_messages_to_openai_chat_completions',
      '/v1/chat/completions',
    ],
    ['/v1/models', 'none', '/v1/models'],
    ['/v1/dashboard/billing/credit_grants', 'none', '/provider/balance'],
  ] as const)(
    'rejects pass-through for incompatible route %s',
    (incoming, converter, upstream) => {
      expect(
        validateAdvancedCustomConfig({
          advanced_routes: [
            {
              incoming_path: incoming,
              upstream_path: upstream,
              converter,
              pass_through_body_enabled: true,
            },
          ],
        })
      ).not.toBeNull()
    }
  )
})
