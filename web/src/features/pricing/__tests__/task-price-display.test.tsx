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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, cleanup, within } from '@testing-library/react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { DynamicPricingBreakdown } from '../components/dynamic-pricing-breakdown'
import { ModelCard } from '../components/model-card'
import { ModelDetailsContent } from '../components/model-details'
import { ModelPriceCell } from '../components/model-price-cell'
import { getDailyTimePrices } from '../lib/daily-time-pricing'
import { getTaskPricingDisplayTiers } from '../lib/task-matrix-display'
import {
  hasSimpleTaskPricing,
  taskPriceLabel,
  taskEnumLabel,
  taskPricingConditions,
} from '../lib/task-price-display'
import type { PricingModel, BillingUsageSchema } from '../types'

vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

it('shows an explicit free request price alongside token prices with distinct units', () => {
  render(
    <DynamicPricingBreakdown
      billingExpr='len < 1000 ? tier("free", fixed(0)) : tier("tokens", p * 2 + c * 8)'
      matchedTierLabel='free'
    />
  )
  expect(screen.getAllByText('$0/request').length).toBeGreaterThan(0)
  expect(screen.getAllByText('Input / 1M token').length).toBeGreaterThan(0)
  expect(screen.getAllByText('Price per request').length).toBeGreaterThan(0)
})

