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
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import { IntelligenceHistory } from '@/features/system-settings/operations/intelligence-history'
import {
  IntelligenceSettingsSection,
  IntelligenceSettings,
} from '@/features/system-settings/operations/intelligence-settings-section'
import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import type {
  IntelligenceMonitorData,
  IntelligenceTask,
} from '../intelligence-api'
import {
  inspectIntelligenceHtml,
  intelligencePreviewDocument,
} from '../intelligence-html'
import { IntelligenceMonitor } from '../intelligence-monitor'
import { IntelligencePreview } from '../intelligence-preview'

const animation = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>@keyframes ride {to {transform:rotate(360deg)}} svg {width:100%}</style></head><body><svg viewBox="0 0 100 100"><circle r="10"/></svg></body></html>`
afterEach(() => {
  cleanup()
  document
    .querySelectorAll('[data-test-actions]')
    .forEach((node) => node.remove())
})

it('checks the requested HTML contract without treating prose or external assets as compliant', () => {
  expect(inspectIntelligenceHtml(animation)).toEqual({
    completeHtml: true,
    inlineSvg: true,
    animation: true,
    selfContained: true,
    responsive: true,
  })
  expect(
    inspectIntelligenceHtml(
      `Here is your code:\n\`\`\`html\n${animation}\n\`\`\``
    ).completeHtml
  ).toBe(false)
  expect(
    inspectIntelligenceHtml(
      '<html><img src="https://example.com/pelican.png"></html>'
    ).selfContained
  ).toBe(false)
  expect(
    inspectIntelligenceHtml(
      '<html><style>@import "./animation.css";</style></html>'
    ).selfContained
  ).toBe(false)
  expect(
    inspectIntelligenceHtml(
      '<html><img src="data:image/png;base64,AA=="><svg><use href="#bird"/></svg></html>'
    ).selfContained
  ).toBe(true)
  expect(
    inspectIntelligenceHtml(
      '<html><body>Sorry, I cannot do this.</body></html>'
    )
  ).toMatchObject({ inlineSvg: false, animation: false, responsive: false })
})

it('places restrictive CSP before generated scripts and removes embedded pages and navigation', () => {
  const source = intelligencePreviewDocument(
    `<html><head><base href="https://example.com"><meta http-equiv="refresh" content="0;url=https://example.com"><script>requestAnimationFrame(()=>{})</script></head><body><iframe srcdoc="test"></iframe><object data="x"></object><a href="https://example.com">link</a><svg viewBox="0 0 10 10"></svg></body></html>`
  )
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  expect(parsed.head.firstElementChild?.getAttribute('http-equiv')).toBe(
    'Content-Security-Policy'
  )
  expect(parsed.head.firstElementChild?.getAttribute('content')).toContain(
    "connect-src 'none'"
  )
  expect(parsed.head.firstElementChild?.getAttribute('content')).not.toContain(
    'https:'
  )
  expect(
    parsed.querySelector('base, iframe, object, meta[http-equiv="refresh"]')
  ).toBeNull()
  expect(parsed.querySelector('a')?.hasAttribute('href')).toBe(false)
  expect(parsed.querySelector('script')?.textContent).toBe(
    'requestAnimationFrame(()=>{})'
  )
  expect(parsed.querySelector('svg')).not.toBeNull()
})

it('saves edited questions and scheduling settings before allowing a manual run', async () => {
  const data: IntelligenceMonitorData = {
    config: {
      groups: [
        {
          group: 'default',
          model: 'test-model',
          endpoint: 'openai',
          enabled: false,
          times: ['09:00'],
        },
      ],
      questions: [
        { name: 'Pelican', prompt: 'Generate a cycling pelican animation' },
      ],
    },
    catalog: { default: ['test-model'] },
    history: [],
  }
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data } })
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, config) => ({
    data: { success: true, data: config },
  }))
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: { task_id: 'queued' } } })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const actions = document.createElement('div')
  actions.dataset.testActions = ''
  document.body.append(actions)
  const view = render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actions}>
        <IntelligenceSettingsSection />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  const streamSwitch = await screen.findByRole('switch', {
    name: 'Streaming output',
  })
  expect(streamSwitch).toBeChecked()
  await user.click(streamSwitch)
  await user.clear(await screen.findByLabelText('Prompt'))
  await user.type(
    screen.getByLabelText('Prompt'),
    'Generate a complete HTML animation'
  )
  await user.click(screen.getByRole('combobox', { name: 'API Endpoint' }))
  await user.click(
    screen.getByRole('option', { name: 'OpenAI Responses API · /v1/responses' })
  )
  await user.click(
    screen.getByRole('switch', { name: 'Scheduled intelligence testing' })
  )
  expect(screen.getByRole('button', { name: 'Run all groups' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/status-monitor/intelligence',
      expect.objectContaining({
        groups: [
          expect.objectContaining({
            endpoint: 'openai-response',
            stream: false,
            enabled: true,
            times: ['09:00'],
          }),
        ],
        questions: [
          { name: 'Pelican', prompt: 'Generate a complete HTML animation' },
        ],
      })
    )
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Run all groups' })).toBeEnabled()
  )
  await user.click(screen.getByRole('button', { name: 'Run all groups' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/status-monitor/intelligence/run',
      {}
    )
  )
  view.unmount()
  client.clear()
})

