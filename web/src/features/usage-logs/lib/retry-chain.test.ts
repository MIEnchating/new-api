/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

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

import { LOG_TYPE_ENUM } from '../constants'
import { buildRetryChainView } from './retry-chain.ts'

describe('retry chain view', () => {
  test('marks failed same-channel retries before a successful channel switch', () => {
    const view = buildRetryChainView(
      [171, 171, 171, 116],
      LOG_TYPE_ENUM.CONSUME,
      false
    )

    assert.equal(view.outcome, 'succeeded')
    assert.deepEqual(view.steps, [
      {
        attempt: 1,
        channelId: '171',
        transition: 'initial',
        sameChannelRetry: 0,
        status: 'failed',
        current: false,
      },
      {
        attempt: 2,
        channelId: '171',
        transition: 'same-channel-retry',
        sameChannelRetry: 1,
        status: 'failed',
        current: false,
      },
      {
        attempt: 3,
        channelId: '171',
        transition: 'same-channel-retry',
        sameChannelRetry: 2,
        status: 'failed',
        current: false,
      },
      {
        attempt: 4,
        channelId: '116',
        transition: 'channel-switch',
        sameChannelRetry: 0,
        status: 'succeeded',
        current: true,
      },
    ])
  })

  test('distinguishes an intermediate error from a final failure', () => {
    const intermediate = buildRetryChainView(
      [171, 171],
      LOG_TYPE_ENUM.ERROR,
      true
    )
    const final = buildRetryChainView(
      [171, 171, 171],
      LOG_TYPE_ENUM.ERROR,
      false
    )

    assert.equal(intermediate.outcome, 'retrying')
    assert.deepEqual(intermediate.steps.at(-1), {
      attempt: 2,
      channelId: '171',
      transition: 'same-channel-retry',
      sameChannelRetry: 1,
      status: 'failed',
      current: true,
    })
    assert.equal(final.outcome, 'failed')
    assert.deepEqual(final.steps.at(-1), {
      attempt: 3,
      channelId: '171',
      transition: 'same-channel-retry',
      sameChannelRetry: 2,
      status: 'failed',
      current: true,
    })
  })
})
