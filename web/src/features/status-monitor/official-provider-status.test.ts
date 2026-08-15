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
  formatComponentStatus,
  formatIncidentStatus,
  formatOfficialTime,
  getActiveOfficialIncidents,
  getAffectedOfficialComponents,
  getEffectiveOfficialIndicator,
  isOfficialProviderAffected,
} from './official-provider-status-utils'
import type { OfficialProviderStatus } from './types'

const translate = ((key: string) => {
  const translations: Record<string, string> = {
    Identified: '问题已定位',
    Investigating: '正在调查',
    Monitoring: '持续监控',
    Resolved: '已解决',
  }
  return translations[key] ?? key
}) as TFunction

function createProvider(
  overrides: Partial<OfficialProviderStatus> = {}
): OfficialProviderStatus {
  return {
    provider: 'OpenAI',
    available: true,
    indicator: 'none',
    description: 'All Systems Operational',
    status_url: 'https://status.example.com',
    subscribe_url: '',
    checked_at: '2026-07-17T00:00:00Z',
    components: [],
    incidents: [],
    ...overrides,
  }
}

function createIncident(status: string, impact: string) {
  return {
    name: 'API errors',
    status,
    impact,
    message: '',
    updated_at: '2026-07-17T00:00:00Z',
    url: '',
    components: [],
  }
}

describe('official provider status formatting', () => {
  test('translates standard incident states', () => {
    assert.equal(formatIncidentStatus('identified', translate), '问题已定位')
    assert.equal(formatIncidentStatus('investigating', translate), '正在调查')
    assert.equal(formatIncidentStatus('monitoring', translate), '持续监控')
    assert.equal(formatIncidentStatus('resolved', translate), '已解决')
  })

  test('keeps unknown incident states readable', () => {
    assert.equal(
      formatIncidentStatus('custom_state', translate),
      'Custom state'
    )
  })

  test('formats official component states', () => {
    assert.equal(formatComponentStatus('operational', translate), 'Operational')
    assert.equal(
      formatComponentStatus('degraded_performance', translate),
      'Degraded performance'
    )
  })

  test('formats simplified Chinese dates in year-month-day order', () => {
    const formatted = formatOfficialTime('2026-07-16T16:36:46Z', 'zh-CN')

    assert.match(formatted, /^2026[/-]07[/-]16/)
    assert.ok(formatted.includes('16:36:46'))
  })

  test('uses the selected locale instead of the runtime default', () => {
    const formatted = formatOfficialTime('2026-07-16T16:36:46Z', 'en-US')

    assert.match(formatted, /^07[/-]16[/-]2026/)
  })

  test('treats an active incident as affected when the summary says none', () => {
    const provider = createProvider({
      incidents: [createIncident('identified', 'none')],
    })

    assert.equal(getEffectiveOfficialIndicator(provider), 'minor')
    assert.equal(isOfficialProviderAffected(provider), true)
    assert.equal(getActiveOfficialIncidents(provider).length, 1)
  })

  test('uses the highest active incident impact', () => {
    const provider = createProvider({
      incidents: [
        createIncident('investigating', 'minor'),
        createIncident('identified', 'major'),
      ],
    })

    assert.equal(getEffectiveOfficialIndicator(provider), 'major')
  })

  test('does not let a declared minor state hide a critical incident', () => {
    const provider = createProvider({
      indicator: 'minor',
      incidents: [createIncident('investigating', 'critical')],
    })

    assert.equal(getEffectiveOfficialIndicator(provider), 'critical')
  })

  test('keeps an unknown declared state distinguishable from unavailable', () => {
    const provider = createProvider({ indicator: 'custom_status' })

    assert.equal(getEffectiveOfficialIndicator(provider), 'custom_status')
    assert.equal(isOfficialProviderAffected(provider), true)
  })

  test('uses degraded component state when the summary says none', () => {
    const provider = createProvider({
      components: [
        {
          id: 'responses',
          name: 'Responses',
          status: 'degraded_performance',
          updated_at: '2026-07-17T00:00:00Z',
        },
      ],
    })

    assert.equal(getEffectiveOfficialIndicator(provider), 'minor')
    assert.equal(getAffectedOfficialComponents(provider).length, 1)
    assert.equal(isOfficialProviderAffected(provider), true)
  })

  test('does not count completed incidents as active', () => {
    const provider = createProvider({
      incidents: [
        createIncident('resolved', 'major'),
        createIncident('completed', 'minor'),
        createIncident('postmortem', 'minor'),
      ],
    })

    assert.equal(getEffectiveOfficialIndicator(provider), 'none')
    assert.equal(isOfficialProviderAffected(provider), false)
    assert.deepEqual(getActiveOfficialIncidents(provider), [])
  })

  test('keeps an unavailable provider affected without incidents', () => {
    assert.equal(
      isOfficialProviderAffected(createProvider({ available: false })),
      true
    )
  })
})