it.each([
  { order: ['vip', 'default', 'other'], expected: ['vip', 'default', 'other'] },
  { order: undefined, expected: ['default', 'other', 'vip'] },
])(
  'shows group options in server order with a legacy fallback ($order)',
  async ({ order, expected }) => {
    const data: IntelligenceMonitorData = {
      config: {
        groups: [
          {
            group: 'default',
            model: 'test-model',
            endpoint: 'openai',
            enabled: false,
            times: ['09:00'],
          },
        ],
        questions: [{ name: 'Pelican', prompt: 'Original prompt' }],
      },
      catalog: {
        default: ['test-model'],
        other: ['test-model'],
        vip: ['test-model'],
      },
      group_order: order,
      history: [],
    }
    const client = new QueryClient()
    const view = render(
      <QueryClientProvider client={client}>
        <SettingsPageProvider actionsContainer={null}>
          <IntelligenceSettings data={data} />
        </SettingsPageProvider>
      </QueryClientProvider>
    )
    const user = userEvent.setup()
    try {
      const selector = screen.getByRole('combobox', { name: 'Model Group' })
      await user.click(selector)
      expect(
        screen.getAllByRole('option').map((option) => option.textContent)
      ).toEqual(expected)
      expect(screen.getByRole('option', { name: 'default' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await user.click(screen.getByRole('option', { name: 'vip' }))
      expect(selector).toHaveTextContent('vip')
    } finally {
      view.unmount()
      client.clear()
    }
  }
)

it('separates settings from records and preserves unsaved edits across tabs', async () => {
  const data: IntelligenceMonitorData = {
    config: {
      groups: [
        {
          group: 'default',
          model: 'test-model',
          endpoint: 'openai',
          enabled: false,
          times: ['09:00'],
        },
      ],
      questions: [{ name: 'Pelican', prompt: 'Original prompt' }],
    },
    catalog: { default: ['test-model'] },
    history: [
      {
        task_id: 'run-1',
        status: 'succeeded',
        created_at: 1791613858,
        updated_at: 1791613858,
        group: 'default',
        model: 'test-model',
        endpoint: 'openai',
        error: '',
        result: { channels: [] },
      },
    ],
  }
  const client = new QueryClient()
  const actions = document.createElement('div')
  actions.dataset.testActions = ''
  document.body.append(actions)
  const view = render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actions}>
        <IntelligenceSettings data={data} />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  try {
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByLabelText('Prompt')).toBeVisible()
    expect(screen.queryByText('run-1')).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Prompt'))
    await user.type(screen.getByLabelText('Prompt'), 'Edited prompt')

    await user.click(
      screen.getByRole('tab', { name: 'Intelligence test history' })
    )
    expect(
      screen.getByRole('tab', { name: 'Intelligence test history' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('run-1')).toBeVisible()
    expect(screen.getByLabelText('Prompt')).not.toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Save' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Run all groups' })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(screen.getByLabelText('Prompt')).toHaveValue('Edited prompt')
    expect(screen.getByRole('button', { name: 'Save' })).toBeVisible()
    expect(screen.queryByText('run-1')).not.toBeInTheDocument()
  } finally {
    view.unmount()
    client.clear()
  }
})

it('rejects an empty question or an out-of-range schedule without saving', async () => {
  const data: IntelligenceMonitorData = {
    config: {
      groups: [
        {
          group: 'default',
          model: 'test-model',
          endpoint: 'openai',
          enabled: false,
          times: ['09:00'],
        },
      ],
      questions: [{ name: 'Pelican', prompt: '' }],
    },
    catalog: { default: ['test-model'] },
    history: [],
  }
  const put = vi.spyOn(api, 'put')
  const client = new QueryClient()
  const actions = document.createElement('div')
  actions.dataset.testActions = ''
  document.body.append(actions)
  const view = render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actions}>
        <IntelligenceSettings data={data} />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Complete each question'
  )
  expect(put).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Run all groups' })).toBeEnabled()
  view.unmount()
  client.clear()
})

