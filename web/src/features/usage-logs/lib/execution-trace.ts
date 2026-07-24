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

function isTerminalStatus(status?: ChannelExecutionTraceInfo['status']) {
  return status === 'success' || status === 'failed' || status === 'cancelled'
}

/**
 * Merge the compact SQL summary with the full runtime trace. A terminal SQL
 * summary is written after request completion and is authoritative for final
 * routing metadata; Redis can briefly lag and is used only to fill the full
 * request context and event timeline.
 */
export function mergeExecutionTrace(
  stored: ChannelExecutionTraceInfo | undefined,
  fetched: ChannelExecutionTraceInfo | undefined
): ChannelExecutionTraceInfo | undefined {
  if (!fetched) return stored
  if (!stored) return { ...fetched, compact: fetched.compact === true }

  // The endpoint falls back to the persisted SQL summary when the runtime
  // Redis trace is unavailable (for example, when viewing another instance's
  // logs). Do not mislabel that fallback as a full trace: an empty full trace
  // is hidden by the details UI, while a compact trace has a useful summary.
  const mergedIsCompact = fetched.compact === true

  const storedIsTerminalSummary =
    stored.compact === true && isTerminalStatus(stored.status)

  if (!storedIsTerminalSummary) {
    return {
      ...stored,
      ...fetched,
      compact: mergedIsCompact,
      route_groups: fetched.route_groups ?? stored.route_groups,
      route_group_statuses:
        fetched.route_group_statuses ?? stored.route_group_statuses,
      channel_ids: fetched.channel_ids ?? stored.channel_ids,
      affinity_hit: fetched.affinity_hit ?? stored.affinity_hit,
    }
  }

  return {
    ...fetched,
    ...stored,
    compact: mergedIsCompact,
    request_id: fetched.request_id ?? stored.request_id,
    model: fetched.model ?? stored.model,
    request_path: fetched.request_path ?? stored.request_path,
    started_at: fetched.started_at ?? stored.started_at,
    updated_at: fetched.updated_at ?? stored.updated_at,
    events: fetched.events ?? stored.events,
    mode: stored.mode ?? fetched.mode,
    status: stored.status ?? fetched.status,
    // These summary fields use `omitempty` in Go. Missing values therefore
    // mean the terminal result was empty/false, not that Redis should fill it.
    group: stored.group ?? '',
    route_groups: stored.route_groups ?? [],
    route_group_statuses: stored.route_group_statuses ?? [],
    channel_ids: stored.channel_ids ?? [],
    affinity_hit: stored.affinity_hit === true,
  }
}
