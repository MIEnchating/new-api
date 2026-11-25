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
import { z } from 'zod'

import {
  modelDetectionEndpoint,
  modelDetectionResultSchema,
  modelDetectionSchema,
} from './api'

const historyLimit = 20
const recordSchema = z.object({
  id: z.string(),
  finishedAt: z.number(),
  target: modelDetectionSchema
    .pick({ group: true, model: true, effort: true })
    .extend({
      endpoint: z.enum([
        modelDetectionEndpoint,
        '/v1/responses',
        '/v1/messages',
      ]),
      api_url: modelDetectionSchema.shape.api_url.optional(),
    }),
  outcome: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('success'),
      result: modelDetectionResultSchema,
    }),
    z.object({ status: z.literal('error'), message: z.string() }),
    z.object({ status: z.literal('cancelled') }),
  ]),
})

export type DetectionHistoryRecord = z.infer<typeof recordSchema>
export type DetectionHistoryOutcome = DetectionHistoryRecord['outcome']

function storageKey(userId: number) {
  return `model-detection/history/v1/${userId}`
}

export function readDetectionHistory(userId: number): DetectionHistoryRecord[] {
  try {
    const saved = localStorage.getItem(storageKey(userId))
    if (!saved) return []
    const records: unknown = JSON.parse(saved)
    if (!Array.isArray(records)) return []
    return records.slice(0, historyLimit).flatMap((record) => {
      const parsed = recordSchema.safeParse(record)
      return parsed.success ? [parsed.data] : []
    })
  } catch {
    return []
  }
}

export function saveDetectionHistory(
  userId: number,
  target: Omit<DetectionHistoryRecord['target'], 'endpoint'>,
  outcome: DetectionHistoryOutcome,
  history: DetectionHistoryRecord[],
  replaceId?: string
): DetectionHistoryRecord[] {
  const finishedAt = Date.now()
  const record: DetectionHistoryRecord = {
    id: replaceId ?? `${finishedAt}-${Math.random().toString(36).slice(2)}`,
    finishedAt,
    target: {
      endpoint: modelDetectionEndpoint,
      api_url: target.api_url,
      group: target.group,
      model: target.model,
      effort: target.effort,
    },
    outcome,
  }
  const merged = new Map(
    [...history, ...readDetectionHistory(userId)].map((item) => [item.id, item])
  )
  merged.delete(record.id)
  const next = [
    record,
    ...[...merged.values()].sort((a, b) => b.finishedAt - a.finishedAt),
  ].slice(0, historyLimit)
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(next))
  } catch {
    // The current page also keeps a history when browser storage is unavailable.
  }
  return next
}
