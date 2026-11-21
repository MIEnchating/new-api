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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { InvoiceFilePreview } from '../components/file-preview'

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument,
}))

const clients: QueryClient[] = []
afterEach(() => {
  clients.forEach((client) => client.clear())
  clients.length = 0
})

function renderPreview(type = 'image/png') {
  if (type === 'application/pdf') {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D
    )
    getDocument.mockImplementation(() => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn(async () => ({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 600 * scale,
            height: 800 * scale,
          }),
          render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
        })),
      }),
      destroy: vi.fn(async () => {}),
    }))
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: new Blob(['invoice'], { type }),
    headers: {
      'content-disposition': 'attachment; filename="Example Company.pdf"',
    },
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:invoice-preview')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const view = render(
    <QueryClientProvider client={client}>
      <InvoiceFilePreview requestId={4} title='Example Company' />
    </QueryClientProvider>
  )
  return { ...view, get, revoke }
}

it('enlarges an image, supports bounded zoom and resets when reopened', async () => {
  const user = userEvent.setup()
  const { get } = renderPreview()
  expect(screen.getByRole('group', { name: 'Invoice file' })).toHaveClass(
    'grid-cols-2',
    'border-t'
  )
  expect(get).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('button', { name: 'Enlarge preview' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Preview invoice' }))
  const trigger = await screen.findByRole('button', { name: 'Enlarge preview' })
  trigger.focus()
  await user.keyboard('{Enter}')
  const dialog = await screen.findByRole('dialog', { name: 'Preview invoice' })
  const region = within(dialog).getByRole('region', { name: 'Preview invoice' })
  expect(region).toHaveClass('overflow-auto')
  expect(region).toHaveAttribute('tabindex', '0')
  const image = within(dialog).getByRole('img', { name: 'Preview invoice' })
  const zoomIn = within(dialog).getByRole('button', { name: 'Zoom in' })
  const zoomOut = within(dialog).getByRole('button', { name: 'Zoom out' })
  await user.click(zoomIn)
  expect(image.parentElement).toHaveStyle({ width: '125%' })
  expect(within(dialog).getByRole('status')).toHaveTextContent('125%')
  for (let i = 0; i < 7; i++) await user.click(zoomIn)
  expect(zoomIn).toBeDisabled()
  expect(image.parentElement).toHaveStyle({ width: '300%' })
  await user.click(within(dialog).getByRole('button', { name: 'Reset zoom' }))
  expect(image.parentElement).toHaveStyle({ width: '100%' })
  await user.click(zoomOut)
  await user.click(zoomOut)
  expect(zoomOut).toBeDisabled()
  expect(image.parentElement).toHaveStyle({ width: '50%' })
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  await waitFor(() => expect(trigger).toHaveFocus())
  await user.click(trigger)
  expect(
    within(await screen.findByRole('dialog')).getByRole('status')
  ).toHaveTextContent('100%')
  expect(get).toHaveBeenCalledTimes(1)
})

it('renders PDF pages with pagination, zoom and download actions', async () => {
  const user = userEvent.setup()
  const { unmount, revoke } = renderPreview('application/pdf')
  await user.click(screen.getByRole('button', { name: 'Preview invoice' }))
  await user.click(
    await screen.findByRole('button', { name: 'Enlarge preview' })
  )
  const dialog = await screen.findByRole('dialog', { name: 'Preview invoice' })
  const canvas = await within(dialog).findByRole('img', {
    name: 'Preview invoice',
  })
  await waitFor(() => expect(canvas).toBeVisible())
  expect(canvas.tagName).toBe('CANVAS')
  expect(within(dialog).getByRole('status')).toHaveTextContent('Page 1 / 2')
  await user.click(
    within(dialog).getByRole('button', { name: 'Go to next page' })
  )
  expect(within(dialog).getByRole('status')).toHaveTextContent('Page 2 / 2')
  expect(
    within(dialog).getByRole('button', { name: 'Go to next page' })
  ).toBeDisabled()
  await user.click(within(dialog).getByRole('button', { name: 'Zoom in' }))
  expect(within(dialog).getByText('125%')).toBeVisible()
  const link = within(dialog).getByRole('link', { name: 'Open in new tab' })
  expect(link).toHaveAttribute('href', 'blob:invoice-preview')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(
    within(dialog).getByRole('link', { name: 'Download invoice' })
  ).toHaveAttribute('download', 'Example Company.pdf')
  unmount()
  expect(revoke).toHaveBeenCalledWith('blob:invoice-preview')
  expect(getDocument.mock.results.at(-1)?.value.destroy).toHaveBeenCalled()
})

it('keeps PDF download available after a rendering failure and renders after retry', async () => {
  const user = userEvent.setup()
  renderPreview('application/pdf')
  getDocument.mockImplementationOnce(() => ({
    promise: Promise.reject(new Error('PDF decoding failed')),
    destroy: vi.fn(async () => {}),
  }))
  await user.click(screen.getByRole('button', { name: 'Preview invoice' }))
  await user.click(
    await screen.findByRole('button', { name: 'Enlarge preview' })
  )
  const dialog = await screen.findByRole('dialog', { name: 'Preview invoice' })
  expect(await within(dialog).findByText('Preview unavailable')).toBeVisible()
  expect(
    within(dialog).getByRole('link', { name: 'Download invoice' })
  ).toBeVisible()
  await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
  expect(
    await within(dialog).findByRole('img', { name: 'Preview invoice' })
  ).toBeVisible()
})

it('opens a mobile PDF preview directly and returns to the collapsed file card', async () => {
  const matchMedia = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...matchMedia(query),
    matches: query === '(max-width: 640px)' || matchMedia(query).matches,
  }))
  const user = userEvent.setup()
  renderPreview('application/pdf')

  const previewButton = screen.getByRole('button', { name: 'Preview invoice' })
  await user.click(previewButton)
  const dialog = await screen.findByRole('dialog', { name: 'Preview invoice' })
  expect(
    await within(dialog).findByRole('img', { name: 'Preview invoice' })
  ).toBeVisible()
  expect(dialog.querySelector('iframe, object')).toBeNull()
  expect(
    within(dialog).getByRole('link', { name: 'Open in new tab' })
  ).toBeVisible()
  expect(
    within(dialog).getByRole('link', { name: 'Download invoice' })
  ).toBeVisible()

  await user.click(within(dialog).getByRole('button', { name: 'Close' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Preview invoice' })
    ).not.toBeInTheDocument()
  )
  expect(previewButton).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByTitle('Preview invoice')).not.toBeInTheDocument()
})

it('does not offer enlargement when loading fails and recovers on retry', async () => {
  const user = userEvent.setup()
  const { get } = renderPreview()
  get.mockRejectedValueOnce(new Error('file unavailable'))
  await user.click(screen.getByRole('button', { name: 'Preview invoice' }))
  expect(await screen.findByText('Preview unavailable')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Enlarge preview' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(
    await screen.findByRole('button', { name: 'Enlarge preview' })
  ).toBeEnabled()
})