it('shows results without configuration or execution controls on site status', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        config: {
          groups: [
            {
              group: 'default',
              model: 'test-model',
              endpoint: 'openai',
              enabled: false,
              times: ['09:00'],
            },
          ],
          questions: [{ name: 'Pelican', prompt: 'Draw a pelican' }],
        },
        catalog: { default: ['test-model'] },
        history: [],
      },
    },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligenceMonitor />
    </QueryClientProvider>
  )
  try {
    expect(
      await screen.findByText('No intelligence test results yet')
    ).toBeVisible()
    expect(screen.queryByLabelText('Prompt')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Run all groups' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Save' })
    ).not.toBeInTheDocument()
  } finally {
    view.unmount()
    client.clear()
  }
})

it('localizes the built-in question and endpoint menu while preserving user edits across language changes', async () => {
  const i18n = createInstance()
  await i18n.init({
    lng: 'zh',
    fallbackLng: 'en',
    resources: { en, zh },
    interpolation: { escapeValue: false },
  })
  const client = new QueryClient()
  const data: IntelligenceMonitorData = {
    config: {
      groups: [
        {
          group: 'default',
          model: 'test-model',
          endpoint: 'openai',
          enabled: false,
          times: ['09:00'],
        },
      ],
      questions: [
        { name: 'Pelican riding a bicycle', prompt: 'Draw a pelican' },
        { name: 'Save', prompt: 'Custom question' },
      ],
    },
    catalog: { default: ['test-model'] },
    history: [],
  }
  const view = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <IntelligenceSettings data={data} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  const user = userEvent.setup()
  try {
    expect(screen.getByDisplayValue('鹈鹕骑自行车')).toBeVisible()
    expect(screen.getByDisplayValue('Save')).toBeVisible()
    const endpoint = screen.getByRole('combobox', { name: 'API 端点' })
    expect(endpoint).toHaveTextContent('OpenAI 聊天补全')
    endpoint.focus()
    await user.keyboard('{Enter}')
    expect(
      await screen.findByRole('option', {
        name: 'OpenAI 响应接口 · /v1/responses',
      })
    ).toBeVisible()
    expect(endpoint).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(endpoint).toHaveTextContent('OpenAI 响应接口')
    expect(endpoint).toHaveAttribute('aria-expanded', 'false')
    await act(() => i18n.changeLanguage('en'))
    expect(screen.getByDisplayValue('Pelican riding a bicycle')).toBeVisible()
    expect(endpoint).toHaveTextContent('OpenAI Responses API')
    const name = screen.getByDisplayValue('Pelican riding a bicycle')
    await user.clear(name)
    await user.type(name, 'My own question')
    await act(() => i18n.changeLanguage('zh'))
    expect(screen.getByDisplayValue('My own question')).toBeVisible()
    expect(screen.getByDisplayValue('Save')).toBeVisible()
  } finally {
    view.unmount()
    client.clear()
  }
})

it('saves independent daily times for multiple groups and allows more runs while another task is active', async () => {
  const data: IntelligenceMonitorData = {
    config: {
      questions: [{ name: 'Pelican', prompt: 'Draw a pelican' }],
      groups: [
        {
          group: 'default',
          model: 'model-a',
          endpoint: 'openai',
          enabled: true,
          times: ['09:00', '15:00', '21:00'],
        },
        {
          group: 'vip',
          model: 'model-b',
          endpoint: 'openai-response',
          enabled: false,
          times: ['00:00'],
        },
      ],
    },
    catalog: {
      default: ['model-a', 'model-a-extended'],
      vip: ['model-b'],
      other: ['model-c'],
    },
    history: [
      {
        task_id: 'active-run',
        status: 'running',
        created_at: 1791613858,
        updated_at: 1791613858,
        group: 'default',
        model: 'model-a',
        endpoint: 'openai',
        error: '',
      },
    ],
  }
  const client = new QueryClient()
  const actions = document.createElement('div')
  actions.dataset.testActions = ''
  document.body.append(actions)
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, config) => ({
    data: { success: true, data: config },
  }))
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: { task_id: 'queued' } } })
  const view = render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actions}>
        <IntelligenceSettings data={data} />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  try {
    expect(
      screen.getAllByRole('combobox', { name: 'API Endpoint' })
    ).toHaveLength(2)
    await user.click(
      screen.getAllByRole('button', { name: 'Run this group' })[1]
    )
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/status-monitor/intelligence/run',
        { group: 'vip' }
      )
    )
    expect(screen.getByRole('button', { name: 'Run all groups' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Run all groups' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/status-monitor/intelligence/run',
        {}
      )
    )
    await user.click(
      screen.getAllByRole('combobox', { name: 'Select models' })[0]
    )
    await user.click(
      await screen.findByRole('option', { name: 'model-a-extended' })
    )
    await user.keyboard('{Escape}')
    await user.click(
      screen.getAllByRole('switch', {
        name: 'Scheduled intelligence testing',
      })[1]
    )
    await user.click(screen.getAllByRole('button', { name: 'Add time' })[1])
    expect(
      screen.getByRole('button', { name: 'Run all groups' })
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/status-monitor/intelligence',
        expect.objectContaining({
          groups: [
            expect.objectContaining({
              group: 'default',
              models: ['model-a', 'model-a-extended'],
              times: ['09:00', '15:00', '21:00'],
              enabled: true,
            }),
            expect.objectContaining({
              group: 'vip',
              models: ['model-b'],
              times: ['00:00', '09:00'],
              enabled: true,
            }),
          ],
        })
      )
    )
    await user.click(screen.getByRole('button', { name: 'Add test group' }))
    expect(
      screen.getAllByRole('switch', { name: 'Streaming output' })[2]
    ).toBeChecked()
    expect(
      screen.getAllByRole('combobox', { name: 'API Endpoint' })
    ).toHaveLength(3)
    await user.click(screen.getAllByRole('button', { name: 'Remove group' })[2])
    expect(
      screen.getAllByRole('combobox', { name: 'API Endpoint' })
    ).toHaveLength(2)
    await user.click(
      screen.getAllByRole('combobox', { name: 'Model Group' })[0]
    )
    await user.click(await screen.findByRole('option', { name: 'other' }))
    const group = screen.getByRole('group', { name: 'other' })
    expect(within(group).queryByText('model-a')).not.toBeInTheDocument()
    expect(
      within(group).queryByText('model-a-extended')
    ).not.toBeInTheDocument()
    put.mockClear()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText(
        'Select between 1 and 50 models for intelligence testing'
      )
    ).toBeVisible()
    expect(put).not.toHaveBeenCalled()
  } finally {
    view.unmount()
    client.clear()
  }
})

