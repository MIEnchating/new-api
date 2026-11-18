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
import { describe, expect, test } from 'vitest'

import {
  createSmartRoutingSchema,
  parseSmartRoutingTemplates,
  serializeSmartRoutingTemplates,
  type SmartRoutingFormValues,
} from '../smart-routing'

const translate = (key: string) => key

function values(enabled: boolean): SmartRoutingFormValues {
  return {
    enabled: true,
    templates: [
      {
        id: 'claude',
        name: 'Claude',
        description: 'Claude route groups',
        enabled,
        group_routes: [],
        group_route_sticky: true,
      },
    ],
  }
}

describe('API key smart routing template validation', () => {
  test('requires a route group only when the template is enabled', () => {
    const schema = createSmartRoutingSchema(translate)

    expect(schema.safeParse(values(true)).success).toBe(false)
    expect(schema.safeParse(values(false)).success).toBe(true)
  })

  test('rejects duplicate groups in one template', () => {
    const schema = createSmartRoutingSchema(translate)
    const formValues = values(true)
    formValues.templates[0].group_routes = [
      {
        group: 'default',
        priority: 2,
        cooldown_seconds: 60,
        enabled: true,
      },
      {
        group: 'default',
        priority: 1,
        cooldown_seconds: 120,
        enabled: true,
      },
    ]

    const result = schema.safeParse(formValues)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) => issue.message === 'Duplicate route group'
        )
      ).toBe(true)
    }
  })

  test('round-trips API key group routes and affinity', () => {
    const raw = JSON.stringify([
      {
        id: 'claude',
        name: 'Claude',
        description: 'Claude route groups',
        enabled: true,
        group_routes: [
          {
            group: 'primary',
            priority: 2,
            cooldown_seconds: 60,
            enabled: true,
          },
          {
            group: 'backup',
            priority: 1,
            cooldown_seconds: 120,
            enabled: false,
          },
        ],
        group_route_sticky: true,
      },
    ])

    const serialized = serializeSmartRoutingTemplates(
      parseSmartRoutingTemplates(raw)
    )

    expect(JSON.parse(serialized)).toEqual(JSON.parse(raw))
  })
})
