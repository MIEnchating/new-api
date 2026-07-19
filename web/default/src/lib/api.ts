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
import axios, { type AxiosRequestConfig } from 'axios'
import { t } from 'i18next'
import { toast } from 'sonner'

import { useAuthStore } from '@/stores/auth-store'

declare module 'axios' {
  export interface AxiosRequestConfig {
    skipBusinessError?: boolean
    skipErrorHandler?: boolean
    skipUserHeader?: boolean
    disableDuplicate?: boolean
  }
}

export type ApiRequestConfig = AxiosRequestConfig

// ============================================================================
// Axios Instance Configuration
// ============================================================================

// Base URL: empty string for same-origin API requests
const baseURL = ''

// Create axios instance with default config
export const api = axios.create({
  baseURL,
  withCredentials: true, // Include cookies in cross-origin requests
  headers: {
    'Cache-Control': 'no-store', // Prevent caching
  },
})

// ============================================================================
// Request Deduplication
// ============================================================================

// Deduplicate concurrent GET requests to the same URL
// Prevents multiple identical requests from being sent simultaneously
const inFlightGet = new Map<string, Promise<unknown>>()
const originalGet = api.get.bind(api)

function getHeaderValue(config: ApiRequestConfig, name: string): string | null {
  const headers = config.headers as
    | (Record<string, unknown> & {
        get?: (headerName: string) => unknown
      })
    | undefined
  if (!headers) return null

  const getterValue = headers.get?.(name)
  if (typeof getterValue === 'string' && getterValue) return getterValue

  const key = Object.keys(headers).find(
    (headerName) => headerName.toLowerCase() === name.toLowerCase()
  )
  const value = key ? headers[key] : undefined
  return typeof value === 'string' && value ? value : null
}

function getCachedUserIdentity(): string | null {
  const uid = getUserId()
  if (uid) return `uid:${uid}`

  try {
    const rawUser =
      typeof window !== 'undefined' ? window.localStorage.getItem('user') : null
    if (!rawUser) return null
    const user = JSON.parse(rawUser) as {
      id?: unknown
      username?: unknown
    }
    if (typeof user.id === 'number' && Number.isSafeInteger(user.id)) {
      return `id:${user.id}`
    }
    if (typeof user.username === 'string' && user.username) {
      return `username:${user.username}`
    }
  } catch {
    // Ignore malformed/unavailable storage and treat the request as anonymous.
  }
  return null
}

/**
 * Build a safe in-flight GET key. Requests with an explicit bearer token are
 * never shared because the token is the authoritative identity and should not
 * be copied into an in-memory deduplication key.
 */
export function getGetRequestKey(
  url: string,
  config: ApiRequestConfig = {},
  userIdentity: string | null | undefined = undefined
): string | null {
  if (config.disableDuplicate || getHeaderValue(config, 'Authorization')) {
    return null
  }

  const params = config.params ? JSON.stringify(config.params) : '{}'
  const identity = userIdentity ?? getCachedUserIdentity() ?? 'anonymous'
  const userHeaderMode = config.skipUserHeader
    ? 'cookie-only'
    : 'identity-header'
  return `${url}?${params}#${identity}:${userHeaderMode}`
}

api.get = ((url: string, config: ApiRequestConfig = {}) => {
  const key = getGetRequestKey(url, config)
  if (!key) return originalGet(url, config)

  // Return existing in-flight request if available
  const existing = inFlightGet.get(key)
  if (existing) return existing

  // Create new request and clean up after completion
  const req = originalGet(url, config).finally(() => inFlightGet.delete(key))
  inFlightGet.set(key, req)
  return req
}) as typeof api.get

// ============================================================================
// Response Interceptor
// ============================================================================

// Handle business logic errors and HTTP errors globally
api.interceptors.response.use(
  (response) => {
    const skipBusiness = response.config.skipBusinessError

    // Unified business response format: { success, message, data }
    if (
      !skipBusiness &&
      response &&
      response.data &&
      typeof response.data.success === 'boolean'
    ) {
      if (!response.data.success) {
        // Show error toast for business failures
        const msg = response.data.message || t('Request failed')
        toast.error(msg)
      }
    }
    return response
  },
  (error) => {
    const skip = error?.config?.skipErrorHandler
    const status = error?.response?.status

    if (status === 401) {
      try {
        useAuthStore.getState().auth.reset()
      } catch {
        /* empty */
      }

      if (!skip) {
        toast.error(t('Session expired!'))
      }
    } else if (!skip) {
      // Other errors: show error message from response or default
      const msg =
        error?.response?.data?.message || error?.message || t('Request failed')
      toast.error(msg)
    }
    return Promise.reject(error)
  }
)

