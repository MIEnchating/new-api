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
export type CustomMenuPageVisibility = 'public' | 'admin'
export type CustomMenuPageSection = 'chat' | 'general' | 'personal'

export type CustomMenuPage = {
  id: string
  name: string
  url: string
  visibility: CustomMenuPageVisibility
  section?: CustomMenuPageSection
  icon?: string
  enabled?: boolean
}

const VALID_ID = /^[a-zA-Z0-9_-]{8,64}$/

function isValidPageURL(value: unknown) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function parseCustomMenuPages(value: unknown): CustomMenuPage[] {
  if (!value) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry): CustomMenuPage[] => {
      if (!entry || typeof entry !== 'object') return []
      const page = entry as Record<string, unknown>
      const valid =
        typeof page.id === 'string' &&
        VALID_ID.test(page.id) &&
        typeof page.name === 'string' &&
        page.name.trim().length > 0 &&
        isValidPageURL(page.url) &&
        (page.visibility === 'public' || page.visibility === 'admin') &&
        (page.section === undefined ||
          page.section === 'chat' ||
          page.section === 'general' ||
          page.section === 'personal') &&
        (page.icon === undefined ||
          (typeof page.icon === 'string' &&
            page.icon.startsWith('data:image/svg+xml;base64,'))) &&
        (page.enabled === undefined || typeof page.enabled === 'boolean')
      if (!valid) return []

      return [
        {
          ...(page as CustomMenuPage),
          enabled: page.enabled !== false,
        },
      ]
    })
  } catch {
    return []
  }
}

export function createCustomMenuPageId() {
  // randomUUID is unavailable in some insecure HTTP contexts (for example,
  // direct access by an IP address). Keep menu creation usable there too.
  const randomUUID = globalThis.crypto?.randomUUID?.()
  if (randomUUID) return `page_${randomUUID.replaceAll('-', '')}`

  const randomPart = Math.random().toString(36).slice(2, 14)
  return `page_${Date.now().toString(36)}_${randomPart}`
}
