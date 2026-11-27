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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { DirectionProvider } from '@/context/direction-provider'
import { FontProvider } from '@/context/font-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { api } from '@/lib/api'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/stores/auth-store'

import { ModelDetection } from '..'
import { readDetectionHistory, saveDetectionHistory } from '../history-storage'

vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

const prompts = [
  { id: 'one', prompt: 'First detector challenge', expected_count: 313 },
  { id: 'two', prompt: 'Second detector challenge', expected_count: 302 },
  { id: 'three', prompt: 'Third detector challenge', expected_count: 328 },
]
const result = {
  rounds: [
    {
      challenges: prompts,
      samples: [
        {
          state: 'complete',
          text: '123, 234, 345',
          count: 3,
          expectedCount: 313,
          startedAt: 1000,
          finishedAt: 21100,
          throughput: { ttftMs: 18000, tokensPerSecond: 54.8 },
        },
      ],
      analysis: {
        results: [
          { model: 'candidate', display_name: 'Candidate', probability: 0.9 },
        ],
      },
    },
  ],
  tokenizer: null,
}

const tokenizerResult = {
  verdict: {
    kind: 'unknown',
    confidence: 0.998,
    top: { id: 'baichuan', series: 'Baichuan 1' },
    claim: { status: 'consistent', vendor: 'Anthropic', expected: [] },
  },
  baseline_drift: false,
  unknown: 0.998,
  bank: { classes: 62 },
  classes: [
    {
      id: 'baichuan',
      series: 'Baichuan 1',
      lab_name: 'Baichuan',
      exact: 0.002,
    },
  ],
  steps: [
    { probe: null, state: 'done', tokens: 24 },
    {
      probe: 'cjk',
      state: 'done',
      tokens: 49,
      text: '测试文本',
      responseModel: 'upstream-model',
    },
  ],
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  useAuthStore.getState().auth.reset()
})

it('keeps console navigation visible when model detection opens directly', async () => {
  const user = { id: 7, username: 'detector', role: 1 }
  const now = Math.floor(Date.now() / 1000)
  useAuthStore.getState().auth.setBundle({
    access_token: 'fixture-access-token',
    token_type: 'Bearer',
    access_expires_at: now + 3600,
    user,
    session: {
      sid: 'fixture-session',
      current: true,
      login_method: 'password',
      ip: '',
      user_agent: '',
      created_at: now,
      last_active_at: now,
      expires_at: now + 3600,
    },
  })
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    const responses: Record<string, unknown> = {
      '/api/setup': { status: true },
      '/api/status': {},
      '/api/notice': '',
      '/api/user/self': user,
      '/api/user/self/groups': { default: { ratio: 1 } },
      '/api/model-detection/challenges': {
        token: 'sample-token',
        challenges: prompts,
      },
    }
    return { data: { success: true, data: responses[path] ?? [] } }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/model-detection'] }),
    context: { queryClient: client },
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <FontProvider>
          <DirectionProvider>
            <RouterProvider router={router} />
          </DirectionProvider>
        </FontProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )

  expect(
    await screen.findByRole('button', { name: 'Detection history' })
  ).toBeVisible()
  expect(screen.getByRole('link', { name: 'Model Detection' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'API Keys' })).toBeVisible()
})

