import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { QQBotBindingCard } from '../components/qq-bot-binding-card'

const { get, post, remove, requestVerification } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  remove: vi.fn(),
  requestVerification: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: { get, post, delete: remove } }))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    select: (state: { auth: { user: { id: number } } }) => unknown
  ) => select({ auth: { user: { id: 7 } } }),
}))
vi.mock('@/features/auth/secure-verification', () => ({
  SecureVerificationDialog: () => null,
  useSecureVerification: () => ({
    requestVerification,
    dialogProps: { state: { phase: 'idle' } },
  }),
}))

it('links the QQ profile only after confirmation and re-verifies unlinking', async () => {
  get.mockResolvedValue({
    data: { success: true, data: { enabled: true, bound: false } },
  })
  post.mockResolvedValue({ data: { success: true, data: { bound: true } } })
  remove.mockResolvedValue({ data: { success: true, data: { bound: false } } })
  requestVerification
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ proof_token: 'bind-proof' })
    .mockResolvedValueOnce({ proof_token: 'unbind-proof' })
  const cache = new QueryClient()
  const user = userEvent.setup()
  const view = render(
    <QueryClientProvider client={cache}>
      <QQBotBindingCard />
    </QueryClientProvider>
  )
  try {
    const code = `${'a'.repeat(42)}A`
    await user.type(await screen.findByLabelText('QQ binding code'), code)
    const bind = screen.getByRole<HTMLButtonElement>('button', { name: 'Bind' })
    await user.click(bind)
    await waitFor(() => expect(bind.disabled).toBe(false))
    expect(post).not.toHaveBeenCalled()
    await user.click(bind)
    const unbind = await screen.findByRole('button', { name: 'Unbind' })
    expect(requestVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'account.binding.bind',
        context: { provider: 'qq_bot', code },
      })
    )
    expect(post).toHaveBeenCalledWith(
      '/api/user/qqbot',
      { code },
      { headers: { 'X-Security-Proof': 'bind-proof' } }
    )
    await user.click(unbind)
    expect(
      await screen.findByLabelText<HTMLInputElement>('QQ binding code')
    ).toHaveProperty('value', '')
    expect(requestVerification).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: 'qq_bot.account.unbind' })
    )
    expect(remove).toHaveBeenCalledWith('/api/user/qqbot', {
      headers: { 'X-Security-Proof': 'unbind-proof' },
    })
  } finally {
    view.unmount()
    cache.clear()
  }
})