it('keeps daily times compact and keyboard editable in a separate group settings region', async () => {
  const client = new QueryClient()
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligenceSettings
        data={{
          config: {
            groups: [
              {
                group: 'default',
                model: 'model-a',
                endpoint: 'openai',
                enabled: true,
                times: ['09:00', '15:00', '21:00'],
              },
            ],
            questions: [{ name: 'Pelican', prompt: 'Draw a pelican' }],
          },
          catalog: { default: ['model-a'] },
          history: [],
        }}
      />
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  try {
    const groupRegion = screen.getByRole('region', { name: 'Test groups' })
    const questionRegion = screen.getByRole('region', { name: 'Question bank' })
    for (const region of [groupRegion, questionRegion]) {
      expect(region.querySelector('[data-slot=card]')).toHaveAttribute(
        'data-card-hover',
        'false'
      )
    }
    expect(
      within(groupRegion).queryByLabelText('Prompt')
    ).not.toBeInTheDocument()
    expect(within(questionRegion).getByLabelText('Prompt')).toBeVisible()
    const firstGroup = within(groupRegion).getByRole('group', {
      name: 'default',
    })
    const secondTime = within(firstGroup).getByLabelText('Execution time 2')
    expect(secondTime.parentElement?.parentElement).toHaveClass('flex-wrap')
    const removeTime = within(firstGroup).getAllByRole('button', {
      name: 'Remove time',
    })[1]
    removeTime.focus()
    await user.keyboard('{Enter}')
    expect(within(firstGroup).getByLabelText('Execution time 2')).toHaveValue(
      '21:00'
    )
    expect(
      within(firstGroup).queryByDisplayValue('15:00')
    ).not.toBeInTheDocument()
    const schedule = within(firstGroup).getByRole('switch', {
      name: 'Scheduled intelligence testing',
    })
    await user.click(schedule)
    expect(
      within(firstGroup).queryByLabelText('Execution time 1')
    ).not.toBeInTheDocument()
    await user.click(schedule)
    expect(within(firstGroup).getByLabelText('Execution time 1')).toHaveValue(
      '09:00'
    )
    expect(within(firstGroup).getByLabelText('Execution time 2')).toHaveValue(
      '21:00'
    )
  } finally {
    view.unmount()
    client.clear()
  }
})

it('keeps history cards stationary when the pointer enters a result', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        history: [
          {
            task_id: 'hover-result',
            status: 'failed',
            created_at: 1791613858,
            updated_at: 1791613978,
            group: 'default',
            model: 'test-model',
            endpoint: 'openai-response',
            error: 'Intelligence test request failed',
            result: { channels: [] },
          },
        ],
      },
    },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligenceMonitor />
    </QueryClientProvider>
  )
  try {
    const title = await screen.findByLabelText('Model: test-model')
    expect(title.closest('[data-slot=card]')).toHaveAttribute(
      'data-card-hover',
      'false'
    )
  } finally {
    view.unmount()
    client.clear()
  }
})

