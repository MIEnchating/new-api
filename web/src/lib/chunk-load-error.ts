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
const CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading (?:CSS )?chunk [^ ]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
]

const CHUNK_RECOVERY_KEY = 'new-api:chunk-recovery'
const CHUNK_RELOAD_COOLDOWN_MS = 30_000
const CHUNK_RECOVERY_QUERY = '__newapi_reload'
// A broken deployment can emit a different failed asset on every reload.
// Keep automatic recovery bounded so those errors cannot trap the browser in
// a reload loop. Users can still reload manually after the cap is reached.
const MAX_RECOVERY_ATTEMPTS_PER_BUILD = 2

export interface ChunkRecoveryAttempt {
  buildRevision: string
  signature: string
  attemptedAt: number
  attemptCount?: number
}

export function isChunkLoadError(error: unknown): boolean {
  if (typeof error === 'string') {
    return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(error))
  }

  if (!error || typeof error !== 'object') return false

  const record = error as Record<string, unknown>
  return [record.name, record.message].some(
    (value) =>
      typeof value === 'string' &&
      CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(value))
  )
}

export function isChunkAssetURL(url: string): boolean {
  return /\/static\/(?:js|css)\//i.test(url)
}

export function getChunkErrorSignature(error: unknown): string | null {
  if (!isChunkLoadError(error)) return null

  const candidates: unknown[] =
    typeof error === 'object' && error
      ? [
          (error as Record<string, unknown>).request,
          (error as Record<string, unknown>).url,
          (error as Record<string, unknown>).message,
          (error as Record<string, unknown>).name,
        ]
      : [error]

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue

    const asset = candidate.match(
      /(?:https?:\/\/[^\s)'"]+)?\/static\/(?:js|css)\/[^\s)'"]+/i
    )?.[0]
    if (asset) return asset
  }

  const fallback = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim().length > 0
  )
  return fallback?.trim() ?? 'unknown-chunk'
}

export function shouldReloadAfterChunkError(
  error: unknown,
  previousAttempt: ChunkRecoveryAttempt | null,
  buildRevision: string,
  now = Date.now()
): boolean {
  const signature = getChunkErrorSignature(error)
  if (!signature) return false
  if (!previousAttempt) return true
  if (previousAttempt.buildRevision !== buildRevision) return true
  const attemptCount = Number.isFinite(previousAttempt.attemptCount)
    ? Math.max(0, previousAttempt.attemptCount ?? 0)
    : 1
  if (attemptCount >= MAX_RECOVERY_ATTEMPTS_PER_BUILD) return false
  if (previousAttempt.signature !== signature) return true
  if (!Number.isFinite(previousAttempt.attemptedAt)) return true
  if (previousAttempt.attemptedAt > now) return true

  return now - previousAttempt.attemptedAt > CHUNK_RELOAD_COOLDOWN_MS
}

export function readChunkRecoveryAttempt(
  value: string | null
): ChunkRecoveryAttempt | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as Partial<ChunkRecoveryAttempt>
    if (
      typeof parsed.buildRevision !== 'string' ||
      typeof parsed.signature !== 'string' ||
      typeof parsed.attemptedAt !== 'number'
    ) {
      return null
    }
    return parsed as ChunkRecoveryAttempt
  } catch {
    return null
  }
}

export function buildChunkRecoveryURL(href: string, now: number): string {
  const url = new URL(href)
  url.searchParams.set(CHUNK_RECOVERY_QUERY, String(now))
  return url.href
}

export function recoverFromChunkLoadError(error: unknown): boolean {
  if (!isChunkLoadError(error) || typeof window === 'undefined') return false

  try {
    const signature = getChunkErrorSignature(error)
    if (!signature) return false

    const buildRevision = window.__APP_BUILD__?.rev ?? 'unknown-build'
    const previousAttempt = readChunkRecoveryAttempt(
      window.sessionStorage.getItem(CHUNK_RECOVERY_KEY)
    )
    const now = Date.now()
    if (
      !shouldReloadAfterChunkError(error, previousAttempt, buildRevision, now)
    ) {
      return false
    }

    const attempt: ChunkRecoveryAttempt = {
      buildRevision,
      signature,
      attemptedAt: now,
      attemptCount:
        (previousAttempt?.buildRevision === buildRevision
          ? (previousAttempt.attemptCount ?? 1)
          : 0) + 1,
    }
    window.sessionStorage.setItem(CHUNK_RECOVERY_KEY, JSON.stringify(attempt))
    window.location.replace(buildChunkRecoveryURL(window.location.href, now))
    return true
  } catch {
    return false
  }
}
