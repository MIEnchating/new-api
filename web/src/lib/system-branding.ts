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
import { DEFAULT_LOGO } from './constants'

const LOCAL_DEFAULT_LOGO_ALIASES = new Set([
  'https://www.yunmian.tech/logo.png',
  'https://www.yunmian.tech/logo.png?v=20260721',
])

export function normalizeSystemLogo(logo: unknown): string {
  if (typeof logo !== 'string') return DEFAULT_LOGO

  const normalizedLogo = logo.trim()
  if (!normalizedLogo || LOCAL_DEFAULT_LOGO_ALIASES.has(normalizedLogo)) {
    return DEFAULT_LOGO
  }

  return normalizedLogo
}
