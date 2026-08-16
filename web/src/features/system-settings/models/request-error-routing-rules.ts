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
import { parseHttpStatusCodeRules } from '@/lib/http-status-code-rules'

const requestErrorRoutingMatchModes = ['any', 'all'] as const
const requestErrorMessageMatchModes = ['contains', 'exact'] as const

export type RequestErrorRoutingMatchMode =
  (typeof requestErrorRoutingMatchModes)[number]
export type RequestErrorMessageMatchMode =
  (typeof requestErrorMessageMatchModes)[number]

export type RequestErrorRoutingRule = {
  id: string
  name: string
  description: string
  priority: number
  enabled: boolean
  match_mode: RequestErrorRoutingMatchMode
  status_codes: string
  error_codes: string
  message_patterns: string
  message_match_mode: RequestErrorMessageMatchMode
  retry_same_channel: boolean
  switch_channel: boolean
  switch_group: boolean
  cooldown: boolean
}

type RequestErrorRoutingValidationTranslator = (
  key: string,
  options?: { number: number }
) => string

const contextLimitPatterns = [
  'exceeds the context window',
  'exceed the context window',
  'maximum context length',
  'context length exceeded',
  'context window exceeded',
  'input is too long',
  'input too long',
  'prompt is too long',
  'prompt too long',
  '上下文长度超出',
  '超出上下文窗口',
  '输入内容过长',
  '提示词过长',
]

const DEFAULT_REQUEST_ERROR_ROUTING_RULES: RequestErrorRoutingRule[] = [
  {
    id: 'context-window-exceeded',
    name: 'Context window exceeded',
    description:
      'Do not resend an unchanged oversized request to the same channel; continue with other candidates without marking the route unhealthy.',
    priority: 0,
    enabled: true,
    match_mode: 'any',
    status_codes: '',
    error_codes: 'context_length_exceeded,input_too_long,prompt_too_long',
    message_patterns: contextLimitPatterns.join('\n'),
    message_match_mode: 'contains',
    retry_same_channel: false,
    switch_channel: true,
    switch_group: true,
    cooldown: false,
  },
]

export const DEFAULT_REQUEST_ERROR_ROUTING_RULES_JSON = JSON.stringify(
  DEFAULT_REQUEST_ERROR_ROUTING_RULES
)

function normalizeMatchMode(value: unknown): RequestErrorRoutingMatchMode {
  return value === 'all' ? 'all' : 'any'
}

function normalizeMessageMatchMode(
  value: unknown
): RequestErrorMessageMatchMode {
  return value === 'exact' ? 'exact' : 'contains'
}

function normalizeList(value: string, separator: ',' | '\n') {
  const seen = new Set<string>()
  const values = value
    .replaceAll('\r\n', '\n')
    .replaceAll('，', ',')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => {
      const normalized = item.toLowerCase()
      if (!normalized || seen.has(normalized)) return false
      seen.add(normalized)
      return true
    })
  return values.join(separator)
}

function normalizeRule(item: unknown, index: number): RequestErrorRoutingRule {
  const record =
    item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
  const priority = Number(record.priority)
  return {
    id:
      typeof record.id === 'string' && record.id.trim()
        ? record.id.trim()
        : `legacy-rule-${index}`,
    name: typeof record.name === 'string' ? record.name : `Rule ${index + 1}`,
    description:
      typeof record.description === 'string' ? record.description : '',
    priority: Number.isInteger(priority) ? priority : index,
    enabled: record.enabled === true,
    match_mode: normalizeMatchMode(record.match_mode),
    status_codes:
      typeof record.status_codes === 'string' ? record.status_codes : '',
    error_codes:
      typeof record.error_codes === 'string' ? record.error_codes : '',
    message_patterns:
      typeof record.message_patterns === 'string'
        ? record.message_patterns
        : '',
    message_match_mode: normalizeMessageMatchMode(record.message_match_mode),
    retry_same_channel: record.retry_same_channel === true,
    switch_channel: record.switch_channel === true,
    switch_group: record.switch_group === true,
    cooldown: record.cooldown === true,
  }
}

export function parseRequestErrorRoutingRules(
  raw: string
): RequestErrorRoutingRule[] {
  const value = (raw ?? '').trim()
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeRule)
  } catch {
    return []
  }
}

export function serializeRequestErrorRoutingRules(
  rules: RequestErrorRoutingRule[],
  normalize = false
) {
  return JSON.stringify(
    rules.map((rule) => ({
      ...rule,
      name: normalize ? rule.name.trim() : rule.name,
      description: normalize ? rule.description.trim() : rule.description,
      match_mode: normalizeMatchMode(rule.match_mode),
      status_codes: normalize
        ? parseHttpStatusCodeRules(rule.status_codes).normalized
        : rule.status_codes,
      error_codes: normalize
        ? normalizeList(rule.error_codes, ',')
        : rule.error_codes,
      message_patterns: normalize
        ? normalizeList(rule.message_patterns, '\n')
        : rule.message_patterns.replaceAll('\r\n', '\n'),
      message_match_mode: normalizeMessageMatchMode(rule.message_match_mode),
    })),
    null,
    2
  )
}

export function validateRequestErrorRoutingRules(raw: string): string | null {
  return validateRequestErrorRoutingRulesWithTranslator(raw)
}

export function validateRequestErrorRoutingRulesWithTranslator(
  raw: string,
  translate?: RequestErrorRoutingValidationTranslator
): string | null {
  const message = (key: string, number?: number) => {
    if (number === undefined) return translate ? translate(key) : key
    return translate
      ? translate(key, { number })
      : key.replace('{{number}}', String(number))
  }
  let parsed: unknown
  try {
    parsed = JSON.parse((raw ?? '').trim() || '[]')
  } catch {
    return message('Request error routing rules must be a JSON array')
  }
  if (!Array.isArray(parsed)) {
    return message('Request error routing rules must be a JSON array')
  }

  const rules = parsed.map(normalizeRule)
  for (const [index, rule] of rules.entries()) {
    const number = index + 1
    if (!rule.enabled) continue
    if (!rule.name.trim()) {
      return message('Rule {{number}} requires a name', number)
    }
    if (rule.name.trim().length > 100) {
      return message(
        'Rule {{number}} name cannot exceed 100 characters',
        number
      )
    }
    if (rule.description.trim().length > 500) {
      return message(
        'Rule {{number}} description cannot exceed 500 characters',
        number
      )
    }
    const hasStatus = rule.status_codes.trim() !== ''
    const hasErrorCode = normalizeList(rule.error_codes, ',') !== ''
    const hasMessage = normalizeList(rule.message_patterns, '\n') !== ''
    if (!hasStatus && !hasErrorCode && !hasMessage) {
      return message(
        'Rule {{number}} requires at least one match condition',
        number
      )
    }
    if (hasStatus && !parseHttpStatusCodeRules(rule.status_codes).ok) {
      return message('Rule {{number}} has invalid status code rules', number)
    }
  }
  return null
}
