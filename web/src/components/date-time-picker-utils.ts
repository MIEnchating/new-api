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
import { enUS, fr, ja, ru, vi, zhCN, zhTW } from 'react-day-picker/locale'

const calendarLocales = { en: enUS, fr, ja, ru, vi } as const

export function getCalendarLocale(language: string) {
  const normalized = language.toLowerCase()
  if (normalized === 'zh-tw' || normalized.startsWith('zh-hant')) {
    return zhTW
  }
  if (normalized.startsWith('zh')) return zhCN
  const baseLanguage = normalized.split('-')[0]
  return calendarLocales[baseLanguage as keyof typeof calendarLocales] ?? enUS
}

export function getDateFormat(language: string) {
  const normalized = language.toLowerCase()
  return normalized.startsWith('zh') ? 'YYYY年M月D日' : 'YYYY-MM-DD'
}

export function getReactAriaLocale(language: string) {
  const normalized = language.toLowerCase()
  if (normalized === 'zh-tw' || normalized.startsWith('zh-hant')) {
    return 'zh-TW'
  }
  if (normalized.startsWith('zh')) return 'zh-CN'
  return language
}

export type CalendarPopoverPlacement = 'top start' | 'bottom start'

export function getCalendarPopoverPlacement(
  trigger: HTMLElement | null
): CalendarPopoverPlacement {
  if (!trigger) return 'bottom start'

  const triggerRect = trigger.getBoundingClientRect()
  const boundary = trigger.closest<HTMLElement>(
    '[data-slot="dialog-body"], [data-slot="sheet-content"]'
  )
  const boundaryRect = boundary?.getBoundingClientRect()
  const boundaryTop = boundaryRect?.top ?? 0
  const boundaryBottom =
    boundaryRect?.bottom ??
    (typeof window === 'undefined' ? triggerRect.bottom : window.innerHeight)
  const spaceAbove = triggerRect.top - boundaryTop
  const spaceBelow = boundaryBottom - triggerRect.bottom
  const calendarHeight = 320

  if (spaceBelow >= calendarHeight) return 'bottom start'
  return spaceAbove > spaceBelow ? 'top start' : 'bottom start'
}
