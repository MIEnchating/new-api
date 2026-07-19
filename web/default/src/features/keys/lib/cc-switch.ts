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

export type CCSwitchAppType = 'claude' | 'codex' | 'gemini'

export const CC_SWITCH_USAGE_AUTO_INTERVAL = 5

export const CC_SWITCH_USAGE_SCRIPT = `({
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

export function resolveCCSwitchServerAddress(
  rawStatus: string | null,
  currentOrigin: string
): string {
  if (rawStatus) {
    try {
      const status = JSON.parse(rawStatus) as { server_address?: unknown }
      if (
        typeof status.server_address === 'string' &&
        status.server_address.trim()
      ) {
        return normalizeServerAddress(status.server_address)
      }
    } catch {
      // Fall back to the current origin when the cached status is stale.
    }
  }
  return normalizeServerAddress(currentOrigin)
}

interface BuildCCSwitchURLParams {
  app: CCSwitchAppType
  name: string
  models: Record<string, string>
  apiKey: string
  serverAddress: string
  language?: string
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
  name,
  models,
  apiKey,
  serverAddress: rawServerAddress,
  language,
}: BuildCCSwitchURLParams): string {
  const serverAddress = normalizeServerAddress(rawServerAddress)
  const endpoint = app === 'codex' ? `${serverAddress}/v1` : serverAddress
  const params = new URLSearchParams()
  params.set('resource', 'provider')
  params.set('app', app)
  params.set('name', name)
  params.set('endpoint', endpoint)
  params.set('apiKey', apiKey)
  for (const [key, value] of Object.entries(models)) {
    if (value) params.set(key, value)
  }
  params.set('homepage', serverAddress)
  params.set('enabled', 'true')
  params.set('usageEnabled', 'true')
  const usageScript = CC_SWITCH_USAGE_SCRIPT.replace(
    '{{language}}',
    normalizeCCSwitchLanguage(language)
  )
  params.set('usageScript', encodeBase64Utf8(usageScript))
  params.set('usageBaseUrl', serverAddress)
  params.set('usageAutoInterval', CC_SWITCH_USAGE_AUTO_INTERVAL.toString())
  return `ccswitch://v1/import?${params.toString()}`
}
