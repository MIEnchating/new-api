/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

export interface OAuthCallbackIdentity {
  provider?: string
  code?: string
  state?: string
  redirect?: string
}

/**
 * Build a stable identity for one OAuth callback. React StrictMode and mode
 * state updates can re-run callback effects, so this key is used to ensure a
 * provider authorization code is exchanged at most once per mounted callback.
 */
export function buildOAuthCallbackKey(identity: OAuthCallbackIdentity): string {
  return JSON.stringify([
    identity.provider ?? '',
    identity.code ?? '',
    identity.state ?? '',
    identity.redirect ?? '',
  ])
}
