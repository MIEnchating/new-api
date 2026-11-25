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
import { useSearch } from '@tanstack/react-router'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { SORT_OPTIONS } from '../constants'
import { useFilters } from '../hooks/use-filters'
import {
  compareModelUsage,
  filterAndSortModels,
  sortModels,
  sortPricingVendors,
} from '../lib/filters'
import type { ModelOrder, PricingModel } from '../types'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useSearch: vi.fn(() => ({})),
}))

afterEach(() => {
  vi.mocked(useSearch).mockReturnValue({})
})

function pricingModel(
  modelName: string,
  overrides: Partial<PricingModel>
): PricingModel {
  return {
    id: 1,
    model_name: modelName,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
    ...overrides,
  }
}

const catalogVendors = [
  { id: 1, name: 'DeepSeek' },
  { id: 2, name: 'Anthropic' },
  { id: 3, name: 'Alibaba' },
  { id: 4, name: 'OpenAI' },
]

test('lists preferred vendors first and sorts remaining vendors by name', () => {
  const order = ['DeepSeek', 'Missing', 'OpenAI']
  const expected = ['DeepSeek', 'OpenAI', 'Alibaba', 'Anthropic']
  expect(sortPricingVendors(catalogVendors, order).map((v) => v.name)).toEqual(
    expected
  )
  expect(
    sortPricingVendors([...catalogVendors].reverse(), order).map((v) => v.name)
  ).toEqual(expected)
})

test.each([
  [
    'vendor',
    ['b-openai', 'z-openai', 'a-anthropic', 'c-alibaba', '0-unassigned'],
  ],
  [
    'name',
    ['0-unassigned', 'a-anthropic', 'b-openai', 'c-alibaba', 'z-openai'],
  ],
])('sorts the catalog by %s', (sortBy, expected) => {
  const catalogModels = [
    pricingModel('0-unassigned', {}),
    pricingModel('z-openai', { vendor_name: 'OpenAI' }),
    pricingModel('a-anthropic', { vendor_name: 'Anthropic' }),
    pricingModel('b-openai', { vendor_name: 'OpenAI' }),
    pricingModel('c-alibaba', { vendor_name: 'Alibaba' }),
  ]

  const sorted = filterAndSortModels(
    catalogModels,
    {
      search: '',
      vendor: 'all',
      group: 'all',
      quotaType: 'all',
      endpointType: 'all',
      tag: 'all',
      sortBy,
    },
    sortPricingVendors(catalogVendors, ['OpenAI', 'Anthropic'])
  )
  expect(sorted.map((model) => model.model_name)).toEqual(expected)
})

const models = [
  pricingModel('legacy-ratio', { model_ratio: 1, completion_ratio: 4 }),
  pricingModel('legacy-per-call', { quota_type: 1, model_price: 0.05 }),
  pricingModel('expr-tokens', {
    billing_mode: 'tiered_expr',
    billing_expr: 'tier("base", p * 1 + c * 10)',
  }),
  pricingModel('expr-long-context', {
    billing_mode: 'tiered_expr',
    billing_expr:
      'len <= 200000 ? tier("standard", p * 3 + c * 15) : tier("long", p * 6 + c * 22.5)',
  }),
  pricingModel('expr-input-only', {
    billing_mode: 'tiered_expr',
    billing_expr: 'tier("base", p * 0.1)',
  }),
  pricingModel('expr-fixed', {
    billing_mode: 'tiered_expr',
    billing_expr: 'tier("request", fixed(0.02))',
  }),
  pricingModel('expr-task', {
    billing_mode: 'tiered_expr',
    billing_expr: 'tier("base", u("seconds") * 0.1)',
    billing_usage_schema: { seconds: { type: 'number', unit: 'second' } },
    billing_usage_examples: [{ label: '5s', facts: { seconds: 5 } }],
  }),
]

describe('price sorting', () => {
  test.each([
    [
      SORT_OPTIONS.INPUT_PRICE_LOW,
      [
        'expr-input-only',
        'expr-tokens',
        'legacy-ratio',
        'expr-long-context',
        'legacy-per-call',
        'expr-fixed',
        'expr-task',
      ],
    ],
    [
      SORT_OPTIONS.INPUT_PRICE_HIGH,
      [
        'expr-long-context',
        'legacy-ratio',
        'expr-tokens',
        'expr-input-only',
        'legacy-per-call',
        'expr-fixed',
        'expr-task',
      ],
    ],
    [
      SORT_OPTIONS.OUTPUT_PRICE_LOW,
      [
        'legacy-ratio',
        'expr-tokens',
        'expr-long-context',
        'legacy-per-call',
        'expr-input-only',
        'expr-fixed',
        'expr-task',
      ],
    ],
    [
      SORT_OPTIONS.REQUEST_PRICE_HIGH,
      [
        'expr-task',
        'legacy-per-call',
        'expr-fixed',
        'legacy-ratio',
        'expr-tokens',
        'expr-long-context',
        'expr-input-only',
      ],
    ],
  ])(
    '%s compares base prices across legacy and expression billing and keeps unpriced models last',
    (sortBy, expected) => {
      const sorted = filterAndSortModels(models, {
        search: '',
        vendor: 'all',
        group: 'all',
        quotaType: 'all',
        endpointType: 'all',
        tag: 'all',
        sortBy,
      })
      expect(sorted.map((m) => m.model_name)).toEqual(expected)
    }
  )
})

