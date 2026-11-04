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
import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

export function InvoiceFilePreviewDialog(props: {
  url: string
  filename: string
  type: string
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(100)
  const viewport = useRef<HTMLDivElement>(null)
  const isImage = props.type.startsWith('image/')
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setZoom(100)
      }}
      title={t('Preview invoice')}
      description={props.filename}
      descriptionClassName='break-all pr-6'
      contentClassName='w-[calc(100vw-2rem)] max-w-none overflow-hidden sm:max-w-[min(90rem,calc(100vw-2rem))]'
      contentHeight='75dvh'
      bodyClassName='flex flex-col gap-3'
      trigger={
        <Button type='button' variant='outline' size='sm'>
          <Maximize2 aria-hidden='true' />
          {t('Enlarge preview')}
        </Button>
      }
    >
      {open && (
        <>
          <div className='flex shrink-0 flex-wrap items-center gap-2'>
            {isImage && (
              <>
                <Button
                  type='button'
                  variant='outline'
                  size='icon'
                  aria-label={t('Zoom out')}
                  disabled={zoom <= 50}
                  onClick={() => setZoom((value) => Math.max(50, value - 25))}
                >
                  <ZoomOut aria-hidden='true' />
                </Button>
                <span
                  role='status'
                  className='min-w-14 text-center text-sm tabular-nums'
                >
                  {formatNumber(zoom, locale)}%
                </span>
                <Button
                  type='button'
                  variant='outline'
                  size='icon'
                  aria-label={t('Zoom in')}
                  disabled={zoom >= 300}
                  onClick={() => setZoom((value) => Math.min(300, value + 25))}
                >
                  <ZoomIn aria-hidden='true' />
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => {
                    setZoom(100)
                    if (viewport.current) {
                      viewport.current.scrollTop = 0
                      viewport.current.scrollLeft = 0
                    }
                  }}
                >
                  <RotateCcw aria-hidden='true' />
                  {t('Reset zoom')}
                </Button>
              </>
            )}
            <Button
              role='link'
              variant='outline'
              size='sm'
              render={
                <a href={props.url} target='_blank' rel='noopener noreferrer' />
              }
            >
              {t('Open in new tab')}
            </Button>
          </div>
          {isImage ? (
            <div
              ref={viewport}
              role='region'
              aria-label={t('Preview invoice')}
              tabIndex={0}
              className='bg-muted/30 min-h-0 flex-1 overflow-auto overscroll-contain rounded-md border'
            >
              <div className='mx-auto' style={{ width: `${zoom}%` }}>
                <img
                  src={props.url}
                  alt={t('Preview invoice')}
                  className='block h-auto w-full max-w-none'
                />
              </div>
            </div>
          ) : (
            <object
              title={t('Preview invoice')}
              aria-label={t('Preview invoice')}
              data={`${props.url}#toolbar=1&view=FitH`}
              type='application/pdf'
              className='h-full min-h-0 w-full flex-1 rounded-md border bg-white'
            >
              <a
                href={props.url}
                download={props.filename}
                className='text-primary underline'
              >
                {t('Download invoice')}
              </a>
            </object>
          )}
        </>
      )}
    </Dialog>
  )
}
