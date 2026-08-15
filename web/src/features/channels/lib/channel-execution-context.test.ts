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

import { describe, test } from 'vitest'

import {
  defaultChannelExecutionContext,
  syncExecutionTraceContext,
  updateExecutionContextGroup,
} from './channel-execution-context.ts'

describe('channel execution tab context', () => {
  test('changing the plan group clears an incompatible model', () => {
    const current = {
      ...defaultChannelExecutionContext,
      group: 'group-a',
      model: 'model-a',
    }

    assert.deepEqual(updateExecutionContextGroup(current, 'group-b'), {
      ...current,
      group: 'group-b',
      model: '',
    })
  })

  test('selecting a trace synchronizes its full context back to the plan', () => {
    const traceContext = {
      group: 'group-b',
      model: 'model-b',
      requestPath: '/v1/messages',
      mode: 'retry' as const,
    }

    assert.deepEqual(
      syncExecutionTraceContext(defaultChannelExecutionContext, traceContext),
      traceContext
    )
  })
})