test('sorts a plugin model by the token price its ordinary requests pay', () => {
  // Ratio 0.25 is $0.5 / 1M input tokens; the plugin has no price.
  const dualUse = pricingModel('dual-use', {
    model_ratio: 0.25,
    completion_ratio: 4,
    billing_usage_schema: { seconds: { type: 'number', unit: 'second' } },
    ordinary_pricing: true,
    billing_plugin_variants: [
      {
        plugin_key: 'alpha',
        plugin_name: 'Alpha',
        billing_mode: 'tiered_expr',
        billing_expr: '',
        billing_usage_schema: { seconds: { type: 'number', unit: 'second' } },
      },
    ],
  })
  expect(
    filterAndSortModels([...models, dualUse], {
      search: '',
      vendor: 'all',
      group: 'all',
      quotaType: 'all',
      endpointType: 'all',
      tag: 'all',
      sortBy: SORT_OPTIONS.INPUT_PRICE_LOW,
    }).map((m) => m.model_name)
  ).toEqual([
    'expr-input-only',
    'dual-use',
    'expr-tokens',
    'legacy-ratio',
    'expr-long-context',
    'legacy-per-call',
    'expr-fixed',
    'expr-task',
  ])
})

describe('model order sorting', () => {
  const squareModels = ['beta', 'Alpha', 'delta', 'gamma'].map((name) =>
    pricingModel(name, {})
  )
  const order: ModelOrder = {
    recommended: ['retired', 'gamma', 'beta'],
    requests: ['delta', 'gamma'],
    tokens: [],
  }
  const nameOrder = ['Alpha', 'beta', 'delta', 'gamma']

  test.each([
    [SORT_OPTIONS.RECOMMENDED, order, ['gamma', 'beta', 'Alpha', 'delta']],
    [SORT_OPTIONS.MOST_REQUESTS, order, ['delta', 'gamma', 'Alpha', 'beta']],
    [SORT_OPTIONS.MOST_TOKENS, order, nameOrder],
    [SORT_OPTIONS.RECOMMENDED, undefined, nameOrder],
  ])(
    '%s puts listed models first and the rest by name',
    (sortBy, modelOrder, expected) => {
      expect(
        sortModels(squareModels, sortBy, modelOrder).map((m) => m.model_name)
      ).toEqual(expected)
    }
  )

  test('defaults to the recommended order without a sort in the link', () => {
    const { result } = renderHook(() => useFilters(squareModels, order))

    expect(result.current.sortBy).toBe(SORT_OPTIONS.RECOMMENDED)
    expect(result.current.filteredModels.map((m) => m.model_name)).toEqual([
      'gamma',
      'beta',
      'Alpha',
      'delta',
    ])
  })

  test('keeps vendor order as the default until a recommendation is configured', () => {
    const vendorDefault: ModelOrder = { ...order, default_sort: 'vendor' }
    const catalog = [
      pricingModel('alpha', { vendor_name: 'OpenAI' }),
      pricingModel('beta', { vendor_name: 'DeepSeek' }),
    ]
    const { result } = renderHook(() =>
      useFilters(catalog, vendorDefault, catalogVendors)
    )

    expect(result.current.sortBy).toBe(SORT_OPTIONS.VENDOR)
    expect(
      sortModels(
        catalog,
        SORT_OPTIONS.RECOMMENDED,
        vendorDefault,
        catalogVendors
      ).map((model) => model.model_name)
    ).toEqual(['beta', 'alpha'])
    expect(
      result.current.filteredModels.map((model) => model.model_name)
    ).toEqual(['beta', 'alpha'])
  })

  test('keeps name order for old links with sort=name', () => {
    vi.mocked(useSearch).mockReturnValue({ sort: 'name' })

    const { result } = renderHook(() => useFilters(squareModels, order))

    expect(result.current.filteredModels.map((m) => m.model_name)).toEqual(
      nameOrder
    )
  })

  test('breaks usage ties like the server and lists unused models by name', () => {
    const rows = [
      { name: 'gamma', usage: 5 },
      { name: 'Zeta', usage: 0 },
      { name: 'Kappa', usage: 5 },
      { name: 'beta', usage: 0 },
      { name: 'delta', usage: 9 },
    ]

    // The server lists Kappa before gamma (byte order); unused models
    // follow the name sort, which puts beta before Zeta.
    expect(rows.sort(compareModelUsage).map((row) => row.name)).toEqual([
      'delta',
      'Kappa',
      'gamma',
      'beta',
      'Zeta',
    ])
  })
})
