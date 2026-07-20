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
import type { StatusBadgeProps } from '@/components/status-badge'
import {
  BILLING_PRICING_VARS,
  normalizeTierLabel,
  parseTiersFromExpr,
  type ParsedTier,
} from '@/features/pricing/lib/billing-expr'

import type { UsageLog } from '../data/schema'
import type { LogOtherData } from '../types'

export { normalizeTierLabel }

const PARAM_OVERRIDE_ACTION_MAP: Record<string, string> = {
  set: 'Set',
  delete: 'Delete',
  copy: 'Copy',
  move: 'Move',
  append: 'Append',
  prepend: 'Prepend',
  trim_prefix: 'Trim Prefix',
  trim_suffix: 'Trim Suffix',
  ensure_prefix: 'Ensure Prefix',
  ensure_suffix: 'Ensure Suffix',
  trim_space: 'Trim Space',
  to_lower: 'To Lower',
  to_upper: 'To Upper',
  replace: 'Replace',
  regex_replace: 'Regex Replace',
  set_header: 'Set Header',
  delete_header: 'Delete Header',
  copy_header: 'Copy Header',
  move_header: 'Move Header',
  pass_headers: 'Pass Headers',
  sync_fields: 'Sync Fields',
  return_error: 'Return Error',
}

/**
 * Get localized label for a param override action
 */
export function getParamOverrideActionLabel(
  action: string,
  t: (key: string) => string
): string {
  const key = PARAM_OVERRIDE_ACTION_MAP[action.toLowerCase()]
  return key ? t(key) : action
}

/**
 * Parse a param override audit line into action and content
 */
export function parseAuditLine(
  line: string
): { action: string; content: string } | null {
  if (typeof line !== 'string') return null
  const firstSpace = line.indexOf(' ')
  if (firstSpace <= 0) return { action: line, content: line }
  return {
    action: line.slice(0, firstSpace),
    content: line.slice(firstSpace + 1),
  }
}

/**
 * Check if the log is a violation fee log
 */
export function isViolationFeeLog(other: LogOtherData | null): boolean {
  if (!other) return false
  return (
    other.violation_fee === true ||
    Boolean(other.violation_fee_code) ||
    Boolean(other.violation_fee_marker)
  )
}

/**
 * Parse the 'other' field from JSON string to object
 */
export function parseLogOther(other: string): LogOtherData | null {
  if (!other) return null
  try {
    return JSON.parse(other) as LogOtherData
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to parse log other field:', error)
    return null
  }
}

export function normalizeLogDiagnosticMessage(message: unknown): string {
  if (typeof message !== 'string') return ''
  return message
    .trim()
    .replace(
      /(?:\s*\((?:request[\s_-]?id|requestid)\s*:\s*[^\s()]+\))+\s*$/i,
      ''
    )
    .replace(/^status_code\s*=\s*\d+\s*,?\s*/i, '')
    .replaceAll(/\s+/g, ' ')
    .toLowerCase()
}

export function isDuplicateLogDiagnosticMessage(
  message: unknown,
  canonicalMessage: unknown
): boolean {
  const normalizedMessage = normalizeLogDiagnosticMessage(message)
  const normalizedCanonical = normalizeLogDiagnosticMessage(canonicalMessage)
  return normalizedMessage !== '' && normalizedMessage === normalizedCanonical
}