function openDetector(userId = 7, defaultModel = 'fixture-model') {
  let revisions = 0
  vi.spyOn(api, 'get').mockImplementation(async (path, options) => {
    if (path === '/api/status') {
      return {
        data: {
          success: true,
          data: {
            server_address: 'https://gateway.example',
            api_info_enabled: true,
            api_info: [
              { url: 'https://primary.example', route: 'Primary route' },
              { url: 'https://backup.example/v1', route: 'Backup route' },
            ],
          },
        },
      }
    }
    if (path === '/api/user/self/groups') {
      return {
        data: {
          success: true,
          data: { default: { ratio: 1 }, other: { ratio: 2 } },
        },
      }
    }
    if (path === '/api/user/models') {
      const params = options?.params as { group?: string } | undefined
      return {
        data: {
          success: true,
          data: [params?.group === 'default' ? defaultModel : 'other-model'],
        },
      }
    }
    if (path === '/api/model-detection/challenges') {
      revisions++
      return {
        data: {
          success: true,
          data: {
            token: 'sample-token',
            challenges:
              revisions === 1
                ? prompts
                : prompts.map((entry) => ({
                    ...entry,
                    id: `${entry.id}-new`,
                    prompt: `New ${entry.prompt}`,
                  })),
          },
        },
      }
    }
    throw new Error(`Unexpected request ${path}`)
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const rootRoute = createRootRoute({
    component: () => <ModelDetection userId={userId} />,
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory(),
  })
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  field: string,
  option: string
) {
  const select = await screen.findByRole('combobox', { name: field })
  await waitFor(() => expect(select).toBeEnabled())
  await user.click(select)
  await user.click(await screen.findByRole('option', { name: option }))
}

async function selectModel(
  user: ReturnType<typeof userEvent.setup>,
  model = 'fixture-model'
) {
  await selectOption(user, 'Group', 'default')
  await selectOption(user, 'Model Name', model)
}

it('requires a group before selecting a model and clears the model when the group changes', async () => {
  const user = userEvent.setup()
  openDetector()
  expect(
    await screen.findByRole('combobox', { name: 'Model Name' })
  ).toBeDisabled()
  await selectModel(user)
  expect(
    await screen.findByRole('button', { name: 'Run detection' })
  ).toBeEnabled()

  await selectOption(user, 'Group', 'other')
  expect(screen.getByRole('button', { name: 'Run detection' })).toBeDisabled()
  await selectOption(user, 'Model Name', 'other-model')
  expect(screen.getByRole('button', { name: 'Run detection' })).toBeEnabled()
})

it('runs the selected site endpoint with its prepared prompts and opens the saved report in the history dialog', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: result } })
  const user = userEvent.setup()
  openDetector()
  expect(
    await screen.findByText('First detector challenge')
  ).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Sample 3' })).toBeInTheDocument()
  await selectModel(user)
  await user.click(screen.getByRole('combobox', { name: 'API address' }))
  const addresses = await screen.findByRole('listbox')
  expect(addresses.closest('[data-slot=select-content]')).toHaveAttribute(
    'data-align-trigger',
    'false'
  )
  await user.click(
    within(addresses).getByRole('option', {
      name: 'Backup route · https://backup.example/v1',
    })
  )
  expect(screen.getByRole('button', { name: 'Run detection' })).toBeDisabled()
  await user.type(screen.getByLabelText('API Key'), 'sk-fixture-key')
  await user.click(screen.getByRole('switch', { name: 'Parallel requests' }))
  await selectOption(user, 'Reasoning Effort', 'Medium')
  await user.click(screen.getByRole('switch', { name: 'Image mode' }))
  await user.click(screen.getByRole('switch', { name: 'Tokenizer probe' }))
  await user.click(screen.getByRole('button', { name: 'Run detection' }))

  const leader = await screen.findByRole('region', {
    name: 'Top reference candidate',
  })
  expect(
    within(leader).getByRole('heading', { name: 'Candidate' })
  ).toBeVisible()
  expect(within(leader).getByText('90%')).toBeVisible()
  const samples = screen.getByRole('region', { name: 'Detection samples' })
  const firstSample = within(samples).getByRole('button', { name: /Sample 1/ })
  expect(firstSample).toHaveAttribute('aria-expanded', 'false')
  expect(within(firstSample).getByText('3 numbers')).toBeVisible()
  expect(within(samples).queryByText('123, 234, 345')).not.toBeInTheDocument()
  await user.click(firstSample)
  expect(firstSample).toHaveAttribute('aria-expanded', 'true')
  expect(within(samples).getByText('123, 234, 345')).toBeVisible()
  expect(
    within(samples).getByText(
      '3 numbers · 20.1 seconds · First token 18.0 seconds · 55 tok/s'
    )
  ).toBeVisible()
  await user.click(firstSample)
  expect(firstSample).toHaveAttribute('aria-expanded', 'false')
  const results = screen.getByRole('region', { name: 'Detection results' })
  expect(samples.compareDocumentPosition(results)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  )
  expect(post).toHaveBeenCalledWith(
    '/api/model-detection',
    {
      endpoint: '/v1/chat/completions',
      api_url: 'https://backup.example/v1',
      api_key: 'sk-fixture-key',
      parallel: false,
      group: 'default',
      model: 'fixture-model',
      mode: 'detect',
      effort: 'medium',
      image: true,
      tokenizer: true,
      strict: false,
      stream: true,
      challenge_token: 'sample-token',
    },
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  )
  expect(readDetectionHistory(7)).toHaveLength(1)
  expect(localStorage.getItem('model-detection/history/v1/7')).not.toContain(
    'sk-fixture-key'
  )
  expect(readDetectionHistory(8)).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Detection history' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'Detection history',
  })
  expect(within(dialog).getByText('fixture-model')).toBeInTheDocument()
  await user.click(
    within(dialog).getByRole('button', { name: /View result.*fixture-model/ })
  )
  const historicalSamples = within(dialog).getByRole('region', {
    name: 'Detection samples',
  })
  expect(
    within(historicalSamples).getByRole('button', { name: /Tokenizer probe/ })
  ).toHaveAttribute('aria-expanded', 'false')
  await user.click(
    within(historicalSamples).getByRole('button', { name: /Sample 1/ })
  )
  expect(await within(dialog).findByText('123, 234, 345')).toBeInTheDocument()
})

