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
import { LOG_TYPE_ENUM } from '../constants'

export type RetryChainStep = {
  attempt: number
  channelId: string
  transition: 'initial' | 'same-channel-retry' | 'channel-switch'
  sameChannelRetry: number
  status: 'failed' | 'succeeded'
  current: boolean
}

type RetryChainOutcome = 'succeeded' | 'retrying' | 'failed'

export type RetryChainView = {
  outcome: RetryChainOutcome
  steps: RetryChainStep[]
}

export function buildRetryChainView(
  channelIds: Array<number | string>,
  logType: number,
  retryIntermediate: boolean
): RetryChainView {
  const normalizedIds = channelIds.map(String).filter(Boolean)
  const finalSucceeded = logType === LOG_TYPE_ENUM.CONSUME
  const outcome: RetryChainOutcome = finalSucceeded
    ? 'succeeded'
    : retryIntermediate
      ? 'retrying'
      : 'failed'

  let sameChannelRetry = 0
  const steps = normalizedIds.map((channelId, index) => {
    const previousChannelId = normalizedIds[index - 1]
    let transition: RetryChainStep['transition'] = 'initial'

    if (index > 0 && channelId === previousChannelId) {
      sameChannelRetry += 1
      transition = 'same-channel-retry'
    } else if (index > 0) {
      sameChannelRetry = 0
      transition = 'channel-switch'
    }

    const current = index === normalizedIds.length - 1
    const status: RetryChainStep['status'] =
      current && finalSucceeded ? 'succeeded' : 'failed'
    return {
      attempt: index + 1,
      channelId,
      transition,
      sameChannelRetry,
      status,
      current,
    }
  })

  return { outcome, steps }
}
