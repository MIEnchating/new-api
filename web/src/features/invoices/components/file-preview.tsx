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
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'

import { getInvoiceFile } from '../api'

export function InvoiceFilePreview(props: {
  requestId: number
  title: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: ['invoices', 'file', props.requestId],
    queryFn: ({ signal }) => getInvoiceFile(props.requestId, signal),
    enabled: open,
    retry: false,
    gcTime: 0,
    meta: { errorToast: false },
  })
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(
    null
  )
  useEffect(() => {
    if (!query.data) return
    const url = URL.createObjectURL(query.data.blob)
    setPreview({ blob: query.data.blob, url })
    return () => URL.revokeObjectURL(url)
  }, [query.data])
  const url = preview?.blob === query.data?.blob ? preview?.url : undefined
  return (
    <div className='bg-muted/20 min-w-0 space-y-3 rounded-lg border p-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='min-w-0 flex-1'>
          <p className='text-sm font-medium break-all'>
            {query.data?.filename || props.title}
          </p>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Invoice uploaded')}
          </p>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {t('Preview invoice')}
        </Button>
      </div>
      {open && query.isError && (
        <ErrorState
          title={t('Preview unavailable')}
          className='min-h-32'
          onRetry={() => void query.refetch()}
        />
      )}
      {open && !query.isError && !url && <LoadingState className='min-h-32' />}
      {open && url && query.data?.blob.type === 'application/pdf' && (
        <object
          title={t('Preview invoice')}
          aria-label={t('Preview invoice')}
          data={url}
          type='application/pdf'
          className='h-96 w-full rounded-md border bg-white'
        >
          <a
            href={url}
            download={query.data.filename}
            className='text-primary underline'
          >
            {t('Download invoice')}
          </a>
        </object>
      )}
      {open && url && query.data?.blob.type.startsWith('image/') && (
        <img
          src={url}
          alt={t('Preview invoice')}
          className='max-h-96 w-full rounded-md border object-contain'
        />
      )}
    </div>
  )
}