it('shows only compact result metadata and previews without channel IDs, record headings or rule checks', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const channels = ['test-model', 'second-model'].map((model) => ({
    group: 'default',
    model,
    channel_id: 1,
    question_index: 0,
    question_name: 'Pelican',
    latency_ms: 100,
    error: '',
  }))
  const task = {
    task_id: 'inline-result',
    status: 'succeeded',
    created_at: 1791613858,
    group: '',
    model: '',
    endpoint: '',
    groups: channels,
    result: { channels },
  }
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/inline-result')
        ? {
            ...task,
            result: {
              channels: channels.map((channel) => ({
                ...channel,
                html: animation.replace(
                  '<body>',
                  `<body><h1>${channel.model}</h1>`
                ),
              })),
            },
          }
        : { history: [task] },
    },
  }))
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligenceMonitor />
    </QueryClientProvider>
  )
  try {
    const frames = await screen.findAllByTitle('Generated animation preview')
    expect(frames).toHaveLength(2)
    expect(screen.getByRole('tab', { name: 'default' })).toBeVisible()
    expect(screen.queryByLabelText('Group: default')).not.toBeInTheDocument()
    for (const channel of channels) {
      const label = screen.getByLabelText(`Model: ${channel.model}`)
      expect(label).toHaveTextContent(channel.model)
      expect(label).toHaveAttribute('title', channel.model)
      expect(label).toHaveClass('font-mono')
    }

    for (const [index, frame] of frames.entries()) {
      expect(frame).toBeVisible()
      expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
      expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
      expect(frame.getAttribute('srcdoc')).toContain(
        `<h1>${channels[index].model}</h1>`
      )
      expect(frame.getAttribute('srcdoc')).toContain("connect-src 'none'")
    }
    expect(
      get.mock.calls.filter(([url]) => url.endsWith('/inline-result'))
    ).toHaveLength(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Preview and checks' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('tab', { name: 'HTML source' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Copy to clipboard' })
    ).not.toBeInTheDocument()
    expect(view.container.querySelector('pre')).toBeNull()
    expect(screen.queryByText('✓ Inline SVG')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Rule checks/ })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Channel #/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Intelligence test history' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Showing the latest 20 runs.')
    ).not.toBeInTheDocument()
    const timestamps = view.container.querySelectorAll('time[datetime]')
    expect(timestamps).toHaveLength(2)
    expect(timestamps[0]).toHaveAttribute('title')
    expect(timestamps[0].parentElement).toHaveTextContent('Pelican')
    expect(timestamps[0].parentElement).toHaveTextContent('seconds')
    const cards = frames.map((frame) => frame.closest('[data-slot=card]'))
    expect(cards[0]).not.toBe(cards[1])
    for (const card of cards) {
      expect(card).toHaveClass('border', 'ring-0')
    }
    expect(cards[0]?.parentElement).toHaveClass(
      'grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))]',
      'overflow-x-hidden'
    )
    expect(
      cards[0]?.querySelector('[data-slot=card-header] > div')
    ).toHaveClass('flex-wrap')
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Enlarge preview' })[0]
    )
    const dialog = await screen.findByRole('dialog')
    const enlarged = within(dialog).getByTitle('Generated animation preview')
    expect(enlarged).toHaveAttribute('sandbox', 'allow-scripts')
    expect(enlarged.getAttribute('srcdoc')).toContain("connect-src 'none'")
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(frames[0].closest('[data-preview-viewport]')).toHaveClass(
      'aspect-[6/5]',
      'overflow-hidden'
    )
  } finally {
    view.unmount()
    client.clear()
  }
})

it('shows admin request IDs and confirms deletion while protecting active runs', async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const remove = vi
    .spyOn(api, 'delete')
    .mockResolvedValue({ data: { success: true } })
  const task: IntelligenceTask = {
    task_id: 'run-1',
    status: 'succeeded',
    created_at: 1791613858,
    updated_at: 1791613858,
    group: 'vip',
    model: 'test-model',
    endpoint: 'openai',
    error: '',
    result: {
      channels: [
        {
          channel_id: 108,
          question_index: 0,
          question_name: 'Pelican',
          latency_ms: 100,
          error: '',
          request_id: 'request-123',
          upstream_request_id: 'upstream-456',
        },
      ],
    },
  }
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligenceHistory
        history={[
          task,
          {
            ...task,
            task_id: 'running-task',
            status: 'running',
            result: {
              channels: [
                {
                  channel_id: 108,
                  question_index: 0,
                  question_name: 'Pelican',
                  latency_ms: 100,
                  error: '',
                  request_id: undefined,
                  upstream_request_id: undefined,
                },
              ],
            },
          },
        ]}
      />
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  try {
    expect(screen.getByText('request-123')).toBeVisible()
    expect(screen.getByText('upstream-456')).toBeVisible()
    expect(screen.getByText('Not recorded')).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'Delete' })[1]).toBeDisabled()
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    let dialog = await screen.findByRole('alertdialog')
    expect(remove).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith(
        '/api/status-monitor/intelligence/results/run-1'
      )
    )
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['status-monitor', 'intelligence'],
    })
  } finally {
    view.unmount()
    client.clear()
  }
})