it('opens a failed history record by keyboard and restores focus to that record on return', async () => {
  const user = userEvent.setup()
  saveDetectionHistory(
    7,
    { model: 'failed-model', group: 'codex', effort: '' },
    { status: 'error', message: 'The connection timed out.' },
    []
  )
  openDetector()

  await user.click(
    await screen.findByRole('button', { name: 'Detection history' })
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Detection history',
  })
  const row = within(dialog).getByRole('button', {
    name: /View result.*failed-model.*Failed/,
  })
  row.focus()
  await user.keyboard('{Enter}')
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'The connection timed out.'
  )
  const back = within(dialog).getByRole('button', { name: 'Back to history' })
  expect(back).toHaveFocus()

  await user.keyboard('{Enter}')
  expect(
    within(dialog).getByRole('button', {
      name: /View result.*failed-model.*Failed/,
    })
  ).toHaveFocus()
})

it('keeps the 20 newest detection records after saving a new run', () => {
  const outcome = { status: 'cancelled' } as const
  for (let number = 1; number <= 21; number++) {
    saveDetectionHistory(
      7,
      { model: `run-${number}`, group: 'default', effort: '' },
      outcome,
      []
    )
  }

  const records = readDetectionHistory(7)
  expect(records).toHaveLength(20)
  expect(records[0].target.model).toBe('run-21')
  expect(records.map(({ target }) => target.model)).not.toContain('run-1')
})

it('shows tokenizer diagnostics next to the sample controls and retries only the probe', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: { ...result, tokenizer: tokenizerResult },
      },
    })
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          rounds: null,
          tokenizer: {
            ...tokenizerResult,
            steps: [
              tokenizerResult.steps[0],
              {
                ...tokenizerResult.steps[1],
                responseModel: 'new-upstream-model',
              },
            ],
          },
        },
      },
    })
  const user = userEvent.setup()
  openDetector()
  await selectModel(user)
  await user.click(screen.getByRole('switch', { name: 'Tokenizer probe' }))
  await user.click(screen.getByRole('button', { name: 'Run detection' }))
  const report = await screen.findByRole('region', {
    name: 'Detection results',
  })
  const samples = screen.getByRole('region', { name: 'Detection samples' })
  expect(
    within(samples).getAllByRole('button', { name: /^Sample \d/ })
  ).toHaveLength(3)
  expect(
    within(report).queryByRole('button', { name: /Tokenizer probe/ })
  ).not.toBeInTheDocument()
  const probe = within(samples).getByRole('button', {
    name: /Tokenizer probe/,
  })
  expect(probe).toHaveAttribute('aria-expanded', 'false')
  probe.focus()
  await user.keyboard('{Enter}')
  expect(probe).toHaveAttribute('aria-expanded', 'true')
  expect(within(samples).getByText('Nearest to Baichuan 1')).toBeVisible()
  expect(
    within(samples).getByText('Response model: upstream-model')
  ).toBeVisible()
  expect(within(samples).getByText('测试文本')).toBeVisible()
  expect(within(samples).getByText('+25')).toBeVisible()

  await user.click(
    within(samples).getByRole('button', { name: 'Retry tokenizer probe' })
  )
  expect(post).toHaveBeenLastCalledWith(
    '/api/model-detection',
    expect.objectContaining({
      mode: 'tokenizer',
      model: 'fixture-model',
      tokenizer: false,
    }),
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  )
  expect(
    within(report).getByRole('heading', { name: 'Candidate' })
  ).toBeVisible()
  expect(
    await within(samples).findByText('Response model: new-upstream-model')
  ).toBeVisible()
  const records = readDetectionHistory(7)
  expect(records).toHaveLength(1)
  expect(records[0].outcome).toMatchObject({
    status: 'success',
    result: {
      tokenizer: {
        steps: [{ probe: null }, { responseModel: 'new-upstream-model' }],
      },
    },
  })
})

it('refreshes the three prompt cards without starting a detection', async () => {
  const post = vi.spyOn(api, 'post')
  const user = userEvent.setup()
  openDetector()

  expect(
    await screen.findByText('First detector challenge')
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'New sample prompts' }))
  expect(
    await screen.findByText('New First detector challenge')
  ).toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
})

