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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import DOMPurify from 'dompurify'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  WebPreview,
  WebPreviewBody,
} from '@/components/ai-elements/web-preview'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDebounce } from '@/hooks/use-debounce'

import {
  getInvoiceEmailTemplates,
  previewInvoiceEmail,
  saveInvoiceEmailTemplates,
} from '../api'
import type { InvoiceEmailTemplates } from '../types'

const CodeBlockEditor = lazy(() =>
  import('@/components/ai-elements/code-block').then((module) => ({
    default: module.CodeBlockEditor,
  }))
)

export function InvoiceEmailTemplatesDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('Invoice email templates')}
      description={t(
        'Edit email subjects and HTML. Saved templates apply to future emails.'
      )}
      trigger={<Button variant='outline'>{t('Email templates')}</Button>}
      contentClassName='sm:max-w-6xl'
    >
      {open && <InvoiceEmailTemplatesEditor onClose={() => setOpen(false)} />}
    </Dialog>
  )
}

function InvoiceEmailTemplatesEditor(props: { onClose: () => void }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [kind, setKind] = useState<keyof InvoiceEmailTemplates>('admin')
  const [draft, setDraft] = useState<InvoiceEmailTemplates | null>(null)
  const settings = useQuery({
    queryKey: ['invoices', 'email-templates'],
    queryFn: getInvoiceEmailTemplates,
  })
  const templates = draft ?? settings.data?.templates
  const current = templates?.[kind]
  const debounced = useDebounce(current, 400)
  const preview = useQuery({
    queryKey: ['invoices', 'email-template-preview', kind, debounced],
    queryFn: ({ signal }) => {
      if (!debounced) throw new Error('Invalid invoice email template')
      return previewInvoiceEmail(kind, debounced, signal)
    },
    enabled: Boolean(debounced?.subject.trim() && debounced?.html.trim()),
    retry: false,
    gcTime: 0,
    meta: { errorToast: false },
  })
  const mutation = useMutation({
    mutationFn: saveInvoiceEmailTemplates,
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['invoices', 'email-templates'],
      })
      toast.success(t('Settings saved'))
      props.onClose()
    },
  })
  const document = useMemo(() => {
    if (!preview.data) return ''
    const html = DOMPurify.sanitize(preview.data.html, {
      WHOLE_DOCUMENT: true,
      FORBID_ATTR: ['href', 'action', 'formaction'],
      FORBID_TAGS: [
        'meta',
        'base',
        'iframe',
        'form',
        'object',
        'embed',
        'link',
      ],
    })
    // Preview cannot execute scripts, submit forms, navigate, or load remote assets.
    return (
      '<meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; style-src &apos;unsafe-inline&apos;; img-src data:; form-action &apos;none&apos;; base-uri &apos;none&apos;">' +
      html
    )
  }, [preview.data])
  const previewCurrent = current === debounced && !preview.isFetching
  if (settings.isPending) return <LoadingState />
  if (settings.isError || !templates || !settings.data) {
    return <ErrorState onRetry={() => void settings.refetch()} />
  }
  const defaults = settings.data.defaults
  return (
    <div className='space-y-4'>
      <Tabs
        value={kind}
        onValueChange={(value) => setKind(value as keyof InvoiceEmailTemplates)}
      >
        <TabsList>
          <TabsTrigger value='admin'>
            {t('Administrator notification')}
          </TabsTrigger>
          <TabsTrigger value='customer'>
            {t('Customer invoice email')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className='grid min-w-0 gap-5 lg:grid-cols-2'>
        <fieldset disabled={mutation.isPending} className='min-w-0 space-y-3'>
          <div className='space-y-2'>
            <Label htmlFor='invoice-template-subject'>
              {t('Email subject')}
            </Label>
            <Input
              id='invoice-template-subject'
              maxLength={200}
              value={templates[kind].subject}
              onChange={(event) =>
                setDraft({
                  ...templates,
                  [kind]: { ...templates[kind], subject: event.target.value },
                })
              }
            />
          </div>
          <Suspense fallback={<LoadingState />}>
            <CodeBlockEditor
              language='html'
              autoFocus={false}
              ariaLabel={t('HTML source')}
              title={t('HTML source')}
              value={templates[kind].html}
              onChange={(html) => {
                if (!mutation.isPending) {
                  setDraft({
                    ...templates,
                    [kind]: { ...templates[kind], html },
                  })
                }
              }}
              rows={17}
              className='my-0 max-h-[420px] overflow-auto'
            />
          </Suspense>
          <p className='text-muted-foreground text-xs leading-relaxed'>
            {t(
              'Template variables are replaced with application details when sending.'
            )}
          </p>
          <div className='text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs'>
            {[
              'SystemName',
              'Title',
              'Amount',
              'Email',
              'InvoiceNumber',
              'Applicant',
              'URL',
            ].map((name) => (
              <code key={name}>{'{{.' + name + '}}'}</code>
            ))}
          </div>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setDraft({ ...templates, [kind]: defaults[kind] })}
          >
            {t('Restore default template')}
          </Button>
        </fieldset>
        <section aria-label={t('Email preview')} className='min-w-0 space-y-2'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <span className='text-sm font-medium'>{t('Email preview')}</span>
            <span className='text-muted-foreground text-xs'>
              {t('Sample data only. No email will be sent.')}
            </span>
          </div>
          {(!current?.subject.trim() || !current?.html.trim()) && (
            <p role='alert' className='text-destructive text-sm'>
              {t('Email subject and HTML are required.')}
            </p>
          )}
          {preview.isError && previewCurrent && (
            <p role='alert' className='text-destructive text-sm'>
              {t('Invalid invoice email template')}
            </p>
          )}
          {!previewCurrent && <LoadingState />}
          {preview.data && previewCurrent && (
            <>
              <p className='bg-muted/40 rounded-md border px-3 py-2 text-sm break-words'>
                {preview.data.subject}
              </p>
              <WebPreview className='h-[520px] overflow-hidden bg-white'>
                <WebPreviewBody
                  srcDoc={document}
                  sandbox=''
                  referrerPolicy='no-referrer'
                  title={t('Email preview')}
                />
              </WebPreview>
            </>
          )}
        </section>
      </div>
      <div className='flex justify-end gap-2 border-t pt-4'>
        <Button
          variant='outline'
          disabled={mutation.isPending}
          onClick={props.onClose}
        >
          {t('Cancel')}
        </Button>
        <Button
          disabled={
            mutation.isPending ||
            !current?.subject.trim() ||
            !current?.html.trim() ||
            !previewCurrent ||
            !preview.data ||
            preview.isError
          }
          onClick={() => mutation.mutate(templates)}
        >
          {t('Save')}
        </Button>
      </div>
    </div>
  )
}
