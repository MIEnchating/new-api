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
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { ModelMappingEditor } = await import('../model-mapping-editor')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        Visual: 'Visual',
        JSON: 'JSON',
        'Fill Template': 'Fill Template',
        'Original Model': 'Original Model',
        'Replacement Model': 'Replacement Model',
        'Delete mapping': 'Delete mapping',
        'Add Mapping': 'Add Mapping',
        'No model mappings configured. Click "Add Mapping" to get started.':
          'No model mappings configured. Click "Add Mapping" to get started.',
      },
    },
  },
})

function EditorHarness(props: { initialValue: string }) {
  const [value, setValue] = useState(props.initialValue)
  return (
    <I18nextProvider i18n={i18n}>
      <ModelMappingEditor value={value} onChange={setValue} />
    </I18nextProvider>
  )
}

describe('model mapping editor', () => {
  test('adds the first blank mapping row with one click', () => {
    render(<EditorHarness initialValue='' />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Mapping' }))

    expect(screen.getAllByRole('combobox')).toHaveLength(2)
    expect(screen.getByPlaceholderText('gpt-3.5-turbo')).toHaveValue('')
  })

  test('keeps a newly added row when the stored JSON uses compact formatting', () => {
    render(<EditorHarness initialValue='{"gpt-4":"gpt-4o"}' />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Mapping' }))

    const inputs = screen.getAllByRole('combobox')
    expect(inputs).toHaveLength(4)
    expect(screen.getByDisplayValue('gpt-4')).toBeVisible()
    expect(inputs[2]).toHaveValue('')
    expect(inputs[3]).toHaveValue('')
  })
})
