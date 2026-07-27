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
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createInstance } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import zh from '@/i18n/locales/zh.json'
import type { ChannelExecutionTimelineItem } from '@/lib/channel-execution-timeline'

import { ChannelExecutionTimelineList } from '../channel-execution-timeline-list'

test('distinguishes group cooldown from channel affinity across groups', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'zh', resources: { zh } })

  const items: ChannelExecutionTimelineItem[] = [
    {
      kind: 'event',
      event: {
        sequence: 1,
        timestamp: 100,
        group: 'codex-限时',
        state: 'cooling',
        reason: 'group_route_failure',
        cooldown_until: 60,
      },
    },
    {
      kind: 'event',
      event: {
        sequence: 2,
        timestamp: 200,
        group: 'codex-特价',
        channel_id: 116,
        channel_name: 'us-sub2-codex-特价',
        state: 'affinity_hit',
        reason: 'channel_affinity',
      },
    },
  ]

  const markup = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ChannelExecutionTimelineList
        items={items}
        executionGroup='codex-特价'
        showGroupContext
      />
    </I18nextProvider>
  )

  assert.match(markup, /分组进入冷却/)
  assert.match(markup, /命中渠道亲和性/)
  assert.match(markup, /codex-限时/)
  assert.match(markup, /codex-特价/)
  assert.doesNotMatch(markup, /分组路由失败|复用亲和渠道/)
})
