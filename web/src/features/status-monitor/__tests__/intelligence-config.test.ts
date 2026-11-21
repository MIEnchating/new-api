import { describe, expect, it } from 'vitest'

import { intelligenceConfigSchema } from '../intelligence-api'

const externalConfig = {
  questions: [{ name: 'Question', prompt: 'Answer this question' }],
  groups: [
    {
      group: 'default',
      models: ['gpt-4o-mini'],
      endpoint: 'openai-response' as const,
      mode: 'external' as const,
      enabled: false,
      times: [],
    },
  ],
}

describe('intelligenceConfigSchema external API settings', () => {
  it('accepts a Manxue test for the selected model without credentials in the form', () => {
    expect(intelligenceConfigSchema.safeParse(externalConfig).success).toBe(
      true
    )
  })

  it('uses the selected Manxue benchmark with an empty local question selection', () => {
    const config = structuredClone(externalConfig)

    expect(
      intelligenceConfigSchema.safeParse({
        ...config,
        groups: [
          { ...config.groups[0], benchmark: 'creative', question_indexes: [] },
        ],
      }).success
    ).toBe(true)
  })
})
