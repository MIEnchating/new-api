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

import {
  DEFAULT_REQUEST_ERROR_ROUTING_RULES_JSON,
  parseRequestErrorRoutingRules,
  serializeRequestErrorRoutingRules,
  validateRequestErrorRoutingRules,
  validateRequestErrorRoutingRulesWithTranslator,
} from '../request-error-routing-rules'

describe('request error routing rules', () => {
  test('ships a context limit rule that fails over without cooldown', () => {
    const [rule] = parseRequestErrorRoutingRules(
      DEFAULT_REQUEST_ERROR_ROUTING_RULES_JSON
    )

    assert.equal(rule.retry_same_channel, false)
    assert.equal(rule.switch_channel, true)
    assert.equal(rule.switch_group, true)
    assert.equal(rule.cooldown, false)
    assert.match(rule.error_codes, /context_length_exceeded/)
  })

  test('normalizes status, code, and message lists when saving', () => {
    const [rule] = parseRequestErrorRoutingRules(
      DEFAULT_REQUEST_ERROR_ROUTING_RULES_JSON
    )
    const normalized = serializeRequestErrorRoutingRules(
      [
        {
          ...rule,
          status_codes: '502,500-503',
          error_codes: 'foo， bar,foo',
          message_patterns: 'alpha\r\nbeta\nalpha',
        },
      ],
      true
    )
    const [result] = parseRequestErrorRoutingRules(normalized)

    assert.equal(result.status_codes, '500-503')
    assert.equal(result.error_codes, 'foo,bar')
    assert.equal(result.message_patterns, 'alpha\nbeta')
  })

  test('requires a condition for enabled rules', () => {
    assert.match(
      validateRequestErrorRoutingRules(
        JSON.stringify([
          {
            id: 'empty',
            name: 'Empty rule',
            enabled: true,
            match_mode: 'any',
          },
        ])
      ) ?? '',
      /at least one match condition/
    )
  })

  test('preserves an empty rule name while the user is editing', () => {
    const [rule] = parseRequestErrorRoutingRules(
      JSON.stringify([{ id: 'draft', name: '', enabled: false }])
    )

    assert.equal(rule.name, '')
    assert.equal(
      validateRequestErrorRoutingRules(
        JSON.stringify([{ id: 'draft', name: '', enabled: false }])
      ),
      null
    )
  })

  test('uses the provided translator for validation messages', () => {
    const message = validateRequestErrorRoutingRulesWithTranslator(
      JSON.stringify([{ id: 'draft', name: '', enabled: true }]),
      (key, options) =>
        `translated:${key.replace('{{number}}', String(options?.number ?? ''))}`
    )

    assert.equal(message, 'translated:Rule 1 requires a name')
  })
})