it('renders weekday and hour conditions as time windows instead of expression source', () => {
  const condition =
    'weekday("Asia/Shanghai") >= 1 && weekday("Asia/Shanghai") <= 5 && ((hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12) || (hour("Asia/Shanghai") >= 14 && hour("Asia/Shanghai") < 18))'
  render(
    <DynamicPricingBreakdown
      billingExpr={`${condition} ? tier("peak", p * 3 + c * 9 + cr * 0.1) : tier("off_peak", p * 1.5 + c * 4.5 + cr * 0.05)`}
    />
  )
  expect(
    screen.getAllByText('Mon–Fri 09:00–12:00 or 14:00–18:00 (Asia/Shanghai)')
      .length
  ).toBeGreaterThan(0)
  expect(
    screen.getAllByText(
      'Outside these times: Mon–Fri 09:00–12:00 or 14:00–18:00 (Asia/Shanghai)'
    ).length
  ).toBeGreaterThan(0)
  expect(screen.queryByText(/weekday\(/)).not.toBeInTheDocument()
})

it('shows separate time windows with their actual conjunction, one timezone and a neutral multiplier', async () => {
  const translations = i18next.createInstance()
  await translations.init({
    lng: 'zh',
    fallbackLng: 'en',
    resources: { zh, en: { translation: {} } },
  })
  render(
    <I18nextProvider i18n={translations}>
      <DynamicPricingBreakdown
        compact
        billingExpr='(tier("base", p * 1 + c * 4 + cr * 0.02)) * (hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12 && hour("Asia/Shanghai") >= 14 && hour("Asia/Shanghai") < 18 ? 1 : 1)'
      />
    </I18nextProvider>
  )
  const rule = within(screen.getByRole('listitem'))
  expect(rule.getByText('09:00至12:00且14:00至18:00')).toBeVisible()
  expect(rule.getByText('时区: Asia/Shanghai')).toBeVisible()
  expect(rule.getByText('价格不变')).toBeVisible()
  expect(rule.queryByText(/&&|小时|1x/)).not.toBeInTheDocument()
  await act(() => translations.changeLanguage('en'))
  expect(rule.getByText('09:00–12:00 and 14:00–18:00')).toBeVisible()
  expect(rule.getByText('No price change')).toBeVisible()
})

it('preserves overnight alternatives and formats weekday and minute ranges in their own units', () => {
  render(
    <DynamicPricingBreakdown billingExpr='(tier("base", p * 1)) * ((hour("Asia/Shanghai") >= 21 || hour("Asia/Shanghai") < 6) && weekday("Asia/Shanghai") >= 1 && weekday("Asia/Shanghai") < 6 && minute("Asia/Shanghai") >= 15 && minute("Asia/Shanghai") < 30 ? 0.5 : 1)' />
  )
  const rule = within(screen.getByRole('listitem'))
  expect(
    rule.getByText('(21:00–24:00 or 00:00–06:00) and Mon–Fri and Minute: 15–29')
  ).toBeVisible()
  expect(rule.getByText('Timezone: Asia/Shanghai')).toBeVisible()
  expect(rule.getByText('0.5×')).toBeVisible()
})

it('keeps multiple timezones and non-time conditions attached to the right rules', () => {
  render(
    <DynamicPricingBreakdown billingExpr='(tier("base", p * 1)) * (hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12 && hour("UTC") >= 1 && hour("UTC") < 4 && header("mode") == "fast" ? 2 : 1)' />
  )
  const rule = within(screen.getByRole('listitem'))
  expect(
    rule.getByText(
      '09:00–12:00 (Asia/Shanghai) and 01:00–04:00 (UTC) and Header mode = fast'
    )
  ).toBeVisible()
  expect(rule.getByText('2×')).toBeVisible()
})

it('preserves recorded matches and unknown conditions in compact log details', () => {
  render(
    <DynamicPricingBreakdown
      compact
      billingExpr='tier("base", p * 1)'
      requestRules={[
        {
          cond: 'hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12 && header("mode") == "fast"',
          multiplier: 2,
          matched: true,
        },
        { cond: 'custom("unknown")', multiplier: 0.5, matched: false },
      ]}
    />
  )
  const [matched, unknown] = screen
    .getAllByRole('listitem')
    .map((row) => within(row))
  expect(matched.getByText('09:00–12:00 and Header mode = fast')).toBeVisible()
  expect(matched.getByText('Timezone: Asia/Shanghai')).toBeVisible()
  expect(matched.getByText('2× · Matched')).toBeVisible()
  expect(unknown.getByText('custom("unknown")')).toBeVisible()
  expect(unknown.queryByText(/Matched/)).not.toBeInTheDocument()
})

it('shows the actual input, output and cache prices for two daily windows and their complement', () => {
  render(
    <DynamicPricingBreakdown billingExpr='(tier("base", p * 1 + c * 4 + cr * 0.02)) * (hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12 ? 2 : 1) * (hour("Asia/Shanghai") >= 14 && hour("Asia/Shanghai") < 18 ? 2 : 1)' />
  )
  const table = within(screen.getByRole('table'))
  const adjusted = within(
    table.getByRole('row', { name: /09:00–12:00 or 14:00–18:00/ })
  )
  expect(adjusted.getByText('$2.0000')).toBeVisible()
  expect(adjusted.getByText('$8.0000')).toBeVisible()
  expect(adjusted.getByText('$0.0400')).toBeVisible()
  const base = within(table.getByRole('row', { name: /^Other times/ }))
  expect(base.getByText('$1.0000')).toBeVisible()
  expect(base.getByText('$4.0000')).toBeVisible()
  expect(base.getByText('$0.0200')).toBeVisible()
  expect(table.getByText('Input / 1M token')).toBeVisible()
  expect(screen.queryByText('Conditional multipliers')).not.toBeInTheDocument()
})

it('includes overlapping multipliers and retains the original OR semantics', () => {
  expect(
    getDailyTimePrices(
      '(hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12 ? 2 : 1) * (hour("Asia/Shanghai") >= 11 && hour("Asia/Shanghai") < 14 ? 3 : 1)'
    )
  ).toEqual({
    timezone: 'Asia/Shanghai',
    periods: [
      { multiplier: 2, ranges: [{ start: 9, end: 11 }] },
      { multiplier: 6, ranges: [{ start: 11, end: 12 }] },
      { multiplier: 3, ranges: [{ start: 12, end: 14 }] },
      {
        multiplier: 1,
        ranges: [
          { start: 0, end: 9 },
          { start: 14, end: 24 },
        ],
      },
    ],
  })
  expect(
    getDailyTimePrices('(hour("UTC") >= 9 || hour("UTC") < 12 ? 2 : 1)')
      ?.periods
  ).toEqual([{ multiplier: 2, ranges: [{ start: 0, end: 24 }] }])
  expect(
    getDailyTimePrices('(hour("UTC") >= 21 || hour("UTC") < 6 ? 0.5 : 1)')
      ?.periods
  ).toEqual([
    {
      multiplier: 0.5,
      ranges: [
        { start: 0, end: 6 },
        { start: 21, end: 24 },
      ],
    },
    { multiplier: 1, ranges: [{ start: 6, end: 21 }] },
  ])
  expect(getDailyTimePrices('(weekday("UTC") == 1 ? 2 : 1)')).toBeNull()
  expect(
    getDailyTimePrices(
      '(hour("UTC") < 12 && hour("Asia/Shanghai") >= 9 ? 2 : 1)'
    )
  ).toBeNull()
  expect(getDailyTimePrices('(header("mode") == "fast" ? 2 : 1)')).toBeNull()
})

it('keeps free time windows at zero and converts multiplied prices to the selected currency', () => {
  const config = useSystemConfigStore.getState().config
  useSystemConfigStore.setState({
    config: {
      ...config,
      currency: {
        ...config.currency,
        quotaDisplayType: 'CNY',
        usdExchangeRate: 7,
      },
    },
  })
  try {
    render(
      <DynamicPricingBreakdown billingExpr='(tier("base", p * 1 + c * 4)) * (hour("UTC") < 8 ? 0 : 1) * (hour("UTC") >= 9 && hour("UTC") < 12 ? 2 : 1)' />
    )
    const table = within(screen.getByRole('table'))
    const free = within(table.getByRole('row', { name: /00:00–08:00/ }))
    expect(free.getAllByText('¥0.0000')).toHaveLength(2)
    const adjusted = within(table.getByRole('row', { name: /09:00–12:00/ }))
    expect(adjusted.getByText('¥14.0000')).toBeVisible()
    expect(adjusted.getByText('¥56.0000')).toBeVisible()
  } finally {
    useSystemConfigStore.setState({ config })
  }
})

it('preserves tier conditions, per-request units and explicitly free cache prices', () => {
  render(
    <DynamicPricingBreakdown billingExpr='(len < 1000 ? tier("short", fixed(0.01)) : tier("long", p * 1 + c * 4 + cr * 0)) * (hour("UTC") < 8 ? 0.5 : 1)' />
  )
  const table = within(screen.getByRole('table'))
  expect(table.getAllByRole('row')).toHaveLength(5)
  expect(table.getByText('$0.005/request')).toBeVisible()
  expect(table.getByText('$0.01/request')).toBeVisible()
  expect(table.getByText('$0.5000')).toBeVisible()
  expect(table.getByText('$2.0000')).toBeVisible()
  expect(table.getAllByText('$0.0000')).toHaveLength(2)
  expect(table.getAllByText('Full input length < 1K')).toHaveLength(2)
})

const model: PricingModel = {
  id: 1,
  model_name: 'incho_music',
  quota_type: 0,
  model_ratio: 1,
  completion_ratio: 1,
  enable_groups: ['default'],
  billing_mode: 'tiered_expr',
  billing_expr: 'tier("music", u("clips") * 0.22)',
  billing_usage_schema: {
    clips: {
      type: 'number',
      unit: 'count',
      description: { en: 'Song generation unit price', zh: '生成歌曲单价' },
    },
    action: {
      enum: ['music'],
      enumLabels: { music: { en: 'Generate songs', zh: '生成歌曲' } },
      description: { en: 'Generate songs', zh: '生成歌曲' },
    },
  },
}
const clients: QueryClient[] = []
afterEach(async () => {
  cleanup()
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.restoreAllMocks()
  await i18next.changeLanguage('en')
})

it('shows one standard task price and a localized group price without duplicate tiers', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ data: { data: { groups: [] } } })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <ModelDetailsContent
        model={model}
        groupRatio={{ default: 2 }}
        usableGroup={{ default: { desc: '', ratio: 2 } }}
        endpointMap={{}}
        autoGroups={[]}
        priceRate={1}
        usdExchangeRate={7}
        tokenUnit='M'
      />
    </QueryClientProvider>
  )
  expect(
    screen.getAllByText('Song generation unit price', { exact: false })
  ).toHaveLength(2)
  expect(screen.queryByText('Tiered price table')).not.toBeInTheDocument()
  expect(screen.queryByText('Dynamic Pricing')).not.toBeInTheDocument()
  expect(screen.queryByText('music')).not.toBeInTheDocument()
  expect(screen.getByText('$0.22')).toBeVisible()
  expect(screen.getByText('$0.44')).toBeVisible()
  await act(() => i18next.changeLanguage('zhCN'))
  expect(screen.getAllByText('生成歌曲单价', { exact: false })).toHaveLength(2)
  await act(() => i18next.changeLanguage('fr'))
  expect(
    screen.getAllByText('Song generation unit price', { exact: false })
  ).toHaveLength(2)
})

