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
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import type { SystemStatus } from '@/features/auth/types'
import { DEFAULT_SYSTEM_NAME, DEFAULT_LOGO } from '@/lib/constants'
import { applyFaviconToDom } from '@/lib/dom-utils'
import { cacheStatus, statusQueryOptions } from '@/lib/status-query'
import { normalizeSystemLogo } from '@/lib/system-branding'
import {
  useSystemConfigStore,
  type CurrencyConfig,
  type CurrencyDisplayType,
  type SystemConfig,
  DEFAULT_CURRENCY_CONFIG,
} from '@/stores/system-config-store'

interface UseSystemConfigOptions {
  /** Automatically fetch config from backend (use only in root component) */
  autoLoad?: boolean
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

/**
 * Map `/api/status` response data to our persisted system config structure
 */
export function mapStatusDataToConfig(
  data: SystemStatus | undefined
): Partial<SystemConfig> {
  if (!data) return {}

  const quotaDisplayType =
    (data.quota_display_type as CurrencyDisplayType | undefined) ??
    DEFAULT_CURRENCY_CONFIG.quotaDisplayType

  const currency: CurrencyConfig = {
    displayInCurrency:
      data.display_in_currency ?? DEFAULT_CURRENCY_CONFIG.displayInCurrency,
    quotaDisplayType,
    quotaPerUnit: toNumber(
      data.quota_per_unit,
      DEFAULT_CURRENCY_CONFIG.quotaPerUnit
    ),
    usdExchangeRate: toNumber(
      data.usd_exchange_rate,
      DEFAULT_CURRENCY_CONFIG.usdExchangeRate
    ),
    customCurrencySymbol:
      data.custom_currency_symbol?.trim() ||
      DEFAULT_CURRENCY_CONFIG.customCurrencySymbol,
    customCurrencyExchangeRate: toNumber(
      data.custom_currency_exchange_rate,
      DEFAULT_CURRENCY_CONFIG.customCurrencyExchangeRate
    ),
  }

  return {
    systemName: data.system_name || DEFAULT_SYSTEM_NAME,
    logo: normalizeSystemLogo(data.logo),
    footerHtml:
      typeof data.footer_html === 'string' ? data.footer_html : undefined,
    demoSiteEnabled: data.demo_site_enabled,
    displayTokenStatEnabled: data.display_token_stat_enabled,
    currency,
  }
}

// Preload image and return cleanup function
function preloadImage(
  src: string,
  onLoad: () => void,
  onError: () => void
): () => void {
  const img = new Image()
  img.addEventListener('load', onLoad)
  img.addEventListener('error', onError)
  img.src = src

  return () => {
    img.removeEventListener('load', onLoad)
    img.removeEventListener('error', onError)
  }
}

/**
 * System configuration hook with auto-loading and logo preloading
 *
 * @example
 * // Root component - auto-load from backend
 * useSystemConfig({ autoLoad: true })
 *
 * @example
 * // Other components - use cached config
 * const { systemName, logo, loading } = useSystemConfig()
 */
export function useSystemConfig(options: UseSystemConfigOptions = {}) {
  const { autoLoad = false } = options
  const statusQuery = useQuery({ ...statusQueryOptions, enabled: autoLoad })
  const {
    config,
    loading,
    loadedLogoUrl,
    setConfig,
    setLoadedLogoUrl,
    setLoading,
  } = useSystemConfigStore()

  useEffect(() => {
    if (!autoLoad) return
    setLoading(statusQuery.isLoading)
  }, [autoLoad, setLoading, statusQuery.isLoading])

  useEffect(() => {
    if (!autoLoad || !statusQuery.data) return
    setConfig(mapStatusDataToConfig(statusQuery.data))
    cacheStatus(statusQuery.data)
  }, [autoLoad, setConfig, statusQuery.data])

  useEffect(() => {
    if (!autoLoad || !statusQuery.error) return
    // eslint-disable-next-line no-console
    console.error('Failed to load system config:', statusQuery.error)
  }, [autoLoad, statusQuery.error])

  useEffect(() => {
    if (!config.systemName || typeof document === 'undefined') return
    document.title = config.systemName
    const metaTitle =
      document.querySelector<HTMLMetaElement>('meta[name="title"]')
    metaTitle?.setAttribute('content', config.systemName)
  }, [config.systemName])

  // Preload logo image when URL changes
  useEffect(() => {
    const { logo } = config

    // Skip if logo is already loaded
    if (!logo || logo === loadedLogoUrl) return

    // Preload new logo
    return preloadImage(
      logo,
      () => {
        setLoadedLogoUrl(logo)
        applyFaviconToDom(logo)
      },
      () => {
        if (logo !== DEFAULT_LOGO) {
          // eslint-disable-next-line no-console
          console.error('Failed to load logo:', logo)
        }
        // Mark as loaded even on error to prevent infinite retry
        setLoadedLogoUrl(logo)
      }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.logo, loadedLogoUrl, setLoadedLogoUrl])

  return {
    ...config,
    loading,
    logoLoaded: config.logo === loadedLogoUrl && !!loadedLogoUrl,
  }
}
