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
import type { CacheMetricPoint } from './types'

export type CacheChartPoint = Omit<
  CacheMetricPoint,
  'request_count' | 'hit_count' | 'cached_tokens' | 'cache_hit_rate' | 'avg_tps'
> & {
  request_count: number | null
  hit_count: number | null
  cached_tokens: number | null
  cache_hit_rate: number | null
  avg_tps: number | null
  missing: boolean
}

function missingCachePoint(timestamp: number): CacheChartPoint {
  return {
    ts: timestamp,
    request_count: null,
    hit_count: null,
    cached_tokens: null,
    cache_hit_rate: null,
    avg_tps: null,
    has_data: false,
    missing: true,
  }
}

export function buildCacheChartSeries(
  series: CacheMetricPoint[],
  bucketSeconds: number,
  rangeStart?: number,
  rangeEnd?: number
): CacheChartPoint[] {
  if (series.length === 0) return []

  const interval = Math.max(1, bucketSeconds)
  const points = new Map(series.map((point) => [point.ts, point]))
  const timestamps = [...points.keys()].sort((left, right) => left - right)
  const firstTimestamp = timestamps[0]
  const lastTimestamp = timestamps.at(-1) ?? firstTimestamp
  const normalizedStart = Number.isFinite(rangeStart)
    ? Math.floor(Number(rangeStart) / interval) * interval
    : firstTimestamp
  const normalizedEnd = Number.isFinite(rangeEnd)
    ? Math.floor(Number(rangeEnd) / interval) * interval
    : lastTimestamp
  const start = Math.min(normalizedStart, firstTimestamp)
  const end = Math.max(normalizedEnd, lastTimestamp)
  const result: CacheChartPoint[] = []

  for (let timestamp = start; timestamp <= end; timestamp += interval) {
    const point = points.get(timestamp)
    result.push(
      point
        ? {
            ...point,
            request_count: point.request_count ?? null,
            hit_count: point.hit_count ?? null,
            missing: false,
          }
        : missingCachePoint(timestamp)
    )
  }

  return result
}
