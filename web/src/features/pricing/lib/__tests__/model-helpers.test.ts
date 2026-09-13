import { describe, expect, test } from 'vitest'

import { getAvailableGroups } from '../model-helpers'

describe('getAvailableGroups', () => {
  test('orders enabled groups by configured pricing order', () => {
    const model = { enable_groups: ['vip', 'default', 'premium'] } as never
    const groups = {
      vip: { desc: '', ratio: 1, order: 30 },
      default: { desc: '', ratio: 1, order: 10 },
      premium: { desc: '', ratio: 1, order: 20 },
    }

    expect(getAvailableGroups(model, groups)).toEqual([
      'default',
      'premium',
      'vip',
    ])
  })
})