// ============================================================================
// Common Headers Utility
// ============================================================================

/**
 * Get user ID from localStorage
 */
function getUserId(): string | null {
  try {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem('uid')
    }
  } catch {
    /* empty */
  }
  return null
}

/**
 * Get common request headers (for both axios and SSE requests)
 */
export function getCommonHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const uid = getUserId()
  if (uid) {
    headers['New-Api-User'] = uid
  }

  return headers
}

// ============================================================================
// Request Interceptor
// ============================================================================

/**
 * Apply the browser's cached user identity header unless a request explicitly
 * needs to authenticate from its session cookie alone (for example, `/self`
 * during sign-in recovery).
 */
export function applyUserHeader<T extends ApiRequestConfig>(
  config: T,
  userId: string | null = getUserId()
): T {
  const headers = config.headers as
    | (Record<string, unknown> & {
        delete?: (name: string) => void
      })
    | undefined

  if (config.skipUserHeader) {
    if (headers?.delete) {
      headers.delete('New-Api-User')
    } else if (headers) {
      delete headers['New-Api-User']
      delete headers['new-api-user']
    }
    return config
  }

  if (userId && headers) {
    headers['New-Api-User'] = userId
  }
  return config
}

// Attach user ID header for all requests
api.interceptors.request.use((config) => applyUserHeader(config))

// ============================================================================
// Common API Functions
// ============================================================================

// ----------------------------------------------------------------------------
// User APIs
// ----------------------------------------------------------------------------

// Get current user info
export async function getSelf() {
  const res = await api.get('/api/user/self', {
    // Avoid global 401 toast during guards/preloads
    skipErrorHandler: true,
    // A failed self check is handled by the caller so it does not emit a
    // duplicate business-error toast while the login flow is recovering.
    skipBusinessError: true,
    // Resolve the authoritative cookie session even when localStorage.uid is
    // stale or belongs to a different account.
    skipUserHeader: true,
    // Do not reuse an in-flight self request that may have been created with
    // a stale identity header before this guard ran.
    disableDuplicate: true,
  })
  return res.data
}

// Get user available models
export async function getUserModels(): Promise<{
  success: boolean
  message?: string
  data?: string[]
}> {
  const res = await api.get('/api/user/models')
  return res.data
}

// Get user groups with descriptions and ratios
export async function getUserGroups(): Promise<{
  success: boolean
  message?: string
  data?: Record<
    string,
    { desc: string; ratio: number | string; order?: number }
  >
}> {
  const res = await api.get('/api/user/self/groups')
  return res.data
}

// ----------------------------------------------------------------------------
// System APIs
// ----------------------------------------------------------------------------

// Get system status
export async function getStatus() {
  const res = await api.get('/api/status')
  return res.data?.data as Record<string, unknown>
}

// Get system notice
export async function getNotice(): Promise<{
  success: boolean
  message?: string
  data?: string
}> {
  const res = await api.get('/api/notice')
  return res.data
}

// ----------------------------------------------------------------------------
// 2FA Management APIs
// ----------------------------------------------------------------------------

// Get 2FA status
export async function get2FAStatus() {
  const res = await api.get('/api/user/2fa/status')
  return res.data
}

// Setup 2FA
export async function setup2FA() {
  const res = await api.post('/api/user/2fa/setup')
  return res.data
}

// Enable 2FA with verification code
export async function enable2FA(code: string) {
  const res = await api.post('/api/user/2fa/enable', { code })
  return res.data
}

// Disable 2FA with verification code
export async function disable2FA(code: string) {
  const res = await api.post('/api/user/2fa/disable', { code })
  return res.data
}

// Regenerate 2FA backup codes
export async function regenerate2FABackupCodes(code: string) {
  const res = await api.post('/api/user/2fa/backup_codes', { code })
  return res.data
}