it.each([false, true])(
  'shows one pricing section for a token model (dynamic: %s)',
  async (dynamic) => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { data: { groups: [] } } })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    clients.push(client)
    render(
      <QueryClientProvider client={client}>
        <ModelDetailsContent
          model={{
            id: 2,
            model_name: 'time-priced-model',
            quota_type: 0,
            model_ratio: 0.5,
            completion_ratio: 4,
            enable_groups: [],
            ...(dynamic
              ? {
                  billing_mode: 'tiered_expr',
                  billing_expr:
                    '(tier("base", p * 1 + c * 4 + cr * 0.02)) * (hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12 ? 2 : 1)',
                }
              : {}),
          }}
          groupRatio={{}}
          usableGroup={{}}
          endpointMap={{}}
          autoGroups={[]}
          priceRate={1}
          usdExchangeRate={7}
          tokenUnit='M'
        />
      </QueryClientProvider>
    )
    if (dynamic) {
      expect(screen.queryByText('Base Price')).not.toBeInTheDocument()
      expect(screen.getByText('Prices by time')).toBeVisible()
      expect(screen.getAllByText('$8.0000').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Other times').length).toBeGreaterThan(0)
    } else {
      expect(screen.getByText('Base Price')).toBeVisible()
      expect(screen.queryByText('Dynamic Pricing')).not.toBeInTheDocument()
    }
  }
)

