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
import { fireEvent, render, waitFor, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, test } from 'vitest'

import type { CustomMenuPage } from '@/lib/custom-menu-pages'

import { MenuPageEditor } from '../custom-menu-pages-section'

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

function IconHarness(props: { icon?: string }) {
  const [page, setPage] = useState<CustomMenuPage>({
    id: 'page_icons01',
    name: 'Help',
    url: 'https://example.com/help',
    visibility: 'public',
    openMode: 'iframe',
    icon: props.icon,
  })
  return (
    <I18nextProvider i18n={i18n}>
      <MenuPageEditor
        page={page}
        index={0}
        onChange={(patch) => setPage((current) => ({ ...current, ...patch }))}
        onRemove={() => {}}
      />
      <output data-testid='icon'>{page.icon}</output>
    </I18nextProvider>
  )
}

describe('custom menu page icons', () => {
  test('editing and clearing an icon URL updates the preview and configuration', () => {
    const { container } = render(<IconHarness />)
    const view = within(container)
    const input = view.getByRole('textbox', { name: 'Icon URL' })
    const url = 'https://example.com/icon.svg?color=%23a1a1aa'
    fireEvent.change(input, { target: { value: url } })
    expect(view.getByTestId('icon')).toHaveTextContent(url)
    expect(view.getByRole('img', { name: 'Icon preview' })).toHaveAttribute(
      'src',
      url
    )
    fireEvent.click(view.getByRole('button', { name: 'Remove icon' }))
    expect(input).toHaveValue('')
    expect(view.getByTestId('icon')).toBeEmptyDOMElement()
    expect(
      view.queryByRole('img', { name: 'Icon preview' })
    ).not.toBeInTheDocument()
  })

  test('invalid URL shows an error and is not used as an image source', () => {
    const { container } = render(<IconHarness />)
    const view = within(container)
    const input = view.getByRole('textbox', { name: 'Icon URL' })
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(
      view.getByText('Icon URL must be a valid HTTP or HTTPS address')
    ).toBeInTheDocument()
    expect(
      view.queryByRole('img', { name: 'Icon preview' })
    ).not.toBeInTheDocument()
  })

  test('uploaded SVG remains previewable and can be replaced by a URL and uploaded again', async () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zy8+'
    const { container } = render(<IconHarness icon={svg} />)
    const view = within(container)
    const input = view.getByRole('textbox', { name: 'Icon URL' })
    expect(input).toHaveValue('')
    expect(view.getByRole('img', { name: 'Icon preview' })).toHaveAttribute(
      'src',
      svg
    )
    fireEvent.change(input, {
      target: { value: 'https://example.com/icon.svg' },
    })
    fireEvent.change(view.getByLabelText('Upload SVG'), {
      target: {
        files: [
          new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'icon.svg', {
            type: 'image/svg+xml',
          }),
        ],
      },
    })
    await waitFor(() =>
      expect(view.getByTestId('icon').textContent).toMatch(
        /^data:image\/svg\+xml;base64,/
      )
    )
    expect(input).toHaveValue('')
    expect(view.getByRole('img', { name: 'Icon preview' })).toHaveAttribute(
      'src',
      view.getByTestId('icon').textContent
    )
  })
})
