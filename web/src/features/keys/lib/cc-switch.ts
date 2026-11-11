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
export type CCSwitchApiFormat =
  | 'anthropic'
  | 'openai_chat'
  | 'openai_responses'
  | 'gemini_native'

const ALL_API_FORMATS = [
  'anthropic',
  'openai_chat',
  'openai_responses',
  'gemini_native',
] as const
const OPENAI_AND_ANTHROPIC_FORMATS = [
  'openai_chat',
  'openai_responses',
  'anthropic',
] as const
const GEMINI_API_FORMATS = ['gemini_native'] as const

export const CC_SWITCH_APP_CONFIGS = {
  claude: {
    label: 'Claude Code',
    defaultApiFormat: 'anthropic',
    apiFormats: ALL_API_FORMATS,
  },
  'claude-desktop': {
    label: 'Claude Desktop',
    defaultApiFormat: 'anthropic',
    apiFormats: ALL_API_FORMATS,
  },
  codex: {
    label: 'Codex',
    defaultApiFormat: 'openai_responses',
    apiFormats: OPENAI_AND_ANTHROPIC_FORMATS,
  },
  copilot: {
    label: 'GitHub Copilot CLI',
    defaultApiFormat: 'openai_chat',
    apiFormats: OPENAI_AND_ANTHROPIC_FORMATS,
  },
  gemini: {
    label: 'Gemini CLI',
    defaultApiFormat: 'gemini_native',
    apiFormats: GEMINI_API_FORMATS,
  },
  agy: {
    label: 'Antigravity CLI',
    defaultApiFormat: 'gemini_native',
    apiFormats: GEMINI_API_FORMATS,
  },
  grokbuild: {
    label: 'Grok Build',
    defaultApiFormat: 'openai_responses',
    apiFormats: OPENAI_AND_ANTHROPIC_FORMATS,
  },
  opencode: {
    label: 'OpenCode',
    defaultApiFormat: 'openai_chat',
    apiFormats: ALL_API_FORMATS,
  },
  openclaw: {
    label: 'OpenClaw',
    defaultApiFormat: 'openai_chat',
    apiFormats: ALL_API_FORMATS,
  },
  hermes: {
    label: 'Hermes',
    defaultApiFormat: 'openai_chat',
    apiFormats: OPENAI_AND_ANTHROPIC_FORMATS,
  },
  pi: {
    label: 'Pi',
    defaultApiFormat: 'openai_chat',
    apiFormats: ALL_API_FORMATS,
  },
  mcode: {
    label: 'MiniMax Code',
    defaultApiFormat: 'openai_chat',
    apiFormats: OPENAI_AND_ANTHROPIC_FORMATS,
  },
  kimi: {
    label: 'Kimi Code',
    defaultApiFormat: 'openai_chat',
    apiFormats: ALL_API_FORMATS,
  },
  dsh: {
    label: 'DeepSeek Harness',
    defaultApiFormat: 'openai_chat',
    apiFormats: OPENAI_AND_ANTHROPIC_FORMATS,
  },
  omp: {
    label: 'Oh My Pi',
    defaultApiFormat: 'openai_chat',
    apiFormats: ALL_API_FORMATS,
  },
} as const

export type CCSwitchAppType = keyof typeof CC_SWITCH_APP_CONFIGS

export const CC_SWITCH_USAGE_AUTO_INTERVAL = 5
export const CC_SWITCH_LATEST_RELEASE_URL =
  'https://github.com/farion1231/cc-switch/releases/latest'

const CC_SWITCH_USAGE_SCRIPT = `({
  request: {
    url: "{{baseUrl}}/api/usage/token/",
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Accept-Language": "{{language}}",
      "Authorization": "Bearer {{apiKey}}"
    }
  },
  extractor: function (response) {
    var data = response && response.data;
    if (response && response.code === true && data) {
	  var quotaPerUnit = Number(data.quota_per_unit);
	  if (!Number.isFinite(quotaPerUnit) || quotaPerUnit <= 0) {
	    quotaPerUnit = 500000;
	  }
      var toQuota = function (value) {
        var amount = Number(value);
		return Number.isFinite(amount) ? amount / quotaPerUnit : 0;
      };
      var labels = data.labels || {};
      var results = [];
      if (data.account && data.account.total_available != null) {
        results.push({
          isValid: true,
          planName: labels.account_balance || "Account Balance",
          remaining: toQuota(data.account.total_available),
          unit: "USD"
        });
      }
      var keyResult = {
        isValid: true,
        planName: labels.key_quota || "Key Quota",
        total: data.unlimited_quota === true ? -1 : toQuota(data.total_granted),
        used: toQuota(data.total_used),
        unit: "USD",
        extra: data.name || labels.api_key || "API Key"
      };
      if (data.unlimited_quota !== true) {
        keyResult.remaining = toQuota(data.total_available);
      }
      results.push(keyResult);
      return results;
    }
    return {
      isValid: false,
      invalidMessage: (response && response.message) || "Usage query failed"
    };
  }
})`

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function normalizeServerAddress(serverAddress: string): string {
  return serverAddress.trim().replace(/\/+$/, '')
}