export function uniqueLogDiagnosticMessages(
  messages: unknown,
  canonicalMessage: unknown
): string[] {
  if (!Array.isArray(messages)) return []
  const canonical = normalizeLogDiagnosticMessage(canonicalMessage)
  const seen = new Set<string>()
  const result: string[] = []

  for (const message of messages) {
    if (typeof message !== 'string') continue
    const normalized = normalizeLogDiagnosticMessage(message)
    if (!normalized || normalized === canonical || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    result.push(message.trim())
  }
  return result
}

export function getUpstreamRequestIds(
  requestIds: string[] | undefined,
  latestRequestId: string | undefined
): string[] {
  return [
    ...new Set(
      [...(requestIds ?? []), latestRequestId]
        .map((requestId) => requestId?.trim())
        .filter((requestId): requestId is string => Boolean(requestId))
    ),
  ]
}

/**
 * Get time color based on duration (in seconds)
 */
export function getTimeColor(
  seconds: number
): 'success' | 'warning' | 'danger' {
  if (seconds < 10) return 'success'
  if (seconds < 30) return 'warning'
  return 'danger'
}

/**
 * Get first-response-token color based on latency (in seconds)
 */
export function getFirstResponseTimeColor(
  seconds: number
): 'success' | 'warning' | 'danger' {
  if (seconds < 5) return 'success'
  if (seconds < 10) return 'warning'
  return 'danger'
}

/**
 * Get throughput color based on generated tokens per second
 */
export function getThroughputColor(
  tokensPerSecond: number
): 'success' | 'warning' | 'danger' {
  if (tokensPerSecond >= 30) return 'success'
  if (tokensPerSecond >= 15) return 'warning'
  return 'danger'
}

/**
 * Get response color using throughput only when enough output tokens exist.
 */
export function getResponseTimeColor(
  seconds: number,
  completionTokens: number
): 'success' | 'warning' | 'danger' {
  if (completionTokens < 100 || seconds <= 0) return getTimeColor(seconds)
  return getThroughputColor(completionTokens / seconds)
}

/**
 * Format model name with mapping indicator
 */
export function formatModelName(log: UsageLog): {
  name: string
  isMapped: boolean
  actualModel?: string
} {
  const other = parseLogOther(log.other)
  const isMapped = !!(
    other?.is_model_mapped &&
    other?.upstream_model_name &&
    other.upstream_model_name !== ''
  )

  return {
    name: log.model_name,
    isMapped,
    actualModel: isMapped ? other.upstream_model_name : undefined,
  }
}

/**
 * Decode a base64-encoded billing expression. Safely returns an empty string
 * when the input is missing or malformed (e.g. legacy logs without expr_b64).
 */
export function decodeBillingExprB64(exprB64: string | undefined): string {
  if (!exprB64) return ''
  try {
    const binaryString =
      typeof window !== 'undefined'
        ? window.atob(exprB64)
        : Buffer.from(exprB64, 'base64').toString('binary')
    const bytes = new Uint8Array(binaryString.length)

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder().decode(bytes)
    }

    return decodeURIComponent(
      Array.prototype.map
        .call(bytes, (byte: number) => `%${byte.toString(16).padStart(2, '0')}`)
        .join('')
    )
  } catch {
    return ''
  }
}

/**
 * Resolve which parsed tier corresponds to the matched_tier label in a log
 * entry. Missing or unknown labels do not fall back to another tier because
 * that would display guessed unit prices.
 */
export function resolveMatchedTier(
  tiers: ParsedTier[],
  matchedLabel: string | undefined
): ParsedTier | null {
  if (tiers.length === 0) return null
  if (!matchedLabel) return null
  const found = tiers.find((tier) => {
    const l1 = normalizeTierLabel(tier.label)
    const l2 = normalizeTierLabel(matchedLabel)
    return l1 === l2 && l1 !== ''
  })
  return found || null
}

/**
 * Tiered pricing summary derived from an `other` log payload using the
 * billing-expression library. Returns null when the entry is not a tiered
 * billing log or the expression failed to parse.
 */
export interface TieredBillingSummary {
  tiers: ParsedTier[]
  tier: ParsedTier
  priceEntries: Array<{ field: string; shortLabel: string; price: number }>
}

/**
 * Whether the request payload reports any cache-related token usage. Used to
 * suppress cache pricing rows from the tiered breakdown when the request did
 * not exercise the cache path.
 */
export function hasAnyCacheTokens(
  other: LogOtherData | null | undefined
): boolean {
  if (!other) return false
  return (
    (other.cache_tokens || 0) > 0 ||
    (other.cache_creation_tokens || 0) > 0 ||
    (other.cache_creation_tokens_5m || 0) > 0 ||
    (other.cache_creation_tokens_1h || 0) > 0
  )
}

