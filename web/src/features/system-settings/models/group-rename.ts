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
import type { GroupRenameRequest } from '../types'

export function composeGroupRenames(
  pending: GroupRenameRequest[],
  originalNames: Set<string>,
  previousName: string,
  nextName: string
): GroupRenameRequest[] {
  const previous = previousName.trim()
  const next = nextName.trim()
  if (!previous || !next || previous === next) return pending

  const existing = pending.find(
    (rename) => rename.from === previous || rename.to === previous
  )
  const source = existing?.from ?? previous
  const remaining = pending.filter((rename) => rename.from !== source)
  if (!originalNames.has(source) || source === next) return remaining
  return [...remaining, { from: source, to: next }]
}
