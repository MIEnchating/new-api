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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { runInNewContext } from 'node:vm'

import {
  buildCCSwitchURL,
  CC_SWITCH_LATEST_RELEASE_URL,
  CC_SWITCH_USAGE_AUTO_INTERVAL,
  getCCSwitchUsageBaseUrl,
  getDefaultCCSwitchEndpoint,
  isValidCCSwitchEndpoint,
  normalizeCCSwitchLanguage,
  resolveCCSwitchEndpointInfo,
  resolveCCSwitchServerAddress,
} from './cc-switch.ts'

function buildURL() {
  return buildCCSwitchURL({
    app: 'codex',
    name: 'Yunmian Codex',
    models: { model: 'gpt-5.6-luna' },
    apiKey: 'sk-test-key',
    serverAddress: 'https://www.yunmian.tech/',
    endpoint: 'https://www.yunmian.tech/v1',
    language: 'zh-CN',
  })
}

function getUsageConfig() {
  const url = new URL(buildURL())
  const encoded = url.searchParams.get('usageScript')
  assert.ok(encoded)
  const script = Buffer.from(encoded, 'base64').toString('utf8')
  return runInNewContext(script) as {
    request: { url: string; headers: Record<string, string> }
    extractor: (response: unknown) => unknown
  }
}

