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

export type GroupRatioSchedulePeriod = {
  name?: string
  date?: string
  days?: number[]
  start: string
  end: string
  ratio: number
  enabled?: boolean
}

export type GroupRatioSchedule = {
  enabled: boolean
  periods: GroupRatioSchedulePeriod[]
}

export type GroupRatioScheduleMap = Record<string, GroupRatioSchedule>

export type GroupRatioScheduleScope = 'daily' | 'weekdays' | 'date'

export function parseGroupRatioSchedules(value: string): GroupRatioScheduleMap {
  try {
    const parsed = JSON.parse(value || '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as GroupRatioScheduleMap
  } catch {
    return {}
  }
}

export function isGroupRatioScheduleMap(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  if (entries.length > 512) return false

  return entries.every(([group, schedule]) => {
    if (!group.trim() || !schedule || typeof schedule !== 'object') return false
    const candidate = schedule as Partial<GroupRatioSchedule>
    if (
      typeof candidate.enabled !== 'boolean' ||
      !Array.isArray(candidate.periods)
    ) {
      return false
    }
    if (candidate.periods.length > 64) return false
    return candidate.periods.every((period) => {
      if (!period || typeof period !== 'object') return false
      const item = period as GroupRatioSchedulePeriod
      if (
        (item.name !== undefined &&
          (typeof item.name !== 'string' ||
            [...item.name.trim()].length > 64)) ||
        typeof item.start !== 'string' ||
        typeof item.end !== 'string' ||
        typeof item.ratio !== 'number' ||
        (item.enabled !== undefined && typeof item.enabled !== 'boolean') ||
        (item.date !== undefined && typeof item.date !== 'string') ||
        (item.days !== undefined &&
          (!Array.isArray(item.days) ||
            !item.days.every(
              (day) => Number.isInteger(day) && day >= 0 && day <= 6
            ) ||
            new Set(item.days).size !== item.days.length)) ||
        (item.date !== undefined && item.days !== undefined)
      ) {
        return false
      }
      return isGroupRatioSchedulePeriodValidForStorage(item)
    })
  })
}

export function serializeGroupRatioSchedules(
  schedules: GroupRatioScheduleMap
): string {
  return JSON.stringify(schedules, null, 2)
}

export function getGroupRatioScheduleScope(
  period: GroupRatioSchedulePeriod
): GroupRatioScheduleScope {
  if (period.date !== undefined) return 'date'
  if (period.days !== undefined) return 'weekdays'
  return 'daily'
}

export function setGroupRatioScheduleScope(
  period: GroupRatioSchedulePeriod,
  scope: GroupRatioScheduleScope
): GroupRatioSchedulePeriod {
  if (scope === 'date') {
    return { ...period, date: period.date || '', days: undefined }
  }
  if (scope === 'weekdays') {
    return {
      ...period,
      date: undefined,
      days: period.days?.length ? period.days : [1, 2, 3, 4, 5],
    }
  }
  return { ...period, date: undefined, days: undefined }
}

export function renameGroupRatioSchedule(
  value: string,
  previousName: string,
  nextName: string
): string {
  const previous = previousName.trim()
  const next = nextName.trim()
  if (!previous || !next || previous === next) return value

  const schedules = parseGroupRatioSchedules(value)
  if (!schedules[previous]) return value
  schedules[next] = schedules[previous]
  delete schedules[previous]
  return serializeGroupRatioSchedules(schedules)
}

export function removeGroupRatioSchedule(value: string, group: string): string {
  const name = group.trim()
  if (!name) return value

  const schedules = parseGroupRatioSchedules(value)
  if (!schedules[name]) return value
  delete schedules[name]
  return serializeGroupRatioSchedules(schedules)
}

export function isGroupRatioSchedulePeriodValid(
  period: GroupRatioSchedulePeriod
): boolean {
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!timePattern.test(period.start) || !timePattern.test(period.end)) {
    return false
  }
  if (!Number.isFinite(period.ratio) || period.ratio < 0) return false

  const scope = getGroupRatioScheduleScope(period)
  if (scope === 'date') {
    return /^\d{4}-\d{2}-\d{2}$/.test(period.date || '')
  }
  if (scope === 'weekdays') {
    return Boolean(
      period.days?.length &&
      period.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    )
  }
  return true
}

function isGroupRatioSchedulePeriodValidForStorage(
  period: GroupRatioSchedulePeriod
): boolean {
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!timePattern.test(period.start) || !timePattern.test(period.end)) {
    return false
  }
  if (!Number.isFinite(period.ratio) || period.ratio < 0) return false
  if (period.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period.date)) return false
    const parsed = new Date(`${period.date}T00:00:00Z`)
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === period.date
    )
  }
  return true
}
