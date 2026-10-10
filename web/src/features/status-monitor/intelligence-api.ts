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

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export const intelligenceConfigSchema = z.object({
  questions: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        prompt: z
          .string()
          .trim()
          .min(1)
          .refine((value) => new TextEncoder().encode(value).length <= 8000),
      })
    )
    .min(1)
    .max(5),
  groups: z
    .array(
      z
        .object({
          group: z.string().trim().min(1).max(64),
          model: z.string().trim().min(1).max(255),
          endpoint: z.enum([
            'openai',
            'openai-response',
            'anthropic',
            'gemini',
          ]),
          stream: z.boolean().optional(),
          enabled: z.boolean(),
          times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(24),
        })
        .refine((value) => !value.enabled || value.times.length > 0)
        .refine((value) => new Set(value.times).size === value.times.length)
    )
    .min(1)
    .max(50)
    .refine(
      (groups) =>
        new Set(groups.map((group) => group.group)).size === groups.length
    ),
})
export type IntelligenceConfig = z.infer<typeof intelligenceConfigSchema>
export type IntelligenceTask = {
  task_id: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  created_at: number
  updated_at: number
  groups?: { group: string; model: string; endpoint: string }[]
  group: string
  model: string
  endpoint: string
  state?: { processed: number; total: number; progress: number }
  error: string
  result?: {
    channels: {
      group?: string
      model?: string
      endpoint?: string
      channel_id: number
      question_index: number
      question_name: string
      html?: string
      latency_ms: number
      error: string
    }[]
  }
}
export type IntelligenceMonitorData = {
  config: IntelligenceConfig
  catalog: Record<string, string[]>
  history: IntelligenceTask[]
}
type Response<T> = { success: boolean; message?: string; data: T }
const endpoint = '/api/status-monitor/intelligence'
export const intelligenceQueryKey = [
  'status-monitor',
  'intelligence',
  'settings',
]
export const intelligenceResultsQueryKey = [
  'status-monitor',
  'intelligence',
  'results',
]

export async function getIntelligenceResults() {
  const response = await api.get<Response<{ history: IntelligenceTask[] }>>(
    `${endpoint}/results`
  )
  return requireServerSuccess(response.data).data
}

export async function getIntelligenceMonitor() {
  const response = await api.get<Response<IntelligenceMonitorData>>(endpoint)
  return requireServerSuccess(response.data).data
}
export async function saveIntelligenceConfig(config: IntelligenceConfig) {
  const response = await api.put<Response<IntelligenceConfig>>(endpoint, config)
  return requireServerSuccess(response.data).data
}
export async function runIntelligenceTest(group?: string) {
  const response = await api.post<Response<IntelligenceTask>>(
    `${endpoint}/run`,
    group ? { group } : {}
  )
  return requireServerSuccess(response.data).data
}

export async function getIntelligenceResult(taskId: string) {
  const response = await api.get<Response<IntelligenceTask>>(
    `${endpoint}/results/${encodeURIComponent(taskId)}`
  )
  return requireServerSuccess(response.data).data
}