function parseCCSwitchStatus(
  rawStatus: unknown
): Record<string, unknown> | null {
  if (typeof rawStatus === 'string') {
    try {
      const parsed = JSON.parse(rawStatus) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  return rawStatus && typeof rawStatus === 'object' && !Array.isArray(rawStatus)
    ? (rawStatus as Record<string, unknown>)
    : null
}

export function resolveCCSwitchServerAddress(
  rawStatus: unknown,
  currentOrigin: string
): string {
  const status = parseCCSwitchStatus(rawStatus)
  if (
    typeof status?.server_address === 'string' &&
    status.server_address.trim()
  ) {
    return normalizeServerAddress(status.server_address)
  }
  return normalizeServerAddress(currentOrigin)
}

export interface CCSwitchEndpointInfo {
  url: string
  route: string
  description: string
  color: string
}

export function resolveCCSwitchEndpointInfo(
  rawStatus: unknown,
  currentOrigin: string
): CCSwitchEndpointInfo[] {
  const status = parseCCSwitchStatus(rawStatus)
  const apiInfo =
    status?.api_info_enabled !== false && Array.isArray(status?.api_info)
      ? status.api_info
      : []
  const endpoints = apiInfo.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    if (
      typeof record.url !== 'string' ||
      !isValidCCSwitchEndpoint(record.url)
    ) {
      return []
    }
    return [
      {
        url: normalizeServerAddress(record.url),
        route: typeof record.route === 'string' ? record.route.trim() : '',
        description:
          typeof record.description === 'string'
            ? record.description.trim()
            : '',
        color: typeof record.color === 'string' ? record.color.trim() : '',
      },
    ]
  })

  const uniqueEndpoints = endpoints.filter(
    (endpoint, index) =>
      endpoints.findIndex((item) => item.url === endpoint.url) === index
  )
  return uniqueEndpoints.length > 0
    ? uniqueEndpoints
    : [
        {
          url: resolveCCSwitchServerAddress(status, currentOrigin),
          route: '',
          description: '',
          color: '',
        },
      ]
}

interface BuildCCSwitchURLParams {
  app: CCSwitchAppType
  apiFormat?: CCSwitchApiFormat
  name: string
  models: Record<string, string>
  additionalModels?: string[]
  apiKey: string
  serverAddress: string
  endpoint: string
  usageBaseUrl?: string
  iconUrl?: string
  language?: string
}

export function getDefaultCCSwitchEndpoint(
  app: CCSwitchAppType,
  serverAddress: string,
  apiFormat: CCSwitchApiFormat = CC_SWITCH_APP_CONFIGS[app].defaultApiFormat
): string {
  const baseAddress = normalizeServerAddress(serverAddress).replace(
    /\/v1(?:beta)?$/i,
    ''
  )
  if (apiFormat === 'gemini_native') {
    // OpenCode's Google AI SDK expects a versioned base URL. The other
    // clients (and CC Switch's Gemini route) add the API version themselves.
    return app === 'opencode' ? `${baseAddress}/v1beta` : baseAddress
  }
  if (apiFormat === 'anthropic' && app !== 'opencode') return baseAddress
  return `${baseAddress}/v1`
}

export function getCCSwitchUsageBaseUrl(endpoint: string): string {
  return normalizeServerAddress(endpoint).replace(/\/v1(?:beta)?$/i, '')
}

export function isValidCCSwitchEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint.trim())
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.host)
    )
  } catch {
    return false
  }
}

export function normalizeCCSwitchLanguage(language?: string): string {
  const normalized = language?.trim().toLowerCase() ?? ''
  if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hant')) {
    return 'zh-TW'
  }
  if (normalized.startsWith('zh')) return 'zh-CN'
  return 'en'
}

export function buildCCSwitchURL({
  app,
  apiFormat = CC_SWITCH_APP_CONFIGS[app].defaultApiFormat,
  name,
  models,
  additionalModels = [],
  apiKey,
  serverAddress: rawServerAddress,
  endpoint: rawEndpoint,
  usageBaseUrl: rawUsageBaseUrl,
  iconUrl,
  language,
}: BuildCCSwitchURLParams): string {
  const supportedFormats: readonly CCSwitchApiFormat[] =
    CC_SWITCH_APP_CONFIGS[app].apiFormats
  if (!supportedFormats.includes(apiFormat)) {
    throw new Error('Unsupported CC Switch API format')
  }
  const serverAddress = normalizeServerAddress(rawServerAddress)
  const endpoint = normalizeServerAddress(rawEndpoint)
  const usageBaseUrl = getCCSwitchUsageBaseUrl(rawUsageBaseUrl ?? endpoint)
  const params = new URLSearchParams()
  params.set('resource', 'provider')
  params.set('app', app)
  params.set('apiFormat', apiFormat)
  params.set('name', name)
  params.set('endpoint', endpoint)
  params.set('apiKey', apiKey)
  for (const [key, value] of Object.entries(models)) {
    if (value.trim()) params.set(key, value.trim())
  }
  if (app === 'copilot' && additionalModels.length > 0) {
    const modelIds = [
      ...new Set(
        [models.model ?? '', ...additionalModels]
          .map((model) => model.trim())
          .filter(Boolean)
      ),
    ]
    params.set('configFormat', 'json')
    params.set(
      'config',
      encodeBase64Utf8(
        JSON.stringify({
          provider: { baseUrl: endpoint, apiKey },
          models: modelIds.map((id) => ({ id })),
        })
      )
    )
  }
  params.set('homepage', serverAddress)
  if (iconUrl) {
    try {
      const url = new URL(iconUrl, `${serverAddress}/`)
      if (url.protocol === 'https:' && !url.username && !url.password) {
        params.set('iconUrl', url.href)
      }
    } catch {
      // An invalid site logo must not prevent importing the provider.
    }
  }
  params.set('enabled', 'true')
  params.set('usageEnabled', 'true')
  const usageScript = CC_SWITCH_USAGE_SCRIPT.replace(
    '{{language}}',
    normalizeCCSwitchLanguage(language)
  )
  params.set('usageScript', encodeBase64Utf8(usageScript))
  params.set('usageBaseUrl', usageBaseUrl)
  params.set('usageAutoInterval', CC_SWITCH_USAGE_AUTO_INTERVAL.toString())
  return `ccswitch://v1/import?${params.toString()}`
}