it('separates running models and displays their own progress independently', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const groups = ['fast-model', 'slow-model'].map((model) => ({
    group: 'default',
    model,
    endpoint: 'openai',
  }))
  const task: IntelligenceTask = {
    task_id: 'two-models',
    status: 'running',
    created_at: 1791613858,
    updated_at: 1791613858,
    group: '',
    model: '',
    endpoint: '',
    error: '',
    groups,
    state: {
      processed: 1,
      total: 3,
      progress: 33,
      models: [
        {
          group: 'default',
          model: 'fast-model',
          total: 1,
          processed: 1,
          failed: 0,
        },
        {
          group: 'default',
          model: 'slow-model',
          total: 2,
          processed: 0,
          failed: 0,
        },
      ],
    },
  }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { history: [task] } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligenceMonitor />
    </QueryClientProvider>
  )
  try {
    const fast = (await screen.findByLabelText('Model: fast-model')).closest(
      '[data-slot=card]'
    ) as HTMLElement
    const slow = screen
      .getByLabelText('Model: slow-model')
      .closest('[data-slot=card]') as HTMLElement
    expect(fast).not.toBe(slow)
    expect(within(fast).getByText('Completed')).toBeVisible()
    expect(within(fast).getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100'
    )
    expect(within(slow).getByText('Running')).toBeVisible()
    expect(within(slow).getByRole('progressbar')).not.toHaveAttribute(
      'aria-valuenow'
    )
    expect(within(slow).getByText('0 / 2')).toBeVisible()
    const models = task.state?.models ?? []
    act(() =>
      client.setQueryData(['status-monitor', 'intelligence', 'results'], {
        history: [
          {
            ...task,
            state: {
              ...task.state,
              models: [models[0], { ...models[1], processed: 1 }],
            },
          },
        ],
      })
    )
    await waitFor(() =>
      expect(within(slow).getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '50'
      )
    )
    expect(within(fast).getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100'
    )
    // Legacy batch percentages cannot be attributed to individual models.
    act(() =>
      client.setQueryData(['status-monitor', 'intelligence', 'results'], {
        history: [{ ...task, state: { processed: 1, total: 3, progress: 33 } }],
      })
    )
    await waitFor(() => {
      for (const progress of screen.getAllByRole('progressbar')) {
        expect(progress).not.toHaveAttribute('aria-valuenow')
      }
    })
  } finally {
    view.unmount()
    client.clear()
  }
})

it('shows finished model previews while another model runs and fetches its result when it finishes', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const channels = ['fast-model', 'slow-model'].map((model) => ({
    group: 'default',
    model,
    endpoint: 'openai-response',
    channel_id: 1,
    question_index: 0,
    question_name: 'Pelican',
    latency_ms: 100,
    error: '',
    html: animation.replace('<body>', `<body><h1>${model}</h1>`),
  }))
  let task: IntelligenceTask = {
    task_id: 'partial-results',
    status: 'running',
    created_at: 1791613858,
    updated_at: 1791613858,
    group: '',
    model: '',
    endpoint: '',
    error: '',
    groups: channels,
    state: {
      processed: 1,
      total: 2,
      progress: 50,
      models: channels.map((row, index) => ({
        group: row.group,
        model: row.model,
        total: 1,
        processed: index === 0 ? 1 : 0,
        failed: 0,
      })),
    },
    result: { channels: [channels[0]] },
  }
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/partial-results') ? task : { history: [task] },
    },
  }))
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligenceMonitor />
    </QueryClientProvider>
  )
  try {
    const preview = await screen.findByTitle('Generated animation preview')
    expect(preview.getAttribute('srcdoc')).toContain('<h1>fast-model</h1>')
    const slow = screen
      .getByLabelText('Model: slow-model')
      .closest('[data-slot=card]') as HTMLElement
    expect(within(slow).getByText('Running')).toBeVisible()
    expect(within(slow).getByRole('progressbar')).not.toHaveAttribute(
      'aria-valuenow'
    )
    task = {
      ...task,
      status: 'succeeded',
      result: { channels },
      state: {
        total: 2,
        processed: 2,
        progress: 100,
        models: task.state?.models?.map((row) => ({ ...row, processed: 1 })),
      },
    }
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ['status-monitor', 'intelligence', 'results'],
      })
    })
    await waitFor(() => {
      const previews = screen.getAllByTitle('Generated animation preview')
      expect(previews).toHaveLength(2)
      expect(previews[1].getAttribute('srcdoc')).toContain(
        '<h1>slow-model</h1>'
      )
    })
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Intelligence test returned no output')
    ).not.toBeInTheDocument()
  } finally {
    view.unmount()
    client.clear()
  }
})

