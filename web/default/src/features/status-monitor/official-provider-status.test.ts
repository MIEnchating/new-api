import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { TFunction } from 'i18next'

import {
  formatIncidentStatus,
  formatOfficialTime,
} from './official-provider-status-utils'

const translate = ((key: string) => {
  const translations: Record<string, string> = {
    Identified: '问题已定位',
    Investigating: '正在调查',
    Monitoring: '持续监控',
    Resolved: '已解决',
  }
  return translations[key] ?? key
}) as TFunction

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
})
