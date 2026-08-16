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
import type { ChannelExecutionTraceInfo } from '@/features/usage-logs/types'

export type ChannelExecutionEvent = NonNullable<
  ChannelExecutionTraceInfo['events']
>[number]

type ChannelExecutionAttempt = {
  kind: 'attempt'
  channelId: number
  channelName?: string
  group?: string
  priority?: number
  retryIndex?: number
  selectionState?: 'affinity_hit' | 'same_channel_retry'
  selectionReason?: string
  state: 'active' | 'success' | 'failed' | 'cancelled'
  reason?: string
  startedAt?: number
  endedAt?: number
  nextIds?: number[]
}

export type ChannelExecutionTimelineItem =
  | ChannelExecutionAttempt
  | {
      kind: 'event'
      event: ChannelExecutionEvent
      startedAt?: number
    }

export type FailedChannelExecutionConclusion = {
  reason?: string
  originalError?: ChannelExecutionTraceInfo['original_final_error']
  userVisibleError?: ChannelExecutionTraceInfo['user_visible_final_error']
  customErrorApplied: boolean
  channelId?: number
  channelName?: string
  attemptCount: number
  channelCount: number
}

type ChannelExecutionTimelineTerminal = {
  status?: ChannelExecutionTraceInfo['status']
  endedAt?: number
}

type CompactTimelineFallback = {
  channelId?: number
  channelName?: string
  startedAt?: number
  endedAt?: number
}

function isTerminalEvent(event: ChannelExecutionEvent) {
  return (
    event.state === 'success' ||
    event.state === 'failed' ||
    event.state === 'cancelled'
  )
}

export function buildCompactChannelExecutionEvents(
  trace: ChannelExecutionTraceInfo | undefined,
  fallback: CompactTimelineFallback
): ChannelExecutionEvent[] {
  const channelIds = [...new Set(trace?.channel_ids ?? [])]
  if (
    trace?.compact !== true ||
    trace.status !== 'success' ||
    channelIds.length !== 1
  ) {
    return []
  }

  const channelId = channelIds[0] ?? fallback.channelId
  if (!channelId) return []
  const startedAt = trace.started_at ?? fallback.startedAt ?? 0
  const endedAt = Math.max(trace.updated_at ?? fallback.endedAt ?? 0, startedAt)
  const base = {
    group: trace.group,
    channel_id: channelId,
    channel_name: trace.channel_name || fallback.channelName,
    priority: trace.priority,
  }
  const events: ChannelExecutionEvent[] = []
  if (trace.affinity_hit) {
    events.push({
      ...base,
      sequence: events.length + 1,
      timestamp: startedAt,
      state: 'affinity_hit',
    })
  }
  events.push({
    ...base,
    sequence: events.length + 1,
    timestamp: startedAt,
    state: 'active',
  })
  events.push({
    ...base,
    sequence: events.length + 1,
    timestamp: endedAt,
    state: 'success',
  })
  return events
}