it('filters results and pending models by group with keyboard tabs and falls back after a group disappears', async () => {
  const user = userEvent.setup()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const groups = ['default', 'vip', 'all'].map((group) => ({
    group,
    model: 'shared-model',
    endpoint: 'openai-response',
  }))
  const task: IntelligenceTask = {
    task_id: 'group-tabs',
    status: 'running',
    created_at: 1791613858,
    updated_at: 1791613858,
    group: '',
    model: '',
    endpoint: '',
    error: '',
    groups,
    state: {
      processed: 1,
      total: 3,
      progress: 33,
      models: groups.map((group, index) => ({
        ...group,
        total: 1,
        processed: index === 0 ? 1 : 0,
        failed: 0,
      })),
    },
    result: {
      channels: [
        {
          ...groups[0],
          channel_id: 1,
          question_index: 0,
          question_name: 'Pelican',
          latency_ms: 100,
          error: 'Example upstream error',
        },
      ],
    },
  }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { history: [task] } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligenceMonitor />
    </QueryClientProvider>
  )
  try {
    const all = await screen.findByRole('tab', { name: 'All' })
    expect(all).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByLabelText('Model: shared-model')).toHaveLength(3)
    expect(screen.getByRole('tablist', { name: 'Group' })).toHaveClass(
      'overflow-x-auto',
      'flex-nowrap',
      'min-w-0'
    )
    await user.click(screen.getByRole('tab', { name: 'default' }))
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('default')
    expect(screen.getAllByLabelText('Model: shared-model')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Example upstream error'
    )
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    await user.keyboard('{ArrowRight}{Enter}')
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'vip' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    )
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('vip')
    expect(
      screen.getByRole('progressbar', { name: 'Progress: vip · shared-model' })
    ).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Group: vip')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'all' }))
    expect(screen.getAllByLabelText('Model: shared-model')).toHaveLength(1)
    expect(
      screen.getByRole('progressbar', { name: 'Progress: all · shared-model' })
    ).toBeVisible()
    act(() =>
      client.setQueryData(['status-monitor', 'intelligence', 'results'], {
        history: [{ ...task, groups: [groups[0]] }],
      })
    )
    await waitFor(() => expect(all).toHaveAttribute('aria-selected', 'true'))
    expect(screen.queryByRole('tab', { name: 'all' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeVisible()
    act(() =>
      client.setQueryData(['status-monitor', 'intelligence', 'results'], {
        history: [],
      })
    )
    expect(
      await screen.findByText('No intelligence test results yet')
    ).toBeVisible()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  } finally {
    view.unmount()
    client.clear()
  }
})

it('uses legacy task groups and discovers groups stored only on historical results', async () => {
  const user = userEvent.setup()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const task: IntelligenceTask = {
    task_id: 'legacy-groups',
    status: 'failed',
    created_at: 1791613858,
    updated_at: 1791613858,
    group: 'legacy',
    model: 'legacy-model',
    endpoint: '',
    error: '',
    result: {
      channels: [
        {
          channel_id: 1,
          question_index: 0,
          question_name: 'Pelican',
          latency_ms: 100,
          error: 'Legacy failure',
        },
        {
          group: 'archived',
          model: 'archived-model',
          channel_id: 2,
          question_index: 0,
          question_name: 'Pelican',
          latency_ms: 100,
          error: 'Archived failure',
        },
      ],
    },
  }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { history: [task] } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligenceMonitor />
    </QueryClientProvider>
  )
  try {
    await user.click(await screen.findByRole('tab', { name: 'legacy' }))
    expect(screen.getByLabelText('Model: legacy-model')).toBeVisible()
    expect(
      screen.queryByLabelText('Model: archived-model')
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'archived' }))
    expect(screen.getByLabelText('Model: archived-model')).toBeVisible()
    expect(
      screen.queryByLabelText('Model: legacy-model')
    ).not.toBeInTheDocument()
  } finally {
    view.unmount()
    client.clear()
  }
})

