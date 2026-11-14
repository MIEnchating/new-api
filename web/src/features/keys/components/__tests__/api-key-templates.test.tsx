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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { ApiKeyTemplatesDialog } from '../api-key-templates-dialog'
import { ApiKeysMutateDrawer } from '../api-keys-mutate-drawer'
import { ApiKeysProvider } from '../api-keys-provider'
import { TemplateKeysCopyButton } from '../template-keys-copy-button'

const initialAuth = useAuthStore.getState().auth
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  useAuthStore.setState({ auth: initialAuth })
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.restoreAllMocks()
})

function renderTemplates(role: number = ROLE.USER, withKeyDrawer = false) {
  useAuthStore.getState().auth.setUser({ id: 7, username: 'owner', role })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  client.setQueryData(['status'], { default_use_auto_group: false })
  render(
    <QueryClientProvider client={client}>
      <ApiKeysProvider>
        <ApiKeyTemplatesDialog />
        {withKeyDrawer && (
          <ApiKeysMutateDrawer open={false} onOpenChange={() => undefined} />
        )}
      </ApiKeysProvider>
    </QueryClientProvider>
  )
}

const template = {
  id: 'claude',
  name: 'Claude',
  enabled: true,
  description: 'Claude routes',
  group_routes: [{ group: 'default', priority: 1, cooldown_seconds: 60 }],
  group_route_sticky: false,
  model_limits: ['model-a'],
}

test('ordinary users can manage templates with the key drawer mounted without privileged requests', async () => {
  const user = userEvent.setup()
  let savedTemplate = template
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/self/groups') {
      return {
        data: {
          success: true,
          data: { default: { desc: 'Default', ratio: 1 } },
        },
      }
    }
    if (url === '/api/token/smart-routing-templates?owned=true') {
      return {
        data: {
          success: true,
          data: { templates: [savedTemplate], max_user_templates: 10 },
        },
      }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: { keys: { 1: 'sk-first', 2: 'sk-second' } },
    },
  })
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const put = vi.spyOn(api, 'put').mockImplementation(async (url, body) => {
    expect(url).toBe('/api/token/smart-routing-templates')
    savedTemplate = (body as { templates: (typeof template)[] }).templates[0]
    return { data: { success: true, data: [savedTemplate] } }
  })
  renderTemplates(ROLE.USER, true)
  expect(get).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Routing templates' }))
  expect(await screen.findByText('Claude')).toBeVisible()
  expect(get).toHaveBeenCalledWith(
    '/api/token/smart-routing-templates?owned=true'
  )
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  expect(get).toHaveBeenCalledWith('/api/user/self/groups')
  expect(screen.getByRole('button', { name: 'Add template' })).toBeVisible()
  const name = screen.getByRole('textbox', { name: 'Template name' })
  await user.clear(name)
  await user.type(name, 'Personal Claude')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/token/smart-routing-templates', {
      templates: [
        {
          ...template,
          name: 'Personal Claude',
          group_routes: [{ ...template.group_routes[0], enabled: true }],
        },
      ],
    })
  )
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3))
  expect(screen.getByRole('textbox', { name: 'Template name' })).toHaveValue(
    'Personal Claude'
  )
  expect(post).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Copy linked keys' }))
  await waitFor(() => expect(copy).toHaveBeenCalledWith('sk-first\nsk-second'))
  expect(post).toHaveBeenCalledWith('/api/token/batch/keys', {
    routing_template_id: 'claude',
  })
  expect(screen.queryByText('sk-first')).not.toBeInTheDocument()
})

test('root users edit the existing global template and save model restrictions', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/option/') {
      return {
        data: {
          success: true,
          data: [
            { key: 'smart_routing_setting.enabled', value: 'true' },
            {
              key: 'smart_routing_setting.templates',
              value: JSON.stringify([template]),
            },
          ],
        },
      }
    }
    return { data: { success: true, data: ['default'] } }
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  renderTemplates(ROLE.SUPER_ADMIN)
  await user.click(screen.getByRole('button', { name: 'Routing templates' }))
  const input = await screen.findByRole('textbox', { name: 'Template name' })
  expect(
    screen.queryByRole('button', { name: 'Copy linked keys' })
  ).not.toBeInTheDocument()
  await user.clear(input)
  await user.type(input, 'Updated template')
  const models = screen.getByRole('combobox', {
    name: 'Select models (empty for allow all)',
  })
  await user.type(models, 'model-b')
  await user.keyboard('{Enter}')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(post).toHaveBeenCalled())
  const [url, body] = post.mock.calls[0]
  expect(url).toBe('/api/option/bulk')
  const options = (body as { options: Array<{ key: string; value: string }> })
    .options
  expect(options).toHaveLength(1)
  expect(options[0].key).toBe('smart_routing_setting.templates')
  expect(JSON.parse(options[0].value)).toEqual([
    {
      ...template,
      name: 'Updated template',
      group_routes: [{ ...template.group_routes[0], enabled: true }],
      model_limits: ['model-a', 'model-b'],
    },
  ])
})

test('an empty user template list renders an empty state', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { templates: [], max_user_templates: 10 },
    },
  })
  renderTemplates()
  await user.click(screen.getByRole('button', { name: 'Routing templates' }))
  expect(
    await screen.findByText('No routing templates configured')
  ).toBeVisible()
})

test('a 401 while loading templates shows retry and recovers without crashing the key page', async () => {
  const user = userEvent.setup()
  let unauthorized = true
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/token/smart-routing-templates?owned=true') {
      if (unauthorized) {
        unauthorized = false
        throw Object.assign(new Error('Unauthorized'), {
          response: { status: 401 },
        })
      }
      return {
        data: {
          success: true,
          data: { templates: [template], max_user_templates: 10 },
        },
      }
    }
    if (url === '/api/user/self/groups') {
      return { data: { success: true, data: { default: { ratio: 1 } } } }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
  renderTemplates(ROLE.USER, true)
  await user.click(screen.getByRole('button', { name: 'Routing templates' }))
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Add template' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(
    await screen.findByRole('textbox', { name: 'Template name' })
  ).toHaveValue('Claude')
})

test('copy waits for the server, blocks repeated clicks, and resets after a failure', async () => {
  const user = userEvent.setup()
  let reject: ((error: Error) => void) | undefined
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail
      })
  )
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  vi.spyOn(toast, 'error').mockReturnValue('error')
  render(<TemplateKeysCopyButton templateID='claude' />)
  const button = screen.getByRole('button', { name: 'Copy linked keys' })
  await user.click(button)
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute('aria-busy', 'true')
  await user.click(button)
  expect(post).toHaveBeenCalledTimes(1)
  reject?.(new Error('reveal denied'))
  await waitFor(() => expect(button).toBeEnabled())
  expect(copy).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalled()
})

test('empty linked keys leave the clipboard unchanged and display an empty message', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { keys: {} } },
  })
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const info = vi.spyOn(toast, 'info').mockReturnValue('empty')
  render(<TemplateKeysCopyButton templateID='empty' />)
  await user.click(screen.getByRole('button', { name: 'Copy linked keys' }))
  await waitFor(() => expect(info).toHaveBeenCalledWith('No linked keys'))
  expect(copy).not.toHaveBeenCalled()
})
