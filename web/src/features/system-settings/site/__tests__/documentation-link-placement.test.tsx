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
import { describe, test } from 'node:test'

import type { ReactElement } from 'react'

import { SystemInfoSection } from '../../general/system-info-section'
import { HeaderNavigationSection } from '../../maintenance/header-navigation-section'
import { defaultSiteSettings } from '../defaults'
import { getSiteSectionContent } from '../section-registry'

describe('documentation link setting placement', () => {
  test('passes the documentation link to system information', () => {
    const settings = {
      ...defaultSiteSettings,
      'general_setting.docs_link': 'https://docs.example.com',
    }

    const section = getSiteSectionContent(
      'system-info',
      settings
    ) as ReactElement<{
      defaultValues: {
        general_setting: { docs_link: string }
      }
    }>

    assert.equal(section.type, SystemInfoSection)
    assert.equal(
      section.props.defaultValues.general_setting.docs_link,
      'https://docs.example.com'
    )
  })

  test('does not pass the documentation link to header navigation', () => {
    const section = getSiteSectionContent(
      'header-navigation',
      defaultSiteSettings
    ) as ReactElement<Record<string, unknown>>

    assert.equal(section.type, HeaderNavigationSection)
    assert.equal('docsLink' in section.props, false)
  })
})
