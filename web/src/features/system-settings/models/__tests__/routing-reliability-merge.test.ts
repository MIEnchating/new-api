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

import type { ReactElement } from 'react'
import { describe, test } from 'vitest'

import type { ModelSettings } from '../../types'
import { RoutingReliabilitySection } from '../routing-reliability-section'
import {
  MODELS_SECTION_IDS,
  getModelsSectionContent,
} from '../section-registry'

describe('routing reliability menu merge', () => {
  test('keeps routing reliability as the only routing settings menu', () => {
    assert.equal(MODELS_SECTION_IDS.includes('routing-reliability'), true)
    assert.equal(
      (MODELS_SECTION_IDS as readonly string[]).includes('channel-routing'),
      false
    )
  })

  test('passes channel routing settings to routing reliability', () => {
    const settings = {
      RetryTimes: 3,
      ChannelRouteCooldownEnabled: true,
      ChannelRouteCooldownSeconds: 60,
      ChannelRouteCooldownExcludedGroups: '["batch"]',
      ChannelRouteSameChannelRetries: 2,
      ChannelRouteGroupExclusionsEnabled: true,
      ChannelRouteGroupExclusions: '{"batch":{"mode":"all"}}',
      'request_error_routing_setting.enabled': true,
      'request_error_routing_setting.rules': '[]',
    } as ModelSettings

    const section = getModelsSectionContent(
      'routing-reliability',
      settings
    ) as ReactElement<{
      view: string
      defaultValues: {
        ChannelRouteCooldownEnabled: boolean
        ChannelRouteCooldownExcludedGroups: string
        ChannelRouteSameChannelRetries: number
        ChannelRouteGroupExclusionsEnabled: boolean
        ChannelRouteGroupExclusions: string
        'request_error_routing_setting.enabled': boolean
        'request_error_routing_setting.rules': string
      }
    }>

    assert.equal(section.type, RoutingReliabilitySection)
    assert.equal(section.props.view, 'routing')
    assert.equal(section.props.defaultValues.ChannelRouteCooldownEnabled, true)
    assert.equal(
      section.props.defaultValues.ChannelRouteCooldownExcludedGroups,
      '["batch"]'
    )
    assert.equal(section.props.defaultValues.ChannelRouteSameChannelRetries, 2)
    assert.equal(
      section.props.defaultValues.ChannelRouteGroupExclusionsEnabled,
      true
    )
    assert.equal(
      section.props.defaultValues.ChannelRouteGroupExclusions,
      '{"batch":{"mode":"all"}}'
    )
    assert.equal(
      section.props.defaultValues['request_error_routing_setting.enabled'],
      true
    )
    assert.equal(
      section.props.defaultValues['request_error_routing_setting.rules'],
      '[]'
    )

    const customErrorSection = getModelsSectionContent(
      'custom-error-responses',
      settings
    ) as ReactElement
    assert.equal(section.key, 'routing-reliability')
    assert.equal(customErrorSection.key, 'custom-error-responses')
    assert.notEqual(section.key, customErrorSection.key)
  })
})
