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
export function formatMonitorPercent(value: number | null | undefined) {
  return value == null
    ? '--'
    : `${Math.max(0, Math.min(100, value)).toFixed(1)}%`
}

export function formatMonitorLatency(value: number | null | undefined) {
  return value == null ? '--' : `${(value / 1000).toFixed(1)} s`
}

export function monitorScoreColor(score: number | null | undefined) {
  if (score == null || !Number.isFinite(score)) {
    return 'color-mix(in srgb, var(--muted-foreground) 25%, transparent)'
  }
  if (score >= 80) return 'var(--success)'
  if (score >= 50) {
    return `color-mix(in srgb, var(--success) ${((score - 50) / 30) * 100}%, var(--warning))`
  }
  return `color-mix(in srgb, var(--warning) ${Math.max(0, score)}%, var(--destructive))`
}
