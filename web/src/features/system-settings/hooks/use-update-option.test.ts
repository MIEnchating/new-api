import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { shouldRefreshStatusForOption } from './use-update-option'

describe('system option status refresh', () => {
  test('refreshes visible branding after it is saved', () => {
    assert.equal(shouldRefreshStatusForOption('Logo'), true)
    assert.equal(shouldRefreshStatusForOption('SystemName'), true)
    assert.equal(shouldRefreshStatusForOption('Footer'), true)
  })

  test('does not refresh status for unrelated private options', () => {
    assert.equal(shouldRefreshStatusForOption('GitHubClientSecret'), false)
  })
})
