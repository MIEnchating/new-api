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

import { toast } from 'sonner'
import { describe, test } from 'vitest'

import {
  requireSuccessfulOptionUpdate,
  shouldRefreshStatusForOption,
  shouldShowUpdateOptionNotification,
  SYSTEM_OPTION_TOAST_ID,
} from './use-update-option'

describe('system option status refresh', () => {
  test('refreshes visible branding after it is saved', () => {
    assert.equal(shouldRefreshStatusForOption('Logo'), true)
    assert.equal(shouldRefreshStatusForOption('SystemName'), true)
    assert.equal(shouldRefreshStatusForOption('Footer'), true)
  })

  test('does not refresh status for unrelated private options', () => {
    assert.equal(shouldRefreshStatusForOption('GitHubClientSecret'), false)
  })
})

describe('system option notifications', () => {
  test('replaces the previous result during a multi-option save', () => {
    toast.success('first option saved', { id: SYSTEM_OPTION_TOAST_ID })
    toast.success('all options saved', { id: SYSTEM_OPTION_TOAST_ID })

    const matchingToasts = toast
      .getHistory()
      .filter((item) => item.id === SYSTEM_OPTION_TOAST_ID)

    assert.equal(matchingToasts.length, 1)
    assert.ok(matchingToasts[0] && 'title' in matchingToasts[0])
    assert.equal(matchingToasts[0].title, 'all options saved')
  })

  test('shows notifications by default', () => {
    assert.equal(
      shouldShowUpdateOptionNotification({ key: 'GroupRatio', value: '{}' }),
      true
    )
  })

  test('allows flows with a dedicated result message to stay silent', () => {
    assert.equal(
      shouldShowUpdateOptionNotification({
        key: 'GroupRatio',
        value: '{}',
        notificationMode: 'silent',
      }),
      false
    )
  })

  test('treats an unsuccessful API response as a failed mutation', () => {
    assert.throws(
      () =>
        requireSuccessfulOptionUpdate({
          success: false,
          message: 'save failed',
        }),
      /save failed/
    )
  })

  test('returns successful API responses unchanged', () => {
    const response = { success: true, message: '' }
    assert.equal(requireSuccessfulOptionUpdate(response), response)
  })
})
