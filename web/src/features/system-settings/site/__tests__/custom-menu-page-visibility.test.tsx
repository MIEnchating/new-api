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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import type { CustomMenuPage } from '@/lib/custom-menu-pages'

import { SettingsPageProvider } from '../../components/settings-page-context'
import {
  CustomMenuPagesSection,
  MenuPageEditor,
} from '../custom-menu-pages-section'

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
  test('switches from user-visible to administrator-only and keeps the top location available', () => {
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
    expect(
      view.getByRole('combobox', { name: 'Menu location' })
    ).toHaveTextContent('Admin')
  })

  test('top links use external opening without icon controls and can return to the sidebar', async () => {
    const user = userEvent.setup()
    render(<VisibilityHarness />)
    await user.click(screen.getAllByRole('combobox')[0])
    await user.click(screen.getByRole('option', { name: 'Top' }))
    expect(
      screen.getByRole('combobox', { name: 'Menu location' })
    ).toHaveTextContent('Top')
    expect(
      screen.getByRole('combobox', { name: 'Opening method' })
    ).toHaveTextContent('Open external link')
    expect(
      screen.getByRole('combobox', { name: 'Opening method' })
    ).toBeDisabled()
    expect(
      screen.queryByRole('textbox', { name: 'Icon URL' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Upload SVG' })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Visible to users' }))
    expect(
      screen.getByRole('combobox', { name: 'Menu location' })
    ).toHaveTextContent('Top')
    await user.click(screen.getByRole('combobox', { name: 'Menu location' }))
    await user.click(screen.getByRole('option', { name: 'Admin' }))
    expect(
      screen.getByRole('textbox', { name: 'Icon URL' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'Opening method' })
    ).not.toBeDisabled()
  })
})

function MenuSettings() {
  const [actionsContainer, setActionsContainer] =
    useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setActionsContainer} />
      <SettingsPageProvider actionsContainer={actionsContainer}>
        <CustomMenuPagesSection
          value={JSON.stringify([
            {
              id: 'page_save001',
              name: 'Help',
              url: 'https://example.com/help',
              visibility: 'public',
              section: 'general',
              openMode: 'iframe',
            },
          ])}
        />
      </SettingsPageProvider>
    </>
  )
}

test('saves a top external link with its existing URL and visibility', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const user = userEvent.setup()
  const view = render(
    <QueryClientProvider client={client}>
      <MenuSettings />
    </QueryClientProvider>
  )
  await user.click(screen.getByRole('combobox', { name: 'Menu location' }))
  await user.click(screen.getByRole('option', { name: 'Top' }))
  await user.click(
    screen.getByRole('button', { name: 'Save custom menu pages' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/option/', {
      key: 'CustomMenuPages',
      value: JSON.stringify([
        {
          id: 'page_save001',
          name: 'Help',
          url: 'https://example.com/help',
          visibility: 'public',
          section: 'header',
          openMode: 'external',
          enabled: true,
        },
      ]),
    })
  )
  view.unmount()
  client.clear()
})
