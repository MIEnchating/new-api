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

import { ChannelTestModeSelect } from '../routing-reliability-section'

describe('channel test mode select layout', () => {
  test('uses the full form-column width so long mode labels remain visible', () => {
    const markup = renderToStaticMarkup(
      <ChannelTestModeSelect value='scheduled_all' onValueChange={() => {}} />
    )

    assert.match(markup, /data-slot="select-trigger"/)
    assert.match(markup, /class="[^"]*w-full[^"]*min-w-0[^"]*"/)
  })
})
