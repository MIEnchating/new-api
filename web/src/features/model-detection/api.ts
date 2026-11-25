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

export const modelDetectionEndpoint = '/v1/chat/completions'

export const modelDetectionSchema = z.object({
  api_url: z.string().max(500),
  api_key: z.string().trim().max(256),
  group: z.string().min(1, 'Required').max(255),
  model: z.string().min(1, 'Required').max(255),
  effort: z.enum(['', 'low', 'medium', 'high']),
  parallel: z.boolean(),
  stream: z.boolean(),
  image: z.boolean(),
  tokenizer: z.boolean(),
  strict: z.boolean(),
})

export type ModelDetectionInput = z.infer<typeof modelDetectionSchema>

const challengeSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  expected_count: z.number(),
})

const challengeSetSchema = z.object({
  token: z.string().min(1),
  challenges: z.array(challengeSchema).length(3),
})

const sampleSchema = z.object({
  state: z.string(),
  text: z.string(),
  count: z.number(),
  expectedCount: z.number(),
  startedAt: z.number().nonnegative().optional(),
  finishedAt: z.number().nonnegative().optional(),
  throughput: z
    .object({
      ttftMs: z.number().nonnegative(),
      tokensPerSecond: z.number().nonnegative().optional(),
      estimated: z.boolean().optional(),
    })
    .optional(),
})

const tokenizerClassSchema = z.object({
  id: z.string(),
  series: z.string().optional(),
  lab_name: z.string().optional(),
  exact: z.number().optional(),
})

export const modelDetectionResultSchema = z.object({
  rounds: z
    .array(
      z.object({
        challenges: z.array(challengeSchema),
        samples: z.array(sampleSchema),
        analysis: z
          .object({
            results: z
              .array(
                z.object({
                  model: z.string(),
                  display_name: z.string(),
                  family_name: z.string().optional(),
                  probability: z.number().nullable(),
                })
              )
              .nullable(),
          })
          .nullable(),
      })
    )
    .nullable(),
  tokenizer: z
    .object({
      verdict: z
        .object({
          kind: z.enum(['exact', 'related', 'unknown']),
          confidence: z.number(),
          top: tokenizerClassSchema.nullable(),
          claim: z
            .object({
              status: z.enum(['consistent', 'inconsistent', 'uncertain']),
              vendor: z.string().optional(),
              expected: z.array(z.string()).optional(),
            })
            .nullable(),
        })
        .nullable(),
      baseline_drift: z.boolean(),
      cancelled: z.boolean().optional(),
      unknown: z.number().optional(),
      duration_ms: z.number().nonnegative().optional(),
      bank: z.object({ classes: z.number().int().nonnegative() }).optional(),
      classes: z.array(tokenizerClassSchema).optional(),
      steps: z
        .array(
          z.object({
            probe: z.string().nullable(),
            state: z.string(),
            tokens: z.number().int().nonnegative().optional(),
            responseModel: z.string().optional(),
            category: z.string().optional(),
            text: z.string().optional(),
          })
        )
        .optional(),
    })
    .nullable(),
  upstream_status: z.number().optional(),
})

export type ModelDetectionChallenge = z.infer<typeof challengeSchema>
export type ModelDetectionSample = z.infer<typeof sampleSchema>
export type ModelDetectionResult = z.infer<typeof modelDetectionResultSchema>

export async function getDetectionChallenges(signal: AbortSignal) {
  const response = await api.get('/api/model-detection/challenges', {
    signal,
    timeout: 25_000,
    disableDuplicate: true,
    skipErrorHandler: true,
  })
  return challengeSetSchema.parse(requireServerSuccess(response.data).data)
}

export async function runModelDetection(
  input: ModelDetectionInput,
  challengeToken: string | undefined,
  signal: AbortSignal,
  mode: 'detect' | 'tokenizer' = 'detect'
): Promise<ModelDetectionResult> {
  const response = await api.post(
    '/api/model-detection',
    {
      ...input,
      endpoint: modelDetectionEndpoint,
      mode,
      challenge_token: challengeToken,
    },
    {
      signal,
      timeout: 250_000,
      skipErrorHandler: true,
    }
  )
  return modelDetectionResultSchema.parse(
    requireServerSuccess(response.data).data
  )
}
