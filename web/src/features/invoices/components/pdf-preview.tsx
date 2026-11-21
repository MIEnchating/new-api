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
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

export default function InvoicePdfPreview(props: { url: string }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(100)
  const [width, setWidth] = useState(0)
  const [failed, setFailed] = useState(false)
  const [rendering, setRendering] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | undefined
    setFailed(false)
    setDocument(null)
    setPage(1)
    void import('pdfjs-dist')
      .then(async (pdfjs) => {
        if (cancelled) return
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url
        ).toString()
        task = pdfjs.getDocument({
          url: props.url,
          cMapUrl: '/static/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/static/pdfjs/standard_fonts/',
          wasmUrl: '/static/pdfjs/wasm/',
        })
        const loaded = await task.promise
        if (!cancelled) setDocument(loaded)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [props.url, attempt])

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!document || !canvas.current || width === 0 || failed) return
    const element = canvas.current
    let cancelled = false
    let task: RenderTask | undefined
    setRendering(true)
    void document
      .getPage(page)
      .then(async (pdfPage) => {
        if (cancelled) return
        const original = pdfPage.getViewport({ scale: 1 })
        const scale = ((Math.max(1, width - 24) / original.width) * zoom) / 100
        const cssViewport = pdfPage.getViewport({ scale })
        // Bound canvas allocation on high-density phones and very large PDF pages.
        const density = Math.min(
          window.devicePixelRatio || 1,
          2,
          4096 / cssViewport.width,
          4096 / cssViewport.height
        )
        const renderViewport = pdfPage.getViewport({ scale: scale * density })
        const context = element.getContext('2d')
        if (!context) throw new Error('Canvas unavailable')
        element.width = Math.ceil(renderViewport.width)
        element.height = Math.ceil(renderViewport.height)
        element.style.width = `${cssViewport.width}px`
        element.style.height = `${cssViewport.height}px`
        task = pdfPage.render({
          canvas: element,
          canvasContext: context,
          viewport: renderViewport,
        })
        await task.promise
        if (!cancelled) setRendering(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [document, page, width, zoom, attempt, failed])

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-2'>
      {document && !failed && (
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex items-center gap-1'>
            <Button
              type='button'
              variant='outline'
              size='icon'
              aria-label={t('Go to previous page')}
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft aria-hidden='true' />
            </Button>
            <span role='status' className='px-2 text-sm tabular-nums'>
              {t('Page')} {formatNumber(page, locale)} /{' '}
              {formatNumber(document.numPages, locale)}
            </span>
            <Button
              type='button'
              variant='outline'
              size='icon'
              aria-label={t('Go to next page')}
              disabled={page === document.numPages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight aria-hidden='true' />
            </Button>
          </div>
          <div className='flex items-center gap-1'>
            <Button
              type='button'
              variant='outline'
              size='icon'
              aria-label={t('Zoom out')}
              disabled={zoom <= 50}
              onClick={() => setZoom(zoom - 25)}
            >
              <ZoomOut aria-hidden='true' />
            </Button>
            <span className='min-w-12 text-center text-sm tabular-nums'>
              {formatNumber(zoom, locale)}%
            </span>
            <Button
              type='button'
              variant='outline'
              size='icon'
              aria-label={t('Zoom in')}
              disabled={zoom >= 200}
              onClick={() => setZoom(zoom + 25)}
            >
              <ZoomIn aria-hidden='true' />
            </Button>
          </div>
        </div>
      )}
      <div
        ref={viewport}
        role='region'
        aria-label={t('Preview invoice')}
        tabIndex={0}
        className='bg-muted/30 min-h-0 flex-1 overflow-auto overscroll-contain rounded-lg border'
      >
        {failed ? (
          <ErrorState
            title={t('Preview unavailable')}
            className='min-h-48'
            onRetry={() => setAttempt(attempt + 1)}
          />
        ) : (
          <>
            {(!document || rendering) && <LoadingState className='min-h-32' />}
            <canvas
              ref={canvas}
              role='img'
              aria-label={t('Preview invoice')}
              className={`mx-auto my-3 max-w-none bg-white shadow-sm ${!document || rendering ? 'hidden' : 'block'}`}
            />
          </>
        )}
      </div>
    </div>
  )
}
