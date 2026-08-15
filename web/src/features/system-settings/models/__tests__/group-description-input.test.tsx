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

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, test } from 'vitest'

import { serializeGroupPricingRows } from '../group-pricing-serialization'
import { GroupDescriptionInput } from '../group-ratio-visual-editor'

describe('group description input', () => {
  test('keeps the description visible and disables editing when key creation visibility is off', () => {
    const markup = renderToStaticMarkup(
      <GroupDescriptionInput
        selectable={false}
        description='Only shown to Pro users'
        placeholder='Group description'
        onChange={() => {}}
      />
    )

    assert.match(markup, /disabled=""/)
    assert.match(markup, /value="Only shown to Pro users"/)
    assert.match(markup, /cursor-not-allowed/)
  })

  test('persists the description separately when key creation visibility is off', () => {
    const serialized = serializeGroupPricingRows([
      {
        _id: 'pro',
        name: 'pro',
        ratio: '1',
        topupRatio: '',
        selectable: false,
        description: 'Only shown to Pro users',
      },
    ])

    assert.deepEqual(JSON.parse(serialized.UserUsableGroups), {})
    assert.deepEqual(JSON.parse(serialized.GroupDescriptions), {
      pro: 'Only shown to Pro users',
    })
  })
})