describe('CC Switch provider import', () => {
  test('links to the official latest release page', () => {
    const url = new URL(CC_SWITCH_LATEST_RELEASE_URL)
    assert.equal(url.hostname, 'github.com')
    assert.equal(url.pathname, '/farion1231/cc-switch/releases/latest')
  })

  test('prefers the configured HTTPS server over the development origin', () => {
    assert.equal(
      resolveCCSwitchServerAddress(
        JSON.stringify({ server_address: 'https://www.yunmian.tech/' }),
        'http://154.36.172.108:3002'
      ),
      'https://www.yunmian.tech'
    )
    assert.equal(
      resolveCCSwitchServerAddress(null, 'http://localhost:3002/'),
      'http://localhost:3002'
    )
  })

  test('uses homepage API addresses and falls back to the server address', () => {
    assert.deepEqual(
      resolveCCSwitchEndpointInfo(
        {
          server_address: 'https://server.yunmian.tech',
          api_info: [
            {
              url: 'https://api-a.yunmian.tech/',
              route: '线路 A',
              description: '低延迟入口',
              color: 'green',
            },
            {
              url: 'https://api-b.yunmian.tech',
              route: '线路 B',
              description: '备用入口',
              color: 'blue',
            },
            { url: 'https://api-a.yunmian.tech' },
          ],
        },
        'http://localhost:3002'
      ),
      [
        {
          url: 'https://api-a.yunmian.tech',
          route: '线路 A',
          description: '低延迟入口',
          color: 'green',
        },
        {
          url: 'https://api-b.yunmian.tech',
          route: '线路 B',
          description: '备用入口',
          color: 'blue',
        },
      ]
    )
    assert.deepEqual(
      resolveCCSwitchEndpointInfo(
        { server_address: 'https://server.yunmian.tech/' },
        'http://localhost:3002'
      ),
      [
        {
          url: 'https://server.yunmian.tech',
          route: '',
          description: '',
          color: '',
        },
      ]
    )
  })

  test('normalizes the website language for the usage request', () => {
    assert.equal(normalizeCCSwitchLanguage('zh'), 'zh-CN')
    assert.equal(normalizeCCSwitchLanguage('zh-Hant'), 'zh-TW')
    assert.equal(normalizeCCSwitchLanguage('fr'), 'en')
  })

  test('builds application defaults and validates selectable endpoints', () => {
    assert.equal(
      getDefaultCCSwitchEndpoint('codex', 'https://www.yunmian.tech/'),
      'https://www.yunmian.tech/v1'
    )
    assert.equal(
      getDefaultCCSwitchEndpoint('codex', 'https://www.yunmian.tech/v1/'),
      'https://www.yunmian.tech/v1'
    )
    assert.equal(
      getDefaultCCSwitchEndpoint('claude', 'https://www.yunmian.tech/'),
      'https://www.yunmian.tech'
    )
    assert.equal(
      getDefaultCCSwitchEndpoint('gemini', 'https://www.yunmian.tech/'),
      'https://www.yunmian.tech'
    )
    for (const app of [
      'grokbuild',
      'opencode',
      'openclaw',
      'hermes',
    ] as const) {
      assert.equal(
        getDefaultCCSwitchEndpoint(app, 'https://www.yunmian.tech/'),
        'https://www.yunmian.tech/v1'
      )
    }
    assert.equal(isValidCCSwitchEndpoint('https://api.yunmian.tech/v1'), true)
    assert.equal(isValidCCSwitchEndpoint('ftp://api.yunmian.tech'), false)
    assert.equal(isValidCCSwitchEndpoint('/v1'), false)
    assert.equal(
      getCCSwitchUsageBaseUrl('https://api.yunmian.tech/v1/'),
      'https://api.yunmian.tech'
    )
  })

  test('maps application choices to identifiers supported by CC Switch', () => {
    const apps = [
      'claude',
      'codex',
      'gemini',
      'grokbuild',
      'opencode',
      'openclaw',
      'hermes',
    ] as const

    for (const app of apps) {
      const url = new URL(
        buildCCSwitchURL({
          app,
          name: app,
          models: { model: 'test-model' },
          apiKey: 'sk-test-key',
          serverAddress: 'https://www.yunmian.tech',
          endpoint: getDefaultCCSwitchEndpoint(app, 'https://www.yunmian.tech'),
        })
      )

      assert.equal(url.searchParams.get('app'), app)
      assert.equal(url.searchParams.get('model'), 'test-model')
    }
  })

  test('imports the selected API endpoint instead of forcing the default', () => {
    const url = new URL(
      buildCCSwitchURL({
        app: 'codex',
        name: 'Custom endpoint',
        models: { model: 'gpt-5.6-luna' },
        apiKey: 'sk-test-key',
        serverAddress: 'https://www.yunmian.tech',
        endpoint: 'https://api.yunmian.tech/openai/v1/',
      })
    )

    assert.equal(
      url.searchParams.get('endpoint'),
      'https://api.yunmian.tech/openai/v1'
    )
    assert.equal(
      url.searchParams.get('usageBaseUrl'),
      'https://api.yunmian.tech/openai'
    )
  })

  test('imports token usage query with a separate root base URL', () => {
    const url = new URL(buildURL())

    assert.equal(
      url.searchParams.get('endpoint'),
      'https://www.yunmian.tech/v1'
    )
    assert.equal(url.searchParams.get('apiKey'), 'sk-test-key')
    assert.equal(url.searchParams.get('usageEnabled'), 'true')
    assert.equal(
      url.searchParams.get('usageBaseUrl'),
      'https://www.yunmian.tech'
    )
    assert.equal(
      url.searchParams.get('usageAutoInterval'),
      String(CC_SWITCH_USAGE_AUTO_INTERVAL)
    )

    const config = getUsageConfig()
    assert.equal(config.request.url, '{{baseUrl}}/api/usage/token/')
    assert.equal(config.request.headers.Authorization, 'Bearer {{apiKey}}')
    assert.equal(config.request.headers['Accept-Language'], 'zh-CN')
  })

  test('converts internal token quota to USD units', () => {
    const result = getUsageConfig().extractor({
      code: true,
      data: {
        labels: {
          account_balance: '账户余额',
          key_quota: 'Key 额度',
          api_key: 'API 密钥',
        },
        account: {
          total_available: 4_173_405_439,
        },
        name: 'Codex key',
        total_granted: 5_000_000,
        total_used: 1_000_000,
        total_available: 4_000_000,
        unlimited_quota: false,
      },
    })

    assert.deepEqual(structuredClone(result), [
      {
        isValid: true,
        planName: '账户余额',
        remaining: 8346.810878,
        unit: 'USD',
      },
      {
        isValid: true,
        planName: 'Key 额度',
        total: 10,
        used: 2,
        remaining: 8,
        unit: 'USD',
        extra: 'Codex key',
      },
    ])
  })

  test('uses the CC Switch infinity convention for unlimited keys', () => {
    const result = getUsageConfig().extractor({
      code: true,
      data: {
        account: {
          total_available: 10_000_000,
        },
        name: 'Unlimited key',
        total_used: 500_000,
        unlimited_quota: true,
      },
    })

    const plans = structuredClone(result) as Array<Record<string, unknown>>
    assert.equal(plans.length, 2)
    assert.equal(plans[0].remaining, 20)
    assert.equal(plans[1].total, -1)
    assert.equal(plans[1].used, 1)
    assert.equal('remaining' in plans[1], false)
  })

  test('uses the server quota conversion instead of a fixed divisor', () => {
    const result = getUsageConfig().extractor({
      code: true,
      data: {
        quota_per_unit: 1_000_000,
        account: { total_available: 8_000_000 },
        name: 'Custom quota key',
        total_granted: 4_000_000,
        total_used: 1_000_000,
        total_available: 3_000_000,
        unlimited_quota: false,
      },
    })

    assert.deepEqual(structuredClone(result), [
      {
        isValid: true,
        planName: 'Account Balance',
        remaining: 8,
        unit: 'USD',
      },
      {
        isValid: true,
        planName: 'Key Quota',
        total: 4,
        used: 1,
        remaining: 3,
        unit: 'USD',
        extra: 'Custom quota key',
      },
    ])
  })

  test('does not report a fake zero balance for an older endpoint', () => {
    const result = getUsageConfig().extractor({
      code: true,
      data: {
        name: 'Unlimited key',
        total_used: 82_000_000,
        unlimited_quota: true,
      },
    })

    const plans = structuredClone(result) as Array<Record<string, unknown>>
    assert.equal(plans.length, 1)
    assert.equal(plans[0].planName, 'Key Quota')
    assert.equal(plans[0].used, 164)
  })
})
