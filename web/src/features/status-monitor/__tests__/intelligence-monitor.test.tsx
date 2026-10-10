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
import {
  IntelligenceSettingsSection,
  IntelligenceSettings,
} from '@/features/system-settings/operations/intelligence-settings-section'
import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import type { IntelligenceMonitorData } from '../intelligence-api'
import {
  inspectIntelligenceHtml,
  intelligencePreviewDocument,
} from '../intelligence-html'
import { IntelligenceMonitor } from '../intelligence-monitor'

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
        <IntelligenceSettings data={data} running />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Complete each question'
  )
  expect(put).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Running' })).toBeDisabled()
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
        <IntelligenceSettings data={data} running={false} />
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

it('saves independent daily times for multiple groups and manually runs only the selected group', async () => {
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
    catalog: { default: ['model-a'], vip: ['model-b'] },
    history: [],
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
        <IntelligenceSettings data={data} running={false} />
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
              times: ['09:00', '15:00', '21:00'],
              enabled: true,
            }),
            expect.objectContaining({
              group: 'vip',
              times: ['00:00', '09:00'],
              enabled: false,
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
        running={false}
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
    const title = await screen.findByLabelText('Group: default')
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
  const channels = ['default', 'vip'].map((group) => ({
    group,
    model: 'test-model',
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
                  `<body><h1>${channel.group}</h1>`
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
    for (const group of ['default', 'vip']) {
      const label = screen.getByLabelText(`Group: ${group}`)
      expect(label).toHaveTextContent(group)
      expect(label).toHaveAttribute('data-slot', 'status-badge')
    }
    for (const label of screen.getAllByLabelText('Model: test-model')) {
      expect(label).toHaveTextContent('test-model')
      expect(label).toHaveAttribute('title', 'test-model')
      expect(label).toHaveClass('font-mono')
    }

    for (const [index, frame] of frames.entries()) {
      expect(frame).toBeVisible()
      expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
      expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
      expect(frame.getAttribute('srcdoc')).toContain(
        `<h1>${channels[index].group}</h1>`
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
    expect(cards[0]?.parentElement).toHaveClass('md:grid-cols-2')
    expect(frames[0].closest('[data-preview-viewport]')).toHaveClass(
      'aspect-[6/5]',
      'overflow-hidden'
    )
  } finally {
    view.unmount()
    client.clear()
  }
})
