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
export const exclusionModes = [
  'same_channel_retry',
  'next_channel',
  'all',
] as const

export type ExclusionMode = (typeof exclusionModes)[number]
export type GroupExclusionRule = {
  mode: ExclusionMode
  enabled: boolean
}
export type GroupExclusions = Record<string, GroupExclusionRule>

export function parseGroupExclusions(value: string): GroupExclusions {
  try {
    const parsed = JSON.parse(value || '{}')
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return {}
    }

    const exclusions: GroupExclusions = {}
    for (const [group, value] of Object.entries(parsed)) {
      if (!group.trim()) continue

      if (
        typeof value === 'string' &&
        exclusionModes.includes(value as ExclusionMode)
      ) {
        exclusions[group] = {
          mode: value as ExclusionMode,
          enabled: true,
        }
        continue
      }

      if (!value || Array.isArray(value) || typeof value !== 'object') {
        continue
      }
      const record = value as Record<string, unknown>
      if (
        typeof record.mode !== 'string' ||
        !exclusionModes.includes(record.mode as ExclusionMode)
      ) {
        continue
      }
      exclusions[group] = {
        mode: record.mode as ExclusionMode,
        enabled: record.enabled !== false,
      }
    }
    return exclusions
  } catch {
    return {}
  }
}

export function serializeGroupExclusions(value: GroupExclusions) {
  return JSON.stringify(value)
}

export function parseGroupList(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]')
    if (!Array.isArray(parsed)) return []
    return [
      ...new Set(
        parsed
          .filter((group): group is string => typeof group === 'string')
          .map((group) => group.trim())
          .filter(Boolean)
      ),
    ].sort()
  } catch {
    return []
  }
}

export function serializeGroupList(groups: string[]) {
  return JSON.stringify(
    [...new Set(groups.map((group) => group.trim()).filter(Boolean))].sort()
  )
}
