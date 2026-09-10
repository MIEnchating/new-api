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
import type { TFunction } from 'i18next'

import {
  BILLING_PRICING_VARS,
  parseTiersFromExpr,
  splitBillingExprAndRequestRules,
  type ParsedTier,
} from './billing-expr'
import { compileBillingExpression } from './billing-expression/parser'
import { evaluateBillingExpression } from './billing-expression/runtime'
import {
  visitExpression,
  type ExpressionNode,
} from './billing-expression/types'

export type DailyTimePrice = {
  multiplier: number
  ranges: { start: number; end: number }[]
}

/** Exact daily prices for rules that depend only on the hour in one timezone. */
export function getDailyTimePrices(expression: string): {
  timezone: string
  periods: DailyTimePrice[]
} | null {
  if (!expression.trim()) return null
  const compiled = compileBillingExpression(expression)
  if (compiled.status !== 'ready' || compiled.variables.size > 0) return null
  if (compiled.functions.size !== 1 || !compiled.functions.has('hour')) {
    return null
  }

  // Each hour is constant over its entire local interval. Substitute an input
  // for hour() and reuse the interpreter, without choosing a date or assuming
  // UTC offsets (which would be wrong for zones that observe daylight saving).
  const nodes = new Map<ExpressionNode, ExpressionNode>()
  const timezones = new Set<string>()
  let supported = true
  visitExpression(compiled.ast, (node) => {
    let replacement = node
    if (node.kind === 'call') {
      const zone = node.args[0]
      if (
        node.name !== 'hour' ||
        zone.kind !== 'literal' ||
        typeof zone.value !== 'string'
      ) {
        supported = false
        return
      }
      timezones.add(zone.value.trim() || 'UTC')
      replacement = {
        kind: 'variable',
        name: 'p',
        start: node.start,
        end: node.end,
      }
    } else if (node.kind === 'binary') {
      replacement = {
        ...node,
        left: nodes.get(node.left) ?? node.left,
        right: nodes.get(node.right) ?? node.right,
      }
    } else if (node.kind === 'unary') {
      replacement = {
        ...node,
        operand: nodes.get(node.operand) ?? node.operand,
      }
    } else if (node.kind === 'conditional') {
      replacement = {
        ...node,
        condition: nodes.get(node.condition) ?? node.condition,
        yes: nodes.get(node.yes) ?? node.yes,
        no: nodes.get(node.no) ?? node.no,
      }
    }
    nodes.set(node, replacement)
  })
  if (!supported || timezones.size !== 1) return null
  const program = {
    ...compiled,
    ast: nodes.get(compiled.ast) ?? compiled.ast,
    requestRules: [],
  }
  const periods: DailyTimePrice[] = []
  for (let hour = 0; hour < 24; hour++) {
    const result = evaluateBillingExpression(program, { tokens: { p: hour } })
    if (result.status !== 'success') return null
    let period = periods.find((item) => item.multiplier === result.cost)
    if (!period) {
      period = { multiplier: result.cost, ranges: [] }
      periods.push(period)
    }
    const previous = period.ranges.at(-1)
    if (previous?.end === hour) previous.end = hour + 1
    else period.ranges.push({ start: hour, end: hour + 1 })
  }
  // Show adjusted prices first, then the remaining hours at the base price.
  periods.sort(
    (a, b) => Number(a.multiplier === 1) - Number(b.multiplier === 1)
  )
  return { timezone: [...timezones][0], periods }
}

export type DailyTimeTier = ParsedTier & {
  timePrice: DailyTimePrice
  otherTimes: boolean
}

/** Shared expanded prices for model details and group pricing. */
export function getDailyTimePricingTiers(expression: string): {
  timezone: string
  tiers: DailyTimeTier[]
} | null {
  const split = splitBillingExprAndRequestRules(expression)
  const tiers = parseTiersFromExpr(split.billingExpr)
  if (tiers.length === 0 || tiers.some((tier) => tier.conditionText)) {
    return null
  }
  const prices = getDailyTimePrices(split.requestRuleExpr)
  if (!prices) return null
  const expanded = prices.periods.flatMap((period) =>
    tiers.map((tier) => {
      const next: DailyTimeTier = {
        ...tier,
        timePrice: period,
        otherTimes: period.multiplier === 1 && prices.periods.length > 1,
      }
      for (const field of [
        ...BILLING_PRICING_VARS.map((variable) => variable.field),
        'fixedPrice',
      ]) {
        if (!field || typeof tier[field] !== 'number') continue
        const value = tier[field] * period.multiplier
        if (!Number.isFinite(value)) return null
        next[field] = value
      }
      return next
    })
  )
  if (expanded.some((tier) => tier === null)) return null
  return {
    timezone: prices.timezone,
    tiers: expanded.filter((tier) => tier !== null),
  }
}

export function formatDailyTimePriceLabel(
  tier: { timePrice?: DailyTimePrice; otherTimes?: boolean; label: string },
  t: TFunction
): string {
  if (!tier.timePrice) return tier.label || t('Default')
  if (tier.otherTimes) return t('Other times')
  return tier.timePrice.ranges
    .map(({ start, end }) =>
      t('{{start}}–{{end}}', {
        start: `${String(start).padStart(2, '0')}:00`,
        end: `${String(end).padStart(2, '0')}:00`,
      })
    )
    .reduce(
      (first, second) =>
        first
          ? t('{{first}} or {{second}}', {
              first,
              second,
              interpolation: { escapeValue: false },
            })
          : second,
      ''
    )
}