it.each([
  {
    unit: 'M' as const,
    peak: ['$0.2', '$0.8', '$0.004'],
    base: ['$0.1', '$0.4', '$0.002'],
  },
  {
    unit: 'K' as const,
    peak: ['$0.0002', '$0.0008', '$0.000004'],
    base: ['$0.0001', '$0.0004', '$0.000002'],
  },
])(
  'applies time and group multipliers to both tiers with $unit token units',
  ({ unit, peak, base }) => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { data: { groups: [] } } })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    clients.push(client)
    render(
      <QueryClientProvider client={client}>
        <ModelDetailsContent
          model={{
            id: 3,
            model_name: 'group-time-pricing',
            quota_type: 0,
            model_ratio: 0.5,
            completion_ratio: 4,
            enable_groups: ['codex', 'codex-pro', 'free'],
            billing_mode: 'tiered_expr',
            billing_expr:
              '(tier("base", p * 1 + c * 4 + cr * 0.02)) * (hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12 ? 2 : 1) * (hour("Asia/Shanghai") >= 14 && hour("Asia/Shanghai") < 18 ? 2 : 1)',
          }}
          groupRatio={{ codex: 0.1, 'codex-pro': 0.25, free: 0 }}
          usableGroup={{
            codex: { desc: '', ratio: 0.1 },
            'codex-pro': { desc: '', ratio: 0.25 },
            free: { desc: '', ratio: 0 },
          }}
          endpointMap={{}}
          autoGroups={[]}
          priceRate={1}
          usdExchangeRate={7}
          tokenUnit={unit}
        />
      </QueryClientProvider>
    )
    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(4)
    for (const table of tables.slice(1)) {
      expect(within(table).getAllByRole('row')).toHaveLength(3)
      expect(
        within(table).getByRole('columnheader', { name: 'Time period' })
      ).toBeVisible()
      expect(within(table).getByText('Other times')).toBeVisible()
    }
    const codex = within(tables[1])
    const peakRow = within(
      codex.getByRole('row', { name: /09:00–12:00 or 14:00–18:00/ })
    )
    const baseRow = within(codex.getByRole('row', { name: /^Other times/ }))
    for (const value of peak) expect(peakRow.getByText(value)).toBeVisible()
    for (const value of base) expect(baseRow.getByText(value)).toBeVisible()
    expect(within(tables[3]).getAllByText('$0')).toHaveLength(6)
    if (unit === 'M') {
      const proPeak = within(
        within(tables[2]).getByRole('row', { name: /09:00–12:00/ })
      )
      for (const value of ['$0.5', '$2', '$0.01']) {
        expect(proPeak.getByText(value)).toBeVisible()
      }
    }
  }
)

