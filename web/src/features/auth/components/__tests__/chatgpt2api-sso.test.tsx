/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { ChatGPT2APISSO } from '../chatgpt2api-sso'

vi.mock('../../auth-layout', () => ({
  AuthLayout: (props: { children: ReactNode }) => <div>{props.children}</div>,
}))

vi.mock('@/lib/http-client', () => ({
  api: {
    post: vi.fn(() => new Promise(() => undefined)),
  },
}))

describe('ChatGPT2APISSO', () => {
  test('shows the intermediate SSO page while authorization is pending', () => {
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <ChatGPT2APISSO request='signed-request' />
      </QueryClientProvider>
    )

    expect(
      screen.getByRole('heading', { name: 'Signing in to chatgpt2api...' })
    ).toBeInTheDocument()
    expect(screen.getByText('Processing OAuth response...')).toBeInTheDocument()
  })
})
