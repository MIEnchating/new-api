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
import Claude from '@lobehub/icons/es/Claude/components/Mono.js'
import DeepSeek from '@lobehub/icons/es/DeepSeek/components/Mono.js'
import Gemini from '@lobehub/icons/es/Gemini/components/Mono.js'
import Meta from '@lobehub/icons/es/Meta/components/Mono.js'
import OpenAI from '@lobehub/icons/es/OpenAI/components/Mono.js'
import Qwen from '@lobehub/icons/es/Qwen/components/Mono.js'

export const modelProviders = [
  { name: 'OpenAI', Icon: OpenAI },
  { name: 'Claude', Icon: Claude },
  { name: 'Gemini', Icon: Gemini },
  { name: 'DeepSeek', Icon: DeepSeek },
  { name: 'Qwen', Icon: Qwen },
  { name: 'Llama', Icon: Meta },
]
