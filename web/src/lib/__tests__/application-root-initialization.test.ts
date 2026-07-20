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
import { test } from 'node:test'

import { initializeAndMountApplication } from '../application-root'

test('application initialization completes before React replaces the bootstrap', async () => {
  const events: string[] = []
  const rootElement = {
    replaceChildren: () => events.push('bootstrap-removed'),
  } as unknown as HTMLElement

  await initializeAndMountApplication(
    rootElement,
    async () => {
      events.push('initialization-started')
      await Promise.resolve()
      events.push('initialization-completed')
    },
    () => events.push('react-mounted')
  )

  assert.deepEqual(events, [
    'initialization-started',
    'initialization-completed',
    'bootstrap-removed',
    'react-mounted',
  ])
})

test('React still replaces the bootstrap when initialization rejects', async () => {
  const events: string[] = []
  const rootElement = {
    replaceChildren: () => events.push('bootstrap-removed'),
  } as unknown as HTMLElement

  await assert.rejects(
    initializeAndMountApplication(
      rootElement,
      async () => {
        throw new Error('initialization failed')
      },
      () => events.push('react-mounted')
    ),
    /initialization failed/
  )

  assert.deepEqual(events, ['bootstrap-removed', 'react-mounted'])
})
