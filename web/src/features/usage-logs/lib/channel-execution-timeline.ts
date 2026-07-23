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
import type { ChannelExecutionTraceInfo } from '../types'

export type ChannelExecutionEvent = NonNullable<
  ChannelExecutionTraceInfo['events']
>[number]

export type ChannelExecutionAttempt = {
  kind: 'attempt'
  channelId: number
  channelName?: string
  group?: string
  priority?: number
  retryIndex?: number
  selectionState?: 'affinity_hit' | 'same_channel_retry'
  selectionReason?: string
  state: 'active' | 'success' | 'failed'
  reason?: string
  startedAt?: number
  endedAt?: number
  nextIds?: number[]
}

export type ChannelExecutionTimelineItem =
  | ChannelExecutionAttempt
  | { kind: 'event'; event: ChannelExecutionEvent }

function isSelectionEvent(event: ChannelExecutionEvent) {
  return event.state === 'affinity_hit' || event.state === 'same_channel_retry'
}

function isTerminalEvent(event: ChannelExecutionEvent) {
  return event.state === 'success' || event.state === 'failed'
}

export function buildChannelExecutionTimeline(
  events: ChannelExecutionEvent[]
): ChannelExecutionTimelineItem[] {
  const items: ChannelExecutionTimelineItem[] = []
  let pendingSelection: ChannelExecutionEvent | undefined
  let openAttempt: ChannelExecutionAttempt | undefined

  const flushPendingSelection = () => {
    if (!pendingSelection) return
    items.push({ kind: 'event', event: pendingSelection })
    pendingSelection = undefined
  }

  for (const event of events) {
    if (isSelectionEvent(event) && event.channel_id) {
      flushPendingSelection()
      pendingSelection = event
      continue
    }

    if (event.state === 'active' && event.channel_id) {
      const selection =
        pendingSelection?.channel_id === event.channel_id
          ? pendingSelection
          : undefined
      if (!selection) flushPendingSelection()

      openAttempt = {
        kind: 'attempt',
        channelId: event.channel_id,
        channelName: event.channel_name || selection?.channel_name,
        group: event.group || selection?.group,
        priority: event.priority ?? selection?.priority,
        retryIndex: selection?.retry_index ?? event.retry_index,
        selectionState: selection?.state as
          | 'affinity_hit'
          | 'same_channel_retry'
          | undefined,
        selectionReason: selection?.reason,
        state: 'active',
        startedAt: event.timestamp,
        nextIds: event.next_ids,
      }
      items.push(openAttempt)
      pendingSelection = undefined
      continue
    }

    if (
      isTerminalEvent(event) &&
      event.channel_id &&
      openAttempt?.channelId === event.channel_id &&
      openAttempt.state === 'active'
    ) {
      openAttempt.state = event.state as 'success' | 'failed'
      openAttempt.reason = event.reason
      openAttempt.endedAt = event.timestamp
      openAttempt = undefined
      continue
    }

    flushPendingSelection()
    items.push({ kind: 'event', event })
    if (isTerminalEvent(event)) openAttempt = undefined
  }

  flushPendingSelection()
  return items
}

export function getStandbyChannelIds(items: ChannelExecutionTimelineItem[]) {
  const attempted = new Set<number>()
  const standby = new Set<number>()

  for (const item of items) {
    if (item.kind !== 'attempt') continue
    attempted.add(item.channelId)
    for (const channelId of item.nextIds ?? []) standby.add(channelId)
  }

  return [...standby].filter((channelId) => !attempted.has(channelId))
}
