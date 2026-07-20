import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { normalizeUsageLogGroups } from './group-options-api'

describe('usage log group options', () => {
  test('keeps the configured order returned to administrators', () => {
    assert.deepEqual(normalizeUsageLogGroups(['pro', 'default']), [
      'pro',
      'default',
    ])
  })

  test('sorts user-visible groups by their order metadata', () => {
    assert.deepEqual(
      normalizeUsageLogGroups({
        default: { order: 2 },
        auto: { order: 3 },
        pro: { order: 1 },
      }),
      ['pro', 'default', 'auto']
    )
  })
})
