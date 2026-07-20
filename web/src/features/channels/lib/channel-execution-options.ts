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
import type {
  ChannelExecutionGroupOption,
  ChannelExecutionOption,
} from '../api'

export type RawChannelExecutionOptions =
  | ChannelExecutionOption[]
  | {
      channels?: ChannelExecutionOption[]
      groups?: ChannelExecutionGroupOption[]
    }

function splitValues(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function deriveGroups(channels: ChannelExecutionOption[]) {
  const groupModels = new Map<string, Set<string>>()

  channels.forEach((channel) => {
    splitValues(channel.group).forEach((group) => {
      const models = groupModels.get(group) ?? new Set<string>()
      if (channel.status === 1) {
        splitValues(channel.models).forEach((model) => models.add(model))
      }
      groupModels.set(group, models)
    })
  })

  return Array.from(groupModels, ([name, models]) => ({
    name,
    models: [...models].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true })
    ),
  }))
    .filter((group) => group.models.length > 0)
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { numeric: true })
    )
}

export function normalizeChannelExecutionOptions(
  raw: RawChannelExecutionOptions | null | undefined
): {
  channels: ChannelExecutionOption[]
  groups: ChannelExecutionGroupOption[]
} {
  const channels = Array.isArray(raw) ? raw : (raw?.channels ?? [])
  const derivedGroups = deriveGroups(channels)

  if (Array.isArray(raw) || !raw?.groups?.length) {
    return { channels, groups: derivedGroups }
  }

  const derivedByName = new Map(
    derivedGroups.map((group) => [group.name, group.models])
  )
  const groups = raw.groups
    .map((group) => ({
      name: group.name,
      models: group.models.length
        ? group.models
        : (derivedByName.get(group.name) ?? []),
    }))
    .filter((group) => group.models.length > 0)
  const knownGroups = new Set(groups.map((group) => group.name))

  derivedGroups.forEach((group) => {
    if (!knownGroups.has(group.name)) groups.push(group)
  })

  return { channels, groups }
}
