import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  buildOAuthReturnURL,
  normalizeOAuthRedirectTarget,
} from './oauth-redirect'

const currentOrigin = 'https://example.com'

describe('OAuth redirects', () => {
  test('keeps ordinary redirects on the current site', () => {
    assert.equal(
      normalizeOAuthRedirectTarget('/console/log?tab=all', currentOrigin),
      '/console/log?tab=all'
    )
    assert.equal(
      normalizeOAuthRedirectTarget(
        'https://attacker.example/path',
        currentOrigin
      ),
      '/dashboard'
    )
    assert.equal(
      normalizeOAuthRedirectTarget('javascript:alert(1)', currentOrigin),
      '/dashboard'
    )
  })

  test('allows only HTTPS cross-site return origins', () => {
    assert.equal(
      buildOAuthReturnURL(
        'https://www.example.com',
        '/dashboard',
        currentOrigin
      ),
      'https://www.example.com/oauth?redirect=%2Fdashboard'
    )
    assert.equal(
      buildOAuthReturnURL(
        'http://www.example.com',
        '/dashboard',
        currentOrigin
      ),
      null
    )
    assert.equal(
      buildOAuthReturnURL('javascript:alert(1)', '/dashboard', currentOrigin),
      null
    )
  })
})
