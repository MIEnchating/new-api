import { describe, expect, it } from 'vitest'

import { formatJsonForTextarea, normalizeJsonString } from '../utils'

describe('JSON settings utilities', () => {
  it('normalizes missing values without throwing', () => {
    expect(normalizeJsonString(undefined)).toBe('')
    expect(normalizeJsonString(null)).toBe('')
    expect(formatJsonForTextarea(undefined)).toBe('')
    expect(formatJsonForTextarea(null)).toBe('')
  })
})
