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
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'

import { getCacheMetrics } from './api'
import { CacheMonitor } from './cache-monitor'
import { RefreshControl } from './refresh-control'
import type { CacheMetricsResponse } from './types'

type FetchMode = 'initial' | 'refresh'

export function StatusMonitor() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [metrics, setMetrics] = useState<CacheMetricsResponse | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const fetchCacheStatus = useCallback(async (mode: FetchMode) => {
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)
    setFailed(false)
    try {
      const response = await getCacheMetrics()
      if (!response.success) {
        setMetrics(null)
        setFailed(true)
        return
      }
      setMetrics(response)
      setLastUpdated(new Date())
    } catch {
      setMetrics(null)
      setFailed(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchCacheStatus('initial')
  }, [fetchCacheStatus])
  const handleManualRefresh = useCallback(() => {
    void fetchCacheStatus('refresh')
  }, [fetchCacheStatus])

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Channel Monitor')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <RefreshControl
          loading={loading}
          refreshing={refreshing}
          lastUpdated={lastUpdated}
          onRefresh={handleManualRefresh}
        />
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <CacheMonitor
          response={metrics}
          loading={loading}
          failed={failed}
          onRefresh={handleManualRefresh}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
