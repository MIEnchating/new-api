import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { TFunction } from 'i18next'

import {
  formatIncidentStatus,
  formatOfficialTime,
  getActiveOfficialIncidents,
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
