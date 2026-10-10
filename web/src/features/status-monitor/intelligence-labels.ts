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
import type { TFunction } from 'i18next'

export function getIntelligenceEndpointOptions(t: TFunction) {
  return [
    {
      value: 'openai',
      label: `${t('OpenAI Chat Completions')} · /v1/chat/completions`,
    },
    {
      value: 'openai-response',
      label: `${t('OpenAI Responses API')} · /v1/responses`,
    },
    {
      value: 'anthropic',
      label: `${t('Anthropic Messages API')} · /v1/messages`,
    },
    {
      value: 'gemini',
      label: `${t('Gemini content generation')} · generateContent`,
    },
  ]
}

export function getIntelligenceQuestionName(name: string, t: TFunction) {
  // Only the built-in title is a translation key; user-authored names are data.
  return name === 'Pelican riding a bicycle'
    ? t('Pelican riding a bicycle')
    : name
}