export function getTieredBillingSummary(
  other: LogOtherData | null
): TieredBillingSummary | null {
  if (!other || other.billing_mode !== 'tiered_expr') return null
  const exprStr = decodeBillingExprB64(other.expr_b64)
  if (!exprStr) return null
  const tiers = parseTiersFromExpr(exprStr)
  const tier = resolveMatchedTier(tiers, other.matched_tier)
  if (!tier) return null

  const cacheTokensPresent = hasAnyCacheTokens(other)

  const priceEntries: TieredBillingSummary['priceEntries'] = []
  for (const v of BILLING_PRICING_VARS) {
    if (!v.field) continue
    if (v.group === 'cache' && !cacheTokensPresent) continue
    const raw = tier[v.field as keyof ParsedTier]
    const price = Number(raw)
    if (Number.isFinite(price) && price > 0) {
      priceEntries.push({
        field: v.field,
        shortLabel: v.shortLabel,
        price,
      })
    }
  }
  return { tiers, tier, priceEntries }
}

/**
 * Calculate duration and return formatted result with color variant
 * @param submitTime - Submit timestamp
 * @param finishTime - Finish timestamp
 * @param unit - Unit of the timestamps ('seconds' or 'milliseconds')
 */
export function formatDuration(
  submitTime?: number,
  finishTime?: number,
  unit: 'seconds' | 'milliseconds' = 'milliseconds'
): { durationSec: number; variant: StatusBadgeProps['variant'] } | null {
  if (!submitTime || !finishTime) return null

  const durationSec =
    unit === 'milliseconds'
      ? (finishTime - submitTime) / 1000
      : finishTime - submitTime

  return { durationSec, variant: durationSec > 60 ? 'red' : 'green' }
}

type AuditTranslate = (key: string, opts?: Record<string, unknown>) => string

export type AuditParamValue = string | number | boolean | string[]

export interface AuditParamEntry {
  key: string
  label: string
  value: string
}

const OPTION_KEY_LABELS: Record<string, string> = {
  'theme.frontend': 'Frontend Theme',
  RetryTimes: 'Retry Times',
  AutomaticRetryStatusCodes: 'Auto-retry status codes',
  ChannelRouteCooldownEnabled: 'Channel routing',
  ChannelRouteCooldownSeconds: 'Cooldown time (seconds)',
  ChannelRouteStickyEnabled: 'Channel route affinity',
  ChannelRouteSameChannelRetries: 'Same-channel retries',
  ChannelDisableThreshold: 'Channel disable threshold',
  AutomaticDisableChannelEnabled: 'Automatic channel disabling',
  AutomaticEnableChannelEnabled: 'Automatic channel recovery',
  AutomaticDisableKeywords: 'Automatic disable keywords',
  AutomaticDisableStatusCodes: 'Automatic disable status codes',
  'monitor_setting.auto_test_channel_enabled': 'Automatic channel testing',
  'monitor_setting.auto_test_channel_minutes': 'Channel test interval',
  'monitor_setting.channel_test_mode': 'Channel test mode',
  'error_response_setting.enabled': 'Custom error responses',
  'error_response_setting.rules': 'Custom error response rules',
  'perf_metrics_setting.cache_hit_rate_baseline': 'Cache hit-rate baseline',
  'perf_metrics_setting.cache_monitor_groups': 'Cache monitoring groups',
}

