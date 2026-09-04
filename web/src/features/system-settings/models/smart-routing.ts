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
import * as z from 'zod'

export type SmartRoutingGroupRouteForm = {
  group: string
  priority: number
  cooldown_seconds: number
  enabled: boolean
}

export type SmartRoutingTemplateForm = {
  id: string
  name: string
  description: string
  enabled: boolean
  group_routes: SmartRoutingGroupRouteForm[]
  group_route_sticky: boolean
}

export type SmartRoutingFormValues = {
  enabled: boolean
  templates: SmartRoutingTemplateForm[]
}

type Translator = (key: string, options?: { number: number }) => string

export function createSmartRoutingSchema(t: Translator) {
  const routeSchema = z.object({
    group: z.string().trim().min(1, t('Please select a group')),
    priority: z.number().int().min(0, t('Priority must be zero or greater')),
    cooldown_seconds: z
      .number()
      .int()
      .min(1, t('Cooldown must be at least one second'))
      .max(31536000, t('Cooldown cannot exceed 31536000 seconds')),
    enabled: z.boolean(),
  })

  const templateSchema = z
    .object({
      id: z.string().trim().min(1).max(64),
      name: z.string().trim().min(1, t('Template name is required')).max(100),
      description: z.string().trim().max(500),
      enabled: z.boolean(),
      group_routes: z.array(routeSchema).max(100),
      group_route_sticky: z.boolean(),
    })
    .superRefine((template, context) => {
      if (template.enabled && template.group_routes.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['group_routes'],
          message: t('Please add at least one route group'),
        })
      }
      if (
        template.enabled &&
        !template.group_routes.some((route) => route.enabled)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['group_routes'],
          message: t('Please enable at least one route group'),
        })
      }

      const groups = new Set<string>()
      template.group_routes.forEach((route, index) => {
        if (groups.has(route.group)) {
          context.addIssue({
            code: 'custom',
            path: ['group_routes', index, 'group'],
            message: t('Duplicate route group'),
          })
        }
        groups.add(route.group)
      })
    })

  return z
    .object({
      enabled: z.boolean(),
      templates: z.array(templateSchema).max(100),
    })
    .superRefine((values, context) => {
      const seen = new Set<string>()
      values.templates.forEach((template, index) => {
        if (seen.has(template.id)) {
          context.addIssue({
            code: 'custom',
            path: ['templates', index, 'name'],
            message: t('Template identifiers must be unique'),
          })
        }
        seen.add(template.id)
      })
    })
}

function parseRoute(value: unknown): SmartRoutingGroupRouteForm | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const route = value as Record<string, unknown>
  if (typeof route.group !== 'string') return undefined
  return {
    group: route.group,
    priority:
      typeof route.priority === 'number' && Number.isInteger(route.priority)
        ? route.priority
        : 1,
    cooldown_seconds:
      typeof route.cooldown_seconds === 'number' &&
      Number.isInteger(route.cooldown_seconds)
        ? route.cooldown_seconds
        : 60,
    enabled: route.enabled !== false,
  }
}

export function parseSmartRoutingTemplates(
  raw: string
): SmartRoutingTemplateForm[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]')
    if (!Array.isArray(parsed)) return []

    return parsed.map((value, index) => {
      const template =
        typeof value === 'object' && value !== null
          ? (value as Record<string, unknown>)
          : {}
      const routes = Array.isArray(template.group_routes)
        ? template.group_routes.flatMap((route) => {
            const parsedRoute = parseRoute(route)
            return parsedRoute ? [parsedRoute] : []
          })
        : []

      return {
        id:
          typeof template.id === 'string' && template.id.trim()
            ? template.id
            : `template-${index + 1}`,
        name: typeof template.name === 'string' ? template.name : '',
        description:
          typeof template.description === 'string' ? template.description : '',
        enabled: template.enabled === true,
        group_routes: routes,
        group_route_sticky: template.group_route_sticky === true,
      }
    })
  } catch {
    return []
  }
}

export function serializeSmartRoutingTemplates(
  templates: SmartRoutingTemplateForm[]
): string {
  return JSON.stringify(
    templates.map((template) => ({
      id: template.id.trim(),
      name: template.name.trim(),
      description: template.description.trim(),
      enabled: template.enabled,
      group_routes: template.group_routes.map((route) => ({
        group: route.group.trim(),
        priority: route.priority,
        cooldown_seconds: route.cooldown_seconds,
        enabled: route.enabled,
      })),
      group_route_sticky: template.group_route_sticky,
    }))
  )
}
