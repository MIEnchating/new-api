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
import { z } from 'zod'

export const qqBotSettingsSchema = z.object({
  enabled: z.boolean(),
  app_id: z.string().trim().max(128),
  app_secret: z.string().trim().max(1024),
  groups: z.string().trim().max(8192),
  notify_groups: z.string().trim().max(2048),
  site_url: z.string().trim().max(2048),
  chat_model: z.string().trim().max(256),
  chat_key: z.string().trim().max(1024),
  chat_source: z.enum(['disabled', 'builtin', 'external']),
  chat_protocol: z.enum(['chat_completions', 'responses', 'messages']),
  chat_base_url: z.string().trim().max(2048),
  chat_token_id: z.number().int().nonnegative(),
  chat_group: z.string().trim().max(64),
})

export type QQBotFormValues = z.infer<typeof qqBotSettingsSchema>

export type QQBotSettings = Omit<QQBotFormValues, 'app_secret' | 'chat_key'> & {
  revision: string
  app_secret_configured: boolean
  chat_key_configured: boolean
  legacy_chat_key: boolean
  callback_path: string
}
