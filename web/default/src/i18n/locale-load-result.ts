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
export type LocaleLoadResult<T> =
  | { ok: true; language: string; value: T }
  | { ok: false; language: string; error: Error }

function toLocaleLoadError(language: string, error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(`Unable to load locale: ${language}`)
}

export async function evaluateLocaleLoader<T>(
  language: string,
  loader: () => Promise<T>
): Promise<LocaleLoadResult<T>> {
  try {
    return { ok: true, language, value: await loader() }
  } catch (error) {
    return { ok: false, language, error: toLocaleLoadError(language, error) }
  }
}