it('labels even a single task price on model cards', async () => {
  render(<ModelCard model={model} onClick={() => {}} />)
  expect(screen.getByText('Song generation unit price')).toBeVisible()
  await act(() => i18next.changeLanguage('zhCN'))
  expect(screen.getByText('生成歌曲单价')).toBeVisible()
})

it('preserves condition tables, boolean states and additional charges', () => {
  render(
    <DynamicPricingBreakdown
      billingExpr='u("audio") == true ? tier("audio", 1 + u("seconds") * 0.8) : tier("silent", u("seconds") * 0.4)'
      usageSchema={{
        seconds: {
          type: 'number',
          unit: 'second',
          description: { en: 'Video generation unit price' },
        },
        audio: {
          type: 'boolean',
          description: { en: 'Whether audio is generated' },
        },
      }}
    />
  )
  expect(
    screen.getByRole('columnheader', { name: 'Applicable conditions' })
  ).toBeVisible()
  expect(screen.queryByText('Pricing conditions')).not.toBeInTheDocument()
  expect(
    screen.getAllByText('Whether audio is generated: Yes').length
  ).toBeGreaterThan(0)
  expect(
    screen.getAllByText('Whether audio is generated: No').length
  ).toBeGreaterThan(0)
  expect(screen.getAllByText('Additional charge').length).toBeGreaterThan(0)
  expect(screen.getAllByText('Video generation unit price')[0]).toHaveClass(
    'whitespace-normal',
    'break-words'
  )
})

it('keeps rules and custom expressions out of the simple price layout', () => {
  expect(hasSimpleTaskPricing(model)).toBe(true)
  expect(
    hasSimpleTaskPricing({
      ...model,
      billing_expr: `${model.billing_expr}|||when(header("x-fast") == "true") * 2`,
    })
  ).toBe(false)
  expect(
    hasSimpleTaskPricing({
      ...model,
      billing_expr: 'max(u("clips"), 2) * 0.22',
    })
  ).toBe(false)
  expect(taskPriceLabel(undefined, 'clips', 'fr')).toBe('clips')
  expect(
    taskPriceLabel({ en: 'Song price', zh: '歌曲单价' }, 'clips', 'zh-TW')
  ).toBe('歌曲单价')
  expect(
    taskPriceLabel({ en: 'Song price', zh: '歌曲单价' }, 'clips', 'ja')
  ).toBe('Song price')
})

