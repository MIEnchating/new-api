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
import assert from 'node:assert/strict'

import type { ReactElement } from 'react'
import { describe, test } from 'vitest'

import { SystemInfoSection } from '../../general/system-info-section'
import type { SiteSettings } from '../../types'
import { defaultSiteSettings } from '../defaults'
import { getSiteSectionContent } from '../section-registry'

describe('retired frontend theme setting', () => {
  test('does not request the retired option in site defaults', () => {
    assert.equal('theme.frontend' in defaultSiteSettings, false)
  })

  test('does not pass retired theme data into system information', () => {
    const settings = {
      ...defaultSiteSettings,
      'theme.frontend': 'classic',
    } as SiteSettings & { 'theme.frontend': string }

    const section = getSiteSectionContent(
      'system-info',
      settings
    ) as ReactElement<{
      defaultValues: Record<string, unknown>
    }>

    assert.equal(section.type, SystemInfoSection)
    assert.equal('theme' in section.props.defaultValues, false)
  })
})
