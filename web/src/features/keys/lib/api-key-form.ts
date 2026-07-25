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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'

import { DEFAULT_GROUP } from '../constants'
import {
  apiKeyGroupRouteSchema,
  type ApiKeyFormData,
  type ApiKey,
  type ApiKeyGroupRoute,
} from '../types'

// ============================================================================
// Form Schema
// ============================================================================

export function getApiKeyFormSchema(t: TFunction) {
  const enabledGroupRouteSchema = apiKeyGroupRouteSchema.extend({
    group: z.string().min(1, t('Please select a group')),
    priority: z.number().int().min(0, t('Priority must be zero or greater')),
    cooldown_seconds: z
      .number()
      .int()
      .min(0, t('Cooldown must be zero or greater'))
      .max(31536000, t('Cooldown cannot exceed 31536000 seconds')),
  })

  return z
    .object({
      name: z.string().min(1, t('Please enter a name')),
      remain_quota_dollars: z.number().optional(),
      expired_time: z.date().optional(),
      unlimited_quota: z.boolean(),
      model_limits: z.array(z.string()),
      allow_ips: z.string().optional(),
      group: z.string().optional(),
      cross_group_retry: z.boolean().optional(),
      group_route_enabled: z.boolean().optional(),
      group_route_sticky: z.boolean().optional(),
      group_routes: z.array(apiKeyGroupRouteSchema).optional(),
      tokenCount: z.number().min(1).optional(),
    })
    .superRefine((data, ctx) => {
      if (
        !data.unlimited_quota &&
        (data.remain_quota_dollars === undefined ||
          data.remain_quota_dollars < 0)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['remain_quota_dollars'],
          message: t('Quota must be zero or greater'),
        })
      }

      if (!data.group_route_enabled) {
        if (!data.group?.trim()) {
          ctx.addIssue({
            code: 'custom',
            path: ['group'],
            message: t('Please select a group'),
          })
        }
        return
      }

      if (!data.group_routes || data.group_routes.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['group_routes'],
          message: t('Please add at least one route group'),
        })
        return
      }

      if (!data.group_routes.some((route) => route.enabled !== false)) {
        ctx.addIssue({
          code: 'custom',
          path: ['group_routes'],
          message: t('Please enable at least one route group'),
        })
      }

      const groups = new Set<string>()
      data.group_routes.forEach((route, index) => {
        const result = enabledGroupRouteSchema.safeParse(route)
        if (!result.success) {
          result.error.issues.forEach((issue) => {
            ctx.addIssue({
              ...issue,
              path: ['group_routes', index, ...issue.path],
            })
          })
        }

        if (groups.has(route.group)) {
          ctx.addIssue({
            code: 'custom',
            path: ['group_routes', index, 'group'],
            message: t('Duplicate route group'),
          })
        }
        groups.add(route.group)
      })
    })
}

export type ApiKeyFormValues = z.infer<ReturnType<typeof getApiKeyFormSchema>>

// ============================================================================
// Form Defaults
// ============================================================================

export const API_KEY_FORM_DEFAULT_VALUES: ApiKeyFormValues = {
  name: '',
  remain_quota_dollars: 10,
  expired_time: undefined,
  unlimited_quota: true,
  model_limits: [],
  allow_ips: '',
  group: DEFAULT_GROUP,
  cross_group_retry: true,
  group_route_enabled: false,
  group_route_sticky: false,
  group_routes: [
    {
      group: DEFAULT_GROUP,
      priority: 1,
      cooldown_seconds: 60,
      enabled: true,
    },
  ],
  tokenCount: 1,
}

export function getApiKeyFormDefaultValues(): ApiKeyFormValues {
  return {
    ...API_KEY_FORM_DEFAULT_VALUES,
    group: '',
    cross_group_retry: false,
    group_routes: [
      { group: '', priority: 1, cooldown_seconds: 60, enabled: true },
    ],
  }
}

export function getAutomaticGroupRoutePriorities(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => count - index)
}

export function parseApiKeyGroupRouteConfig(
  config?: string | null
): ApiKeyGroupRoute[] {
  if (!config) {
    return []
  }
  try {
    const parsed = JSON.parse(config)
    const result = z.array(apiKeyGroupRouteSchema).safeParse(parsed)
    if (!result.success) {
      return []
    }
    return result.data
      .map((route) => ({
        ...route,
        enabled: route.enabled !== false,
      }))
      .sort((a, b) => b.priority - a.priority)
  } catch {
    return []
  }
}

// ============================================================================
// Form Data Transformation
// ============================================================================

/**
 * Transform form data to API payload
 */
export function transformFormDataToPayload(
  data: ApiKeyFormValues
): ApiKeyFormData {
  const groupRoutes = data.group_route_enabled ? data.group_routes || [] : []
  return {
    name: data.name,
    remain_quota: data.unlimited_quota
      ? 0
      : parseQuotaFromDollars(data.remain_quota_dollars || 0),
    expired_time: data.expired_time
      ? Math.floor(data.expired_time.getTime() / 1000)
      : -1,
    unlimited_quota: data.unlimited_quota,
    model_limits_enabled: data.model_limits.length > 0,
    model_limits: data.model_limits.join(','),
    allow_ips: data.allow_ips || '',
    group: data.group_route_enabled ? '' : data.group || '',
    cross_group_retry:
      !data.group_route_enabled && data.group === 'auto'
        ? !!data.cross_group_retry
        : false,
    group_route_sticky: data.group_route_enabled
      ? !!data.group_route_sticky
      : false,
    group_route_config:
      groupRoutes.length > 0
        ? JSON.stringify(
            groupRoutes.map((route) => ({
              group: route.group,
              priority: route.priority,
              cooldown_seconds: route.cooldown_seconds,
              enabled: route.enabled !== false,
            }))
          )
        : '',
  }
}

/**
 * Transform API key data to form defaults
 */
export function transformApiKeyToFormDefaults(
  apiKey: ApiKey
): ApiKeyFormValues {
  const groupRoutes = parseApiKeyGroupRouteConfig(apiKey.group_route_config)
  return {
    name: apiKey.name,
    remain_quota_dollars: apiKey.unlimited_quota
      ? 0
      : quotaUnitsToDollars(apiKey.remain_quota),
    expired_time:
      apiKey.expired_time > 0
        ? new Date(apiKey.expired_time * 1000)
        : undefined,
    unlimited_quota: apiKey.unlimited_quota,
    model_limits: apiKey.model_limits
      ? apiKey.model_limits.split(',').filter(Boolean)
      : [],
    allow_ips: apiKey.allow_ips || '',
    group:
      groupRoutes.length > 0 ? DEFAULT_GROUP : apiKey.group || DEFAULT_GROUP,
    cross_group_retry:
      groupRoutes.length > 0 ? false : !!apiKey.cross_group_retry,
    group_route_enabled: groupRoutes.length > 0,
    group_route_sticky:
      groupRoutes.length > 0 ? !!apiKey.group_route_sticky : false,
    group_routes:
      groupRoutes.length > 0
        ? groupRoutes
        : [
            {
              group: DEFAULT_GROUP,
              priority: 1,
              cooldown_seconds: 60,
              enabled: true,
            },
          ],
    tokenCount: 1,
  }
}
