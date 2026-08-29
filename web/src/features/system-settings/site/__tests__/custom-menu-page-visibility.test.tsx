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
import { fireEvent, render, within } from '@testing-library/react'
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

function VisibilityHarness() {
  const [page, setPage] = useState<CustomMenuPage>({
    id: 'page_visibility',
    name: 'Help Center',
    url: 'https://example.com/help',
    visibility: 'public',
    openMode: 'iframe',
    section: 'general',
    enabled: true,
  })

  return (
    <I18nextProvider i18n={i18n}>
      <MenuPageEditor
        page={page}
        index={0}
        onChange={(patch) => setPage((current) => ({ ...current, ...patch }))}
        onRemove={() => {}}
      />
      <output data-testid='visibility'>{page.visibility}</output>
    </I18nextProvider>
  )
}

describe('custom menu page visibility', () => {
  test('switches from user-visible to administrator-only and hides menu location', () => {
    const { container } = render(<VisibilityHarness />)
    const view = within(container)
    const userVisibility = view.getByRole('switch', {
      name: 'Visible to users',
    })

    expect(userVisibility).toHaveAttribute('aria-checked', 'true')
    expect(view.getByText('Menu location')).toBeInTheDocument()

    fireEvent.click(userVisibility)

    expect(userVisibility).toHaveAttribute('aria-checked', 'false')
    expect(view.getByTestId('visibility')).toHaveTextContent('admin')
    expect(view.queryByText('Menu location')).not.toBeInTheDocument()
  })
})
