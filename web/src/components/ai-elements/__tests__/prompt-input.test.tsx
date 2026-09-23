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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { PromptInput, PromptInputTextarea } from '../prompt-input'

test('wraps unbroken prompt text with bounded vertical scrolling and submits the original value', async () => {
  const prompt =
    'https://example.com/very-long-unbroken-prompt-segment-without-whitespace-to-wrap-inside-the-playground-input'
  const onSubmit = vi.fn()
  const user = userEvent.setup()
  render(
    <PromptInput onSubmit={onSubmit}>
      <PromptInputTextarea aria-label='Prompt' className='min-h-20' />
    </PromptInput>
  )
  const input = screen.getByRole('textbox', { name: 'Prompt' })

  await user.click(input)
  await user.paste(prompt)

  expect(input).toHaveValue(prompt)
  expect(input).toHaveClass('break-all', 'max-h-48', 'overflow-y-auto')
  await user.keyboard('{Enter}')
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      { text: prompt, files: [] },
      expect.anything()
    )
  )
})
