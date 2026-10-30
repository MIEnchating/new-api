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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { uploadInvoiceFile } from '../api'
import type { InvoiceUploadResult } from '../types'
import { InvoiceFilePreview } from './file-preview'

export function InvoiceFileUpload(props: {
  requestId: number
  title: string
  uploaded: boolean
  disabled?: boolean
  onUploaded?: (result: InvoiceUploadResult) => void
  onUploadingChange?: (uploading: boolean) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [filename, setFilename] = useState('')
  const [replacing, setReplacing] = useState(false)
  const mutation = useMutation({
    mutationFn: (file: File) => uploadInvoiceFile(props.requestId, file),
    onMutate: () => props.onUploadingChange?.(true),
    onSuccess: (result, file) => {
      setFilename(file.name)
      setReplacing(false)
      void client.invalidateQueries({
        queryKey: ['invoices', 'file', props.requestId],
      })
      void client.invalidateQueries({ queryKey: ['invoices', 'requests'] })
      props.onUploaded?.(result)
      toast.success(t('Invoice uploaded'))
    },
    onSettled: () => props.onUploadingChange?.(false),
  })
  const id = `invoice-file-${props.requestId}`
  if ((props.uploaded || filename) && !replacing) {
    return (
      <div className='space-y-2'>
        <InvoiceFilePreview requestId={props.requestId} title={props.title} />
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={props.disabled || mutation.isPending}
          onClick={() => setReplacing(true)}
        >
          {t('Replace invoice file')}
        </Button>
      </div>
    )
  }
  return (
    <div className='bg-muted/20 space-y-3 rounded-lg border border-dashed p-4'>
      <Label htmlFor={id}>{t('Invoice file')}</Label>
      <Input
        id={id}
        type='file'
        className='bg-background file:bg-muted h-auto min-h-11 py-2 file:mr-3 file:rounded-md file:px-3 file:font-medium'
        accept='.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'
        disabled={props.disabled || mutation.isPending}
        aria-describedby={`${id}-help`}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          if (
            file.size === 0 ||
            file.size > 10 * 1024 * 1024 ||
            !/\.(pdf|png|jpe?g)$/i.test(file.name)
          ) {
            toast.error(
              t('Invoice file must be a PDF, PNG or JPEG up to 10 MB')
            )
            return
          }
          mutation.mutate(file)
        }}
      />
      <p
        id={`${id}-help`}
        className='text-muted-foreground text-xs break-all'
        aria-live='polite'
      >
        {mutation.isPending && t('Uploading and recognizing invoice...')}
        {!mutation.isPending &&
          (filename ||
            (props.uploaded
              ? t('Invoice uploaded')
              : t('PDF, PNG or JPEG, up to 10 MB')))}
      </p>
    </div>
  )
}
