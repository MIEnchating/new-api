import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  buildDiscordOAuthUrl,
  buildGitHubOAuthUrl,
  buildLinuxDOOAuthUrl,
  buildOIDCOAuthUrl,
} from './oauth'

const origin = 'https://www.example.com'

describe('OAuth callback origins', () => {
  test('uses the active trusted site for built-in providers', () => {
    const urls = [
      buildDiscordOAuthUrl('discord-client', 'state', origin),
      buildOIDCOAuthUrl(
        'https://id.example.com/authorize',
        'oidc-client',
        'state',
        origin
      ),
      buildLinuxDOOAuthUrl('linuxdo-client', 'state', origin),
    ]

    for (const rawURL of urls) {
      const callback = new URL(rawURL).searchParams.get('redirect_uri')
      assert.ok(callback?.startsWith(`${origin}/oauth/`))
    }
  })

  test('keeps GitHub on its configured canonical callback', () => {
    const url = new URL(buildGitHubOAuthUrl('github-client', 'state'))

    assert.equal(url.searchParams.has('redirect_uri'), false)
  })
})