it('loads previews only in view, releases offscreen animations and restores cached results on return', async () => {
  let intersect: (visible: boolean) => void = () => undefined
  const disconnect = vi.fn()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = (visible) =>
          callback(
            [{ isIntersecting: visible } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          )
      }
      observe() {}
      disconnect = disconnect
    }
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        task_id: 'visibility',
        status: 'succeeded',
        result: {
          channels: [
            {
              channel_id: 1,
              question_index: 0,
              html: animation,
            },
          ],
        },
      },
    },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligencePreview
        taskId='visibility'
        channelId={1}
        questionIndex={0}
      />
    </QueryClientProvider>
  )
  try {
    expect(get).not.toHaveBeenCalled()
    expect(
      screen.queryByTitle('Generated animation preview')
    ).not.toBeInTheDocument()
    act(() => intersect(true))
    const frame = await screen.findByTitle('Generated animation preview')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain("connect-src 'none'")
    act(() => intersect(false))
    expect(
      screen.queryByTitle('Generated animation preview')
    ).not.toBeInTheDocument()
    expect(view.container.firstElementChild).toHaveClass('aspect-[6/5]')
    act(() => intersect(true))
    expect(
      await screen.findByTitle('Generated animation preview')
    ).toBeVisible()
    expect(get).toHaveBeenCalledTimes(1)
    await userEvent.click(
      screen.getByRole('button', { name: 'Enlarge preview' })
    )
    const dialog = await screen.findByRole('dialog')
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    expect(
      within(dialog).getByTitle('Generated animation preview')
    ).toBeVisible()
    act(() => intersect(false))
    expect(
      within(dialog).getByTitle('Generated animation preview')
    ).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
  } finally {
    view.unmount()
    client.clear()
    vi.unstubAllGlobals()
  }
  expect(disconnect).toHaveBeenCalled()
})

it('releases hidden-page animations and restores the open enlarged preview from cache', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        task_id: 'background',
        status: 'succeeded',
        result: {
          channels: [
            {
              channel_id: 1,
              question_index: 0,
              html: animation,
            },
          ],
        },
      },
    },
  })
  focusManager.setFocused(false)
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligencePreview
        taskId='background'
        channelId={1}
        questionIndex={0}
      />
    </QueryClientProvider>
  )
  try {
    expect(get).not.toHaveBeenCalled()
    act(() => focusManager.setFocused(true))
    await screen.findByTitle('Generated animation preview')
    await userEvent.click(
      screen.getByRole('button', { name: 'Enlarge preview' })
    )
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByTitle('Generated animation preview')
    ).toBeVisible()
    act(() => focusManager.setFocused(false))
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(dialog).toBeInTheDocument()
    act(() => focusManager.setFocused(true))
    expect(
      await within(dialog).findByTitle('Generated animation preview')
    ).toBeVisible()
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    expect(get).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(
      await screen.findByTitle('Generated animation preview')
    ).toBeVisible()
    act(() => focusManager.setFocused(false))
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
  } finally {
    view.unmount()
    client.clear()
    focusManager.setFocused(undefined)
  }
})

it('stops downloading completed previews while a batch runs and fetches newly completed models', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const channels = ['fast', 'slow'].map((model) => ({
    channel_id: 1,
    question_index: 0,
    model,
    html: animation.replace('<body>', `<body><h1>${model}</h1>`),
  }))
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          task_id: 'cached-batch',
          status: 'running',
          result: { channels: [channels[0]] },
        },
      },
    })
    .mockResolvedValue({
      data: {
        success: true,
        data: {
          task_id: 'cached-batch',
          status: 'succeeded',
          result: { channels },
        },
      },
    })
  const view = render(
    <QueryClientProvider client={client}>
      <IntelligencePreview
        taskId='cached-batch'
        channelId={1}
        questionIndex={0}
        model='fast'
      />
    </QueryClientProvider>
  )
  try {
    expect(
      (await screen.findByTitle('Generated animation preview')).getAttribute(
        'srcdoc'
      )
    ).toContain('<h1>fast</h1>')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000)
    })
    expect(get).toHaveBeenCalledTimes(1)
    view.rerender(
      <QueryClientProvider client={client}>
        <IntelligencePreview
          taskId='cached-batch'
          channelId={1}
          questionIndex={0}
          model='fast'
        />
        <IntelligencePreview
          taskId='cached-batch'
          channelId={1}
          questionIndex={0}
          model='slow'
        />
      </QueryClientProvider>
    )
    await waitFor(() => {
      const frames = screen.getAllByTitle('Generated animation preview')
      expect(frames).toHaveLength(2)
      expect(frames[1].getAttribute('srcdoc')).toContain('<h1>slow</h1>')
    })
    expect(get).toHaveBeenCalledTimes(2)
  } finally {
    view.unmount()
    client.clear()
    vi.useRealTimers()
  }
})