it('celebrates the reference alias for GPT-6.1 Sol and clears the match for a different candidate', async () => {
  const matchMedia = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
    const media = matchMedia(query)
    return query.startsWith('(prefers-reduced-motion')
      ? { ...media, matches: false }
      : media
  })
  const draw = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    fill: draw,
    lineTo: vi.fn(),
    moveTo: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  const round = result.rounds[0]
  const completeSamples = prompts.map(() => round.samples[0])
  const post = vi.spyOn(api, 'post')
  for (const [model, display_name] of [
    ['gpt-6-astra', 'gpt-6-astra/6.1-sol'],
    ['a-different-model', 'a-different-model'],
  ]) {
    post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          ...result,
          rounds: [
            {
              ...round,
              samples: completeSamples,
              analysis: {
                results: [{ model, display_name, probability: 0.94 }],
              },
            },
          ],
        },
      },
    })
  }
  const user = userEvent.setup()
  openDetector(7, 'gpt-6.1-sol')
  await selectModel(user, 'gpt-6.1-sol')
  await user.click(screen.getByRole('button', { name: 'Run detection' }))

  expect(await screen.findByText('Model matched')).toBeVisible()
  await waitFor(() => expect(draw).toHaveBeenCalled())

  const ranking = screen.getByRole('button', { name: 'Candidate models' })
  expect(ranking).toHaveAttribute('aria-expanded', 'false')
  await user.click(ranking)
  expect(screen.getByRole('table')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Run detection' }))
  draw.mockClear()
  const report = await screen.findByRole('region', {
    name: 'Detection results',
  })
  expect(
    await within(report).findByRole('heading', { name: 'a-different-model' })
  ).toBeVisible()
  expect(within(report).queryByText('Model matched')).not.toBeInTheDocument()
  expect(draw).not.toHaveBeenCalled()
})

it('shows sampling controls and a reply area on each card before sampling', async () => {
  openDetector()

  const settings = await screen.findByRole('region', {
    name: 'Connection settings',
  })
  expect(
    screen.queryByRole('heading', { name: 'Connection settings' })
  ).toBeNull()
  expect(within(settings).queryByRole('combobox', { name: 'Mode' })).toBeNull()
  expect(
    within(settings).queryByRole('combobox', { name: 'API protocol' })
  ).toBeNull()
  expect(
    within(settings).queryByRole('combobox', { name: 'Service tier' })
  ).toBeNull()
  expect(within(settings).queryByText('Advanced options')).toBeNull()
  const options = within(settings).getByRole('group', {
    name: 'Sampling options',
  })
  for (const name of [
    'Streaming output',
    'Parallel requests',
    'Relaxed mode',
    'Tokenizer probe',
    'Image mode',
  ]) {
    expect(within(options).getByRole('switch', { name })).toBeVisible()
  }
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Sample 3' })).toBeVisible()
  })
  const samples = screen.getByRole('region', { name: 'Detection samples' })
  expect(
    within(samples).getAllByRole('heading', { name: 'Sample response' })
  ).toHaveLength(3)
  for (const challenge of prompts) {
    expect(
      await within(samples).findByText(
        `0 / ${challenge.expected_count} numbers`
      )
    ).toBeVisible()
  }
  const action = screen.getByRole('button', { name: 'Run detection' })
  const footer = action.closest('footer')
  expect(footer).toContainElement(
    screen.getByRole('button', { name: 'New sample prompts' })
  )
  expect(samples).not.toContainElement(footer)
})

it('opens each sampling option tooltip from the keyboard without changing the option', async () => {
  const user = userEvent.setup()
  openDetector()
  const options = await screen.findByRole('group', { name: 'Sampling options' })
  const descriptions = [
    ['Streaming output', /in chunks.+all at once/],
    ['Parallel requests', /all three sample requests.+one at a time/],
    ['Relaxed mode', /target count/],
    ['Tokenizer probe', /additional requests to identify the tokenizer/],
    ['Image mode', /model must accept images/],
  ] as const

  for (const [label, description] of descriptions) {
    const toggle = within(options).getByRole('switch', { name: label })
    const checked = toggle.getAttribute('aria-checked')
    expect(toggle).toHaveAccessibleDescription(description)
    expect(within(options).queryByText(description)).not.toBeInTheDocument()

    within(options)
      .getByRole('button', { name: `Help for ${label}` })
      .focus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(description)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(toggle.getAttribute('aria-checked')).toBe(checked)
  }
})

it('cancels an active run through the request signal', async () => {
  const post = vi.spyOn(api, 'post').mockImplementation(
    (_url, _input, config) =>
      new Promise((_resolve, reject) => {
        config?.signal?.addEventListener?.(
          'abort',
          () => reject(new Error('Cancelled')),
          { once: true }
        )
      })
  )
  const user = userEvent.setup()
  openDetector()
  await selectModel(user)
  await user.click(screen.getByRole('button', { name: 'Run detection' }))
  await user.click(await screen.findByRole('button', { name: 'Cancel' }))

  expect(post.mock.calls[0]?.[2]?.signal?.aborted).toBe(true)
  expect(await screen.findByText('Detection cancelled.')).toBeInTheDocument()
})
