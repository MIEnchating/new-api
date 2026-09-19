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
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'

import { getPolicySectionNavItems } from '../../request-policies/section-registry'
import { getModelsSectionNavItems } from '../section-registry'

describe('routing settings navigation', () => {
  it('offers routing and health only under request policies while keeping custom error responses', () => {
    const models = getModelsSectionNavItems(i18next.t)
    const policies = getPolicySectionNavItems(i18next.t)
    expect(JSON.stringify(models)).not.toContain('routing-reliability')
    expect(JSON.stringify(models)).toContain('custom-error-responses')
    expect(JSON.stringify(policies)).toContain(
      '/system-settings/request-policies/routing'
    )
    expect(JSON.stringify(policies)).toContain(
      '/system-settings/request-policies/sessions'
    )
    expect(JSON.stringify(policies)).toContain(
      '/system-settings/request-policies/health'
    )
  })
})