const videoSchema: BillingUsageSchema = {
  tokens: {
    type: 'number',
    unit: 'token',
    description: { en: 'Billing token unit price', zh: '计费 Token 单价' },
  },
  resolution: {
    enum: ['480p', '720p', '1080p'],
    description: { en: 'Output resolution', zh: '输出分辨率' },
  },
  video_input: {
    enum: ['none', 'video'],
    description: { en: 'Reference video input', zh: '参考视频输入' },
    enumLabels: {
      none: { en: 'No reference video', zh: '无参考视频' },
      video: { en: 'With reference video', zh: '有参考视频' },
    },
  },
}
const videoExpression =
  'u("video_input") == "none" ? tier("none", u("tokens") * 10 / 1000000) : tier("video", u("tokens") * 6 / 1000000)'

it('uses plugin option labels and infers a unique fallback without expanding unrelated fields', async () => {
  render(
    <DynamicPricingBreakdown
      billingExpr={videoExpression}
      usageSchema={videoSchema}
    />
  )
  expect(screen.getAllByText('No reference video')).toHaveLength(2)
  expect(screen.getAllByText('With reference video')).toHaveLength(2)
  expect(screen.queryByText('Other cases')).not.toBeInTheDocument()
  expect(screen.queryByText('Pricing conditions')).not.toBeInTheDocument()
  expect(screen.queryByText('480p')).not.toBeInTheDocument()
  await act(() => i18next.changeLanguage('zhCN'))
  expect(screen.getAllByText('无参考视频')).toHaveLength(2)
  expect(screen.getAllByText('有参考视频')).toHaveLength(2)
  await act(() => i18next.changeLanguage('ja'))
  expect(screen.getAllByText('With reference video')).toHaveLength(2)
})

it('names ambiguous fallback rows other cases and keeps unmatched enum values readable', () => {
  const schema = {
    ...videoSchema,
    video_input: {
      ...videoSchema.video_input,
      enum: ['none', 'video', 'mixed'],
    },
  }
  render(
    <DynamicPricingBreakdown
      billingExpr={videoExpression}
      usageSchema={schema}
    />
  )
  expect(screen.getAllByText('Other cases')).toHaveLength(2)
  expect(taskEnumLabel(schema.video_input, 'mixed', 'zhCN')).toBe('mixed')
  expect(
    taskPricingConditions(
      [{ field: 'video_input', value: 'mixed' }],
      schema,
      'en',
      (key) => key
    )
  ).toBe('Reference video input: mixed')
  expect(
    taskEnumLabel(
      { enum: ['x'], enumLabels: { x: { en: 'English', zh: '中文' } } },
      'x',
      'fr'
    )
  ).toBe('English')
})

it('preserves all conditions and leaves multiple possible fallback combinations unspecified', () => {
  const tiers = getTaskPricingDisplayTiers(
    'u("resolution") == "720p" && u("video_input") == "none" ? tier("one", u("tokens") * 10 / 1000000) : tier("rest", u("tokens") * 6 / 1000000)',
    videoSchema
  )
  expect(
    taskPricingConditions(tiers[0].conditions, videoSchema, 'en', (key) => key)
  ).toBe('Output resolution: 720p · No reference video')
  expect(tiers[1].conditions).toEqual([])
})

it('uses the same recharge conversion and token unit in task condition prices', () => {
  render(
    <DynamicPricingBreakdown
      billingExpr={videoExpression}
      usageSchema={videoSchema}
      taskPriceOptions={{
        showRechargePrice: true,
        priceRate: 1,
        usdExchangeRate: 2,
      }}
    />
  )
  expect(screen.getAllByText('$5/1M token')).toHaveLength(2)
  expect(screen.getAllByText('$3/1M token')).toHaveLength(2)
})

it('keeps per-second task pricing distinct from per-request pricing in shared cells', () => {
  render(
    <ModelPriceCell
      model={{
        ...model,
        billing_mode: 'per_second',
        billing_expr: undefined,
        quota_type: 1,
        model_price: 0.2,
      }}
    />
  )
  expect(screen.getByText('Per-second')).toBeInTheDocument()
  expect(screen.queryByText('Per-request')).not.toBeInTheDocument()
  expect(screen.getByText(/\/ second$/)).toBeInTheDocument()
})
