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
import DOMPurify from 'dompurify'
import { Image, Plus, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createCustomMenuPageId,
  parseCustomMenuPages,
  type CustomMenuPage,
  type CustomMenuPageSection,
  type CustomMenuPageVisibility,
} from '@/lib/custom-menu-pages'

import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const MAX_MENU_PAGES = 20
const MAX_ICON_FILE_SIZE = 20 * 1024

function encodeSvg(svg: string) {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

async function sanitizeSvgFile(file: File) {
  if (file.size > MAX_ICON_FILE_SIZE) {
    throw new Error('SVG icon must not exceed 20 KB')
  }
  const raw = await file.text()
  const sanitized = DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject'],
  })
  const document = new DOMParser().parseFromString(sanitized, 'image/svg+xml')
  if (document.documentElement.tagName.toLowerCase() !== 'svg') {
    throw new Error('Please upload a valid SVG icon')
  }
  return encodeSvg(sanitized)
}

function validatePages(pages: CustomMenuPage[]) {
  for (const page of pages) {
    if (!page.name.trim()) return 'Menu name is required'
    try {
      const url = new URL(page.url)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return 'Page URL must use HTTP or HTTPS'
      }
    } catch {
      return 'Please enter a valid page URL'
    }
  }
  return null
}

type CustomMenuPagesSectionProps = {
  value: string
}

export function CustomMenuPagesSection(props: CustomMenuPagesSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const initialPages = useMemo(
    () => parseCustomMenuPages(props.value),
    [props.value]
  )
  const [pages, setPages] = useState(initialPages)

  useEffect(() => {
    setPages(initialPages)
  }, [initialPages])

  const updatePage = (id: string, patch: Partial<CustomMenuPage>) => {
    setPages((current) =>
      current.map((page) => (page.id === id ? { ...page, ...patch } : page))
    )
  }

  const addPage = () => {
    if (pages.length >= MAX_MENU_PAGES) {
      toast.error(t('Custom menu pages support up to 20 items'))
      return
    }
    setPages((current) => [
      ...current,
      {
        id: createCustomMenuPageId(),
        name: '',
        url: '',
        visibility: 'public',
        section: 'general',
      },
    ])
  }

  const save = async () => {
    const validationError = validatePages(pages)
    if (validationError) {
      toast.error(t(validationError))
      return
    }
    await updateOption.mutateAsync({
      key: 'CustomMenuPages',
      value: JSON.stringify(
        pages.map((page) => ({
          ...page,
          name: page.name.trim(),
          url: page.url.trim(),
        }))
      ),
    })
  }

  return (
    <SettingsSection title={t('Custom menu pages')}>
      <SettingsPageFormActions
        onSave={save}
        onReset={() => setPages(initialPages)}
        isSaving={updateOption.isPending}
        saveLabel='Save custom menu pages'
      />
      <div className='space-y-4'>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Add iframe pages to the sidebar. Choose who can see each page and where it appears in the sidebar.'
          )}
        </p>
        <div className='grid gap-4 xl:grid-cols-2'>
          {pages.map((page, index) => (
            <MenuPageEditor
              key={page.id}
              page={page}
              index={index}
              onChange={(patch) => updatePage(page.id, patch)}
              onRemove={() =>
                setPages((current) =>
                  current.filter((entry) => entry.id !== page.id)
                )
              }
            />
          ))}
        </div>
        <Button
          type='button'
          variant='outline'
          className='border-dashed'
          onClick={addPage}
          disabled={pages.length >= MAX_MENU_PAGES}
        >
          <Plus data-icon='inline-start' />
          {t('Add menu item')}
        </Button>
      </div>
    </SettingsSection>
  )
}

function MenuPageEditor(props: {
  page: CustomMenuPage
  index: number
  onChange: (patch: Partial<CustomMenuPage>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  const uploadIcon = async (file?: File) => {
    if (!file) return
    try {
      props.onChange({ icon: await sanitizeSvgFile(file) })
    } catch (error) {
      toast.error(
        t(error instanceof Error ? error.message : 'Failed to read SVG icon')
      )
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <section className='bg-muted/15 min-w-0 space-y-4 rounded-lg border p-4'>
      <div className='flex items-center justify-between gap-3'>
        <h3 className='text-sm font-medium'>
          {t('Menu item #{{index}}', { index: props.index + 1 })}
        </h3>
        <Button
          type='button'
          size='icon-sm'
          variant='ghost'
          className='text-destructive hover:text-destructive'
          aria-label={t('Delete menu item')}
          title={t('Delete menu item')}
          onClick={props.onRemove}
        >
          <Trash2 />
        </Button>
      </div>

      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label htmlFor={`${props.page.id}-name`}>{t('Menu name')}</Label>
          <Input
            id={`${props.page.id}-name`}
            value={props.page.name}
            maxLength={40}
            placeholder={t('For example: Help Center')}
            onChange={(event) => props.onChange({ name: event.target.value })}
          />
        </div>
        <div className='space-y-2'>
          <Label>{t('Visible role')}</Label>
          <Select
            value={props.page.visibility}
            onValueChange={(value) =>
              props.onChange({
                visibility: value as CustomMenuPageVisibility,
              })
            }
          >
            <SelectTrigger className='w-full'>
              <SelectValue>
                {props.page.visibility === 'admin'
                  ? t('Administrators')
                  : t('Users')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align='start' alignItemWithTrigger={false}>
              <SelectItem value='public'>{t('Users')}</SelectItem>
              <SelectItem value='admin'>{t('Administrators')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {props.page.visibility === 'public' ? (
        <div className='space-y-2'>
          <Label>{t('Menu location')}</Label>
          <Select
            value={props.page.section ?? 'general'}
            onValueChange={(value) =>
              props.onChange({ section: value as CustomMenuPageSection })
            }
          >
            <SelectTrigger className='w-full'>
              <SelectValue>
                {t(
                  props.page.section === 'chat'
                    ? 'Chat'
                    : props.page.section === 'personal'
                      ? 'Personal'
                      : 'General'
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align='start' alignItemWithTrigger={false}>
              <SelectItem value='chat'>{t('Chat')}</SelectItem>
              <SelectItem value='general'>{t('General')}</SelectItem>
              <SelectItem value='personal'>{t('Personal')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className='space-y-2'>
        <Label htmlFor={`${props.page.id}-url`}>{t('Page URL')}</Label>
        <Input
          id={`${props.page.id}-url`}
          type='url'
          value={props.page.url}
          placeholder='https://example.com/page'
          onChange={(event) => props.onChange({ url: event.target.value })}
        />
      </div>

      <div className='space-y-2'>
        <Label>{t('SVG icon')}</Label>
        <div className='flex flex-wrap items-center gap-3'>
          <div className='bg-background flex size-11 items-center justify-center rounded-md border border-dashed'>
            {props.page.icon ? (
              <img src={props.page.icon} alt='' className='size-5' />
            ) : (
              <Image className='text-muted-foreground size-5' />
            )}
          </div>
          <input
            ref={inputRef}
            type='file'
            accept='image/svg+xml,.svg'
            className='sr-only'
            onChange={(event) => uploadIcon(event.target.files?.[0])}
          />
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => inputRef.current?.click()}
          >
            <Upload data-icon='inline-start' />
            {t('Upload SVG')}
          </Button>
          {props.page.icon ? (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => props.onChange({ icon: undefined })}
            >
              {t('Remove icon')}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