const AUDIT_PARAM_LABELS: Record<string, string> = {
  action: 'Action',
  advance_reset_time: 'Advance reset time',
  all_groups: 'All groups',
  baseline: 'Cache hit-rate baseline',
  bindingType: 'Binding type',
  changed: 'Changed',
  changed_fields: 'Changed Fields',
  count: 'Count',
  display_groups: 'Groups',
  from: 'Previous value',
  group_count: 'Group count',
  groups: 'Groups',
  id: 'Resource ID',
  key: 'Setting',
  method: 'Method',
  name: 'Name',
  plan_id: 'Plan ID',
  plan_title: 'Plan',
  previous_all_groups: 'Previously all groups',
  previous_display_groups: 'Previous groups',
  quota: 'Quota',
  reset_count: 'Reset count',
  role: 'Role',
  route: 'Route',
  sourceId: 'Source ID',
  status: 'Status',
  tag: 'Tag',
  target_user_id: 'Target User ID',
  task_id: 'Task ID',
  to: 'New value',
  total: 'Total',
  totalIgnored: 'Total ignored',
  type: 'Type',
  user_count: 'User count',
  username: 'Username',
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  models: 'Models',
  group: 'Group',
  type: 'Type',
  base_url: 'Base URL',
  key: 'Key',
}

const CHANNEL_STATUS_LABELS: Record<number, string> = {
  1: 'Enabled',
  2: 'Disabled',
  3: 'Auto Disabled',
}

