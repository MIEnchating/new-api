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

const CHUNK_RELOAD_KEY = 'new-api:chunk-reload-at'
const CHUNK_RELOAD_COOLDOWN_MS = 30_000

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
  return /\/static\/(?:js\/async|css)\//i.test(url)
}

function getResourceLoadError(event: Event): Error | null {
  const target = event.target
  let url = ''

  if (
    typeof HTMLScriptElement !== 'undefined' &&
    target instanceof HTMLScriptElement
  ) {
    url = target.src
  } else if (
    typeof HTMLLinkElement !== 'undefined' &&
    target instanceof HTMLLinkElement
  ) {
    url = target.href
  }

  return isChunkAssetURL(url) ? new Error(`Loading chunk ${url} failed`) : null
}

export function shouldReloadAfterChunkError(
  error: unknown,
  lastReloadAt: number,
  now = Date.now()
): boolean {
  if (!isChunkLoadError(error)) return false

  return (
    !Number.isFinite(lastReloadAt) ||
    now - lastReloadAt > CHUNK_RELOAD_COOLDOWN_MS
  )
}

export function recoverFromChunkLoadError(error: unknown): boolean {
  if (!isChunkLoadError(error) || typeof window === 'undefined') return false

  try {
    const lastReloadAt = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY))
    const now = Date.now()
    if (!shouldReloadAfterChunkError(error, lastReloadAt, now)) return false

    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now))
    window.location.reload()
    return true
  } catch {
    return false
  }
}

export function installChunkLoadErrorRecovery(): () => void {
  if (typeof window === 'undefined') return () => undefined

  const handleError = (event: Event) => {
    const error =
      event instanceof ErrorEvent
        ? event.error || event.message
        : getResourceLoadError(event)
    recoverFromChunkLoadError(error)
  }
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    recoverFromChunkLoadError(event.reason)
  }

  // Resource errors do not bubble, so capture failed async script/style loads.
  window.addEventListener('error', handleError, true)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)

  return () => {
    window.removeEventListener('error', handleError, true)
    window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  }
}