export function buildChannelExecutionTimeline(
  events: ChannelExecutionEvent[],
  terminal?: ChannelExecutionTimelineTerminal
): ChannelExecutionTimelineItem[] {
  const items: ChannelExecutionTimelineItem[] = []
  let pendingSelection: ChannelExecutionEvent | undefined
  let openAttempt: ChannelExecutionAttempt | undefined
  let openRequest: ChannelExecutionEvent | undefined

  const flushPendingSelection = () => {
    if (!pendingSelection) return
    items.push({ kind: 'event', event: pendingSelection })
    pendingSelection = undefined
  }

  for (const event of events) {
    // `finished` is an internal trace terminator used to persist the overall
    // failure reason and route-group status. It is not a routing decision or
    // an upstream request, so it must not appear as a timeline node.
    if (event.state === 'finished') {
      flushPendingSelection()
      continue
    }

    if (event.state === 'affinity_hit' && event.channel_id) {
      flushPendingSelection()
      items.push({ kind: 'event', event })
      continue
    }

    if (event.state === 'same_channel_retry' && event.channel_id) {
      flushPendingSelection()
      pendingSelection = event
      continue
    }

    if (
      event.state === 'affinity_hit' &&
      event.reason === 'group_affinity' &&
      !event.channel_id
    ) {
      const item = { kind: 'event' as const, event }
      let insertAt = items.length
      while (insertAt > 0) {
        const previous = items[insertAt - 1]
        if (
          previous?.kind !== 'event' ||
          !previous.event.channel_id ||
          (previous.event.state !== 'active' &&
            previous.event.state !== 'affinity_hit')
        ) {
          break
        }
        insertAt -= 1
      }
      items.splice(insertAt, 0, item)
      continue
    }

    if (event.state === 'active' && event.channel_id) {
      const selection =
        pendingSelection?.channel_id === event.channel_id
          ? pendingSelection
          : undefined
      if (!selection) flushPendingSelection()

      if (selection?.state === 'same_channel_retry') {
        openAttempt = {
          kind: 'attempt',
          channelId: event.channel_id,
          channelName: event.channel_name || selection.channel_name,
          group: event.group || selection.group,
          priority: event.priority ?? selection.priority,
          retryIndex: selection.retry_index ?? event.retry_index,
          selectionState: 'same_channel_retry',
          selectionReason: selection.reason,
          state: 'active',
          startedAt: event.timestamp,
          nextIds: event.next_ids,
        }
        items.push(openAttempt)
        openRequest = undefined
      } else {
        const openRequestGroup = openRequest?.group ?? event.group
        if (
          openRequest?.channel_id === event.channel_id &&
          openRequestGroup === event.group
        ) {
          openRequest.next_ids = [
            ...new Set([
              ...(openRequest.next_ids ?? []),
              ...(event.next_ids ?? []),
            ]),
          ]
          openRequest.priority ??= event.priority
          openRequest.channel_name ||= event.channel_name
          pendingSelection = undefined
          continue
        }
        openAttempt = undefined
        openRequest = event
        items.push({ kind: 'event', event })
      }
      pendingSelection = undefined
      continue
    }

    if (
      isTerminalEvent(event) &&
      event.channel_id &&
      openAttempt?.channelId === event.channel_id &&
      openAttempt.state === 'active'
    ) {
      openAttempt.state = event.state as 'success' | 'failed' | 'cancelled'
      openAttempt.reason = event.reason
      openAttempt.endedAt = event.timestamp
      openAttempt = undefined
      continue
    }

    if (isTerminalEvent(event) && event.channel_id) {
      const startedAt =
        openRequest?.channel_id === event.channel_id
          ? openRequest.timestamp
          : undefined
      flushPendingSelection()
      items.push({ kind: 'event', event, startedAt })
      openRequest = undefined
      openAttempt = undefined
      continue
    }

    flushPendingSelection()
    items.push({ kind: 'event', event })
  }

  flushPendingSelection()

  // A successful consume log is authoritative even if the runtime trace was
  // persisted one event behind. Keep the initial request/result as separate
  // steps; only a repeated same-channel attempt remains compact.
  if (terminal?.status === 'success') {
    const endedAt = Math.max(
      terminal.endedAt ?? 0,
      openAttempt?.startedAt ?? openRequest?.timestamp ?? 0
    )
    if (openAttempt?.state === 'active') {
      openAttempt.state = 'success'
      openAttempt.endedAt = endedAt
    } else if (openRequest) {
      items.push({
        kind: 'event',
        event: {
          sequence: events.length + 1,
          timestamp: endedAt,
          group: openRequest.group,
          channel_id: openRequest.channel_id,
          channel_name: openRequest.channel_name,
          priority: openRequest.priority,
          state: 'success',
        },
        startedAt: openRequest.timestamp,
      })
    }
  } else if (terminal?.status === 'cancelled') {
    const endedAt = Math.max(
      terminal.endedAt ?? 0,
      openAttempt?.startedAt ?? openRequest?.timestamp ?? 0
    )
    if (openAttempt?.state === 'active') {
      openAttempt.state = 'cancelled'
      openAttempt.reason =
        'Request cancelled before this channel returned a result'
      openAttempt.endedAt = endedAt
    } else if (openRequest) {
      items.push({
        kind: 'event',
        event: {
          sequence: events.length + 1,
          timestamp: endedAt,
          group: openRequest.group,
          channel_id: openRequest.channel_id,
          channel_name: openRequest.channel_name,
          priority: openRequest.priority,
          state: 'cancelled',
        },
        startedAt: openRequest.timestamp,
      })
    }
  }
  return items
}

export function getStandbyChannelIds(items: ChannelExecutionTimelineItem[]) {
  const attempted = new Set<number>()
  const standby = new Set<number>()

  for (const item of items) {
    if (item.kind === 'attempt') {
      attempted.add(item.channelId)
      for (const channelId of item.nextIds ?? []) standby.add(channelId)
      continue
    }
    if (item.event.channel_id) attempted.add(item.event.channel_id)
    if (item.event.state === 'active') {
      for (const channelId of item.event.next_ids ?? []) standby.add(channelId)
    }
  }

  return [...standby].filter((channelId) => !attempted.has(channelId))
}

export function getFailedChannelExecutionConclusion(
  events: ChannelExecutionEvent[],
  trace?: ChannelExecutionTraceInfo
): FailedChannelExecutionConclusion {
  const requestEvents = events.filter(
    (event) => event.state === 'active' && Boolean(event.channel_id)
  )
  const channelIds = new Set(
    requestEvents
      .map((event) => event.channel_id)
      .filter((channelId): channelId is number => Boolean(channelId))
  )
  const reversedEvents = [...events].reverse()
  const lastChannelEvent = reversedEvents.find(
    (event) =>
      Boolean(event.channel_id) &&
      (event.state === 'failed' ||
        event.state === 'cancelled' ||
        event.state === 'active')
  )
  const terminalReason = reversedEvents.find(
    (event) => event.state === 'finished' && event.reason
  )?.reason
  const lastFailureReason = reversedEvents.find(
    (event) =>
      (event.state === 'failed' || event.state === 'cancelled') && event.reason
  )?.reason

  return {
    reason:
      terminalReason && terminalReason !== 'request_finished_without_success'
        ? terminalReason
        : lastFailureReason,
    originalError: trace?.original_final_error,
    userVisibleError: trace?.user_visible_final_error,
    customErrorApplied: trace?.custom_error_applied === true,
    channelId: lastChannelEvent?.channel_id,
    channelName: lastChannelEvent?.channel_name,
    attemptCount: requestEvents.length,
    channelCount: channelIds.size,
  }
}