/** Turn stable identifiers into a readable fallback without hiding the code. */
export function humanizeAuditIdentifier(value: string): string {
  const normalized = value
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll(/[._-]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()

  if (!normalized) return value
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export function getLoginMethodLabel(
  method: string | undefined,
  t: AuditTranslate
): string {
  if (!method) return ''
  if (method.startsWith('oauth:')) {
    const provider = method.slice('oauth:'.length)
    return provider ? `${t('OAuth')} (${provider})` : t('OAuth')
  }

  const labels: Record<string, string> = {
    password: 'Password',
    '2fa': 'Two-factor authentication',
    passkey: 'Passkey',
    wechat: 'WeChat',
    telegram: 'Telegram',
    oauth: 'OAuth',
    unknown: 'Unknown',
  }
  return t(labels[method] ?? humanizeAuditIdentifier(method))
}

export function getSecondFactorMethodLabel(
  method: string | undefined,
  t: AuditTranslate
): string {
  if (!method) return ''
  const labels: Record<string, string> = {
    totp: 'Authenticator code',
    backup_code: 'Backup code',
  }
  return t(labels[method] ?? humanizeAuditIdentifier(method))
}

export function getAuditAuthMethodLabel(
  method: string | undefined,
  t: AuditTranslate
): string {
  if (!method) return ''
  if (method === 'access_token') return t('Access Token')
  if (method === 'session') return t('Session')
  return t(humanizeAuditIdentifier(method))
}

export function getOptionKeyLabel(
  key: string | undefined,
  t: AuditTranslate
): string {
  if (!key) return ''
  return t(OPTION_KEY_LABELS[key] ?? humanizeAuditIdentifier(key))
}

export function getAuditParamLabel(key: string, t: AuditTranslate): string {
  return t(AUDIT_PARAM_LABELS[key] ?? humanizeAuditIdentifier(key))
}

function getChannelStatusLabel(value: AuditParamValue, t: AuditTranslate) {
  const status = typeof value === 'number' ? value : Number(value)
  const label = CHANNEL_STATUS_LABELS[status]
  return label ? t(label) : String(value)
}

export function formatAuditParamValue(
  action: string,
  key: string,
  value: AuditParamValue,
  t: AuditTranslate
): string {
  if (action === 'option.update' && key === 'key') {
    const rawKey = String(value)
    const label = getOptionKeyLabel(rawKey, t)
    return label === rawKey ? label : `${label} (${rawKey})`
  }
  if (
    action === 'option.update' &&
    (key === 'from' || key === 'to') &&
    typeof value === 'string'
  ) {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return t('Enabled')
    if (normalized === 'false') return t('Disabled')
  }
  if (
    (action === 'channel.status_update' ||
      action === 'channel.status_update_batch') &&
    key === 'status'
  ) {
    return getChannelStatusLabel(value, t)
  }
  if (key === 'changed_fields' && Array.isArray(value)) {
    return value
      .map((field) => t(AUDIT_FIELD_LABELS[field] ?? field))
      .join(', ')
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : t('None')
  }
  if (typeof value === 'boolean') return value ? t('Yes') : t('No')
  return String(value)
}

export function getAuditParamEntries(
  other: LogOtherData | null | undefined,
  t: AuditTranslate
): AuditParamEntry[] {
  const action = other?.op?.action
  const params = other?.op?.params
  if (!action || !params) return []

  return Object.entries(params)
    .filter((entry): entry is [string, AuditParamValue] => entry[1] != null)
    .map(([key, value]) => ({
      key,
      label: getAuditParamLabel(key, t),
      value: formatAuditParamValue(action, key, value, t),
    }))
}

function normalizeAuditTemplateParams(
  action: string,
  params: Record<string, AuditParamValue>,
  t: AuditTranslate
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...params }

  if (action === 'login' && typeof params.method === 'string') {
    normalized.method = getLoginMethodLabel(params.method, t)
  }
  if (action === 'option.update' && typeof params.key === 'string') {
    normalized.key = getOptionKeyLabel(params.key, t)
  }
  if (
    (action === 'channel.status_update' ||
      action === 'channel.status_update_batch') &&
    params.status != null
  ) {
    normalized.status = getChannelStatusLabel(params.status, t)
  }
  if (Array.isArray(params.groups)) {
    normalized.groups = params.groups.join(', ')
  }
  if (action === 'cache_monitor_groups.update') {
    const groups = Array.isArray(params.display_groups)
      ? params.display_groups
      : []
    if (params.all_groups) {
      normalized.selection = t('All groups')
    } else if (groups.length > 0) {
      normalized.selection = groups.join(', ')
    } else {
      normalized.selection = t('{{count}} groups', {
        count: Number(params.group_count ?? 0),
      })
    }
  }

  return normalized
}

/**
 * Maps a language-independent audit/login operation `action` to an i18n
 * template string (the template itself is the i18n key, with {{placeholders}}).
 *
 * The backend stores only `action` + structured `params` in `other.op`; the UI
 * renders localized content at display time so audit/login logs are fully
 * translatable instead of being frozen to whatever language was written to DB.
 */
const AUDIT_TEMPLATES: Record<string, string> = {
  login: 'Logged in successfully via {{method}}',
  // User management
  'user.create': 'Created user {{username}} (role {{role}})',
  'user.update': 'Updated user {{username}} (ID: {{id}})',
  'user.delete': 'Deleted user {{username}} (ID: {{id}})',
  'user.manage': 'Performed {{action}} on user {{username}} (ID: {{id}})',
  'user.quota_add': 'Increased user quota by {{quota}}',
  'user.quota_subtract': 'Decreased user quota by {{quota}}',
  'user.quota_override': 'Overrode user quota from {{from}} to {{to}}',
  'user.binding_clear': 'Cleared {{bindingType}} binding for user {{username}}',
  'user.2fa_disable': 'Force-disabled two-factor authentication for the user',
  'user.passkey_register': 'Registered a passkey',
  'user.passkey_delete': 'Deleted a passkey',
  'user.topup_complete': 'Completed top-up order for the user',
  'user.reset_passkey': 'Reset the user passkey',
  'user.oauth_unbind': 'Removed an OAuth binding for the user',
  // System settings
  'option.update': 'Updated system setting {{key}}',
  'option.payment_compliance': 'Confirmed payment compliance',
  'option.reset_ratio': 'Reset model ratios',
  'option.clear_affinity_cache': 'Cleared channel affinity cache',
  // Custom OAuth
  'custom_oauth.create': 'Created a custom OAuth provider',
  'custom_oauth.update': 'Updated a custom OAuth provider',
  'custom_oauth.delete': 'Deleted a custom OAuth provider',
  // Performance / cache
  'performance.clear_disk_cache': 'Cleared disk cache',
  'performance.gc': 'Triggered garbage collection',
  'performance.clear_logs': 'Cleared log files',
  'cache_hit_rate_baseline.update':
    'Updated cache hit-rate baseline to {{baseline}}%',
  'cache_monitor_groups.update':
    'Updated cache monitoring groups: {{selection}}',
  // Channel
  'channel.create': 'Created channel {{name}} (type {{type}}, count {{count}})',
  'channel.update': 'Updated channel {{name}} (ID: {{id}})',
  'channel.delete': 'Deleted channel {{name}} (ID: {{id}})',
  'channel.delete_batch': 'Batch deleted {{count}} channels',
  'channel.delete_disabled': 'Deleted all disabled channels ({{count}})',
  'channel.key_view': 'Viewed channel key {{name}} (ID: {{id}})',
  'channel.tag_disable': 'Disabled channels with tag {{tag}}',
  'channel.tag_enable': 'Enabled channels with tag {{tag}}',
  'channel.tag_edit': 'Edited channels with tag {{tag}}',
  'channel.tag_batch_set': 'Batch set tag for {{count}} channels',
  'channel.route_affinity_clear': 'Route affinity cleared',
  'channel.copy':
    'Copied channel (source ID: {{sourceId}}) to {{name}} (new ID: {{id}})',
  'channel.multi_key_manage':
    'Multi-key management {{action}} on channel (ID: {{id}})',
  'channel.route_cooldown_clear':
    'Restored route availability for channel (ID: {{id}}) in groups {{groups}}',
  'channel.status_update': 'Updated channel {{id}} status to {{status}}',
  'channel.status_update_batch':
    'Updated {{count}} of {{total}} channels to {{status}}',
  'channel.upstream_apply':
    'Applied upstream model changes to channel (ID: {{id}})',
  'channel.upstream_apply_all':
    'Applied upstream model changes to {{count}} channels',
  'channel.upstream_detect_all':
    'Started upstream model detection task {{task_id}}',
  // Redemption codes
  'redemption.create':
    'Created {{count}} redemption codes named {{name}} ({{quota}} each)',
  'redemption.update': 'Updated a redemption code',
  'redemption.delete': 'Deleted a redemption code',
  'redemption.delete_invalid': 'Deleted invalid redemption codes',
  // Prefill groups
  'prefill_group.create': 'Created a prefill group',
  'prefill_group.update': 'Updated a prefill group',
  'prefill_group.delete': 'Deleted a prefill group',
  // Vendors
  'vendor.create': 'Created a vendor',
  'vendor.update': 'Updated a vendor',
  'vendor.delete': 'Deleted a vendor',
  // Model metadata
  'model.create': 'Created a model',
  'model.update': 'Updated a model',
  'model.delete': 'Deleted a model',
  'model.sync_upstream': 'Synced upstream models',
  // Deployments
  'deployment.create': 'Created a deployment',
  'deployment.update': 'Updated a deployment',
  'deployment.delete': 'Deleted a deployment',
  // Subscriptions
  'subscription.plan_create': 'Created a subscription plan',
  'subscription.plan_update': 'Updated a subscription plan',
  'subscription.bind': 'Bound a subscription',
  'subscription.plan_reset':
    'Reset {{reset_count}} subscriptions for plan {{plan_title}}',
  'subscription.user_plan_reset':
    'Reset {{reset_count}} subscriptions for user {{target_user_id}} on plan {{plan_title}}',
  // Logs
  'log.clear': 'Cleared historical logs',
  'log.cleanup_start': 'Log cleanup task started.',
  // Generic middleware fallback
  generic: '{{method}} {{route}}',
}

/**
 * Render the localized content of an audit/login log from its structured
 * `other.op` descriptor. Unknown actions use a readable fallback while the
 * details view still exposes the stable action identifier.
 */
export function renderAuditContent(
  other: LogOtherData | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string
): string | null {
  const op = other?.op
  if (!op?.action) return null
  const template = AUDIT_TEMPLATES[op.action]
  if (!template) {
    return t('Performed operation {{action}}', {
      action: humanizeAuditIdentifier(op.action),
    })
  }
  return t(
    template,
    normalizeAuditTemplateParams(op.action, op.params ?? {}, t)
  )
}
