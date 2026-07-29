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
import { Link } from '@tanstack/react-router'
import { ArrowRight, ArrowRightLeft, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchTokenKey, getApiKeys } from '@/features/keys/api'
import { CCSwitchDialog } from '@/features/keys/components/dialogs/cc-switch-dialog'
import type { ApiKey } from '@/features/keys/types'

const API_KEY_PAGE_SIZE = 100

async function getAllApiKeys(): Promise<ApiKey[]> {
  const firstPage = await getApiKeys({ p: 1, size: API_KEY_PAGE_SIZE })
  if (!firstPage.success || !firstPage.data) {
    throw new Error(firstPage.message || 'Failed to load API keys')
  }

  const items = [...firstPage.data.items]
  const totalPages = Math.ceil(firstPage.data.total / API_KEY_PAGE_SIZE)
  for (let page = 2; page <= totalPages; page += 1) {
    const response = await getApiKeys({ p: page, size: API_KEY_PAGE_SIZE })
    if (!response.success || !response.data) {
      throw new Error(response.message || 'Failed to load API keys')
    }
    items.push(...response.data.items)
  }
  return items
}

export function CCSwitchImport(props: { compact?: boolean }) {
  const { t } = useTranslation()
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null)
  const [resolvedKey, setResolvedKey] = useState('')
  const [resolvingKey, setResolvingKey] = useState(false)

  const keysQuery = useQuery({
    queryKey: ['dashboard', 'cc-switch-api-keys'],
    queryFn: getAllApiKeys,
    enabled: keyDialogOpen,
    staleTime: 30_000,
  })

  const enabledKeys = (keysQuery.data ?? []).filter((key) => key.status === 1)
  const selectedKey =
    enabledKeys.find((key) => key.id === selectedKeyId) ?? enabledKeys[0]

  const handleContinue = async () => {
    if (!selectedKey) return
    setResolvingKey(true)
    try {
      const response = await fetchTokenKey(selectedKey.id)
      if (!response.success || !response.data?.key) {
        toast.error(response.message || t('Failed to load API key'))
        return
      }
      setSelectedKeyId(selectedKey.id)
      setResolvedKey(
        response.data.key.startsWith('sk-')
          ? response.data.key
          : `sk-${response.data.key}`
      )
      setKeyDialogOpen(false)
      window.requestAnimationFrame(() => setImportDialogOpen(true))
    } catch {
      toast.error(t('Failed to load API key'))
    } finally {
      setResolvingKey(false)
    }
  }

  return (
    <>
      {props.compact ? (
        <Button
          variant='outline'
          size='sm'
          className='bg-background/70 border-info/30 hover:border-info/50 hover:bg-info/5 h-8 min-w-30 gap-1.5 px-2.5'
          onClick={() => setKeyDialogOpen(true)}
        >
          <ArrowRightLeft className='text-info' data-icon='inline-start' />
          <span>{t('Import to CC Switch')}</span>
        </Button>
      ) : (
        <Button
          variant='outline'
          className='border-info/35 bg-info/5 hover:border-info/55 hover:bg-info/10 h-auto justify-start rounded-xl px-3 py-3 text-left shadow-xs'
          onClick={() => setKeyDialogOpen(true)}
        >
          <span className='bg-info/12 text-info border-info/20 flex size-10 shrink-0 items-center justify-center rounded-lg border'>
            <ArrowRightLeft className='size-4.5' aria-hidden='true' />
          </span>
          <span className='flex min-w-0 flex-1 flex-col gap-1'>
            <span className='flex min-w-0 items-center gap-2'>
              <span className='truncate text-sm font-semibold'>
                {t('Import to CC Switch')}
              </span>
              <span className='bg-info/10 text-info shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium'>
                {t('Recommended')}
              </span>
            </span>
            <span className='text-muted-foreground line-clamp-2 text-xs leading-relaxed'>
              {t('Select an API key to continue with one-click import.')}
            </span>
          </span>
          <ArrowRight
            className='text-info size-4 shrink-0'
            aria-hidden='true'
          />
        </Button>
      )}

      <Dialog
        open={keyDialogOpen}
        onOpenChange={setKeyDialogOpen}
        title={t('Import to CC Switch')}
        description={t('Select an API key to continue with one-click import.')}
        contentClassName='sm:max-w-md'
        contentHeight='auto'
        footer={
          keysQuery.isPending ||
          keysQuery.isError ? null : enabledKeys.length === 0 ? (
            <>
              <Button variant='outline' onClick={() => setKeyDialogOpen(false)}>
                {t('Cancel')}
              </Button>
              <Button render={<Link to='/keys' />}>
                <KeyRound className='size-4' />
                {t('Create API Key')}
              </Button>
            </>
          ) : (
            <>
              <Button variant='outline' onClick={() => setKeyDialogOpen(false)}>
                {t('Cancel')}
              </Button>
              <Button disabled={resolvingKey} onClick={handleContinue}>
                {resolvingKey ? t('Loading...') : t('Continue')}
              </Button>
            </>
          )
        }
      >
        {keysQuery.isPending ? (
          <div className='space-y-2 py-1'>
            <Skeleton className='h-4 w-24' />
            <Skeleton className='h-10 w-full' />
          </div>
        ) : keysQuery.isError ? (
          <div className='border-destructive/30 bg-destructive/5 rounded-md border p-4'>
            <p className='text-destructive text-sm'>
              {t('Failed to load API keys')}
            </p>
            <Button
              variant='outline'
              size='sm'
              className='mt-3'
              onClick={() => keysQuery.refetch()}
            >
              {t('Retry')}
            </Button>
          </div>
        ) : enabledKeys.length === 0 ? (
          <div className='border-border/70 bg-muted/20 flex flex-col items-center rounded-md border px-5 py-7 text-center'>
            <span className='bg-background flex size-10 items-center justify-center rounded-md border shadow-xs'>
              <KeyRound className='text-muted-foreground size-5' />
            </span>
            <p className='mt-3 text-sm font-medium'>
              {t('No enabled API keys')}
            </p>
            <p className='text-muted-foreground mt-1 max-w-xs text-xs leading-5'>
              {t('Create an enabled API key before importing it to CC Switch.')}
            </p>
          </div>
        ) : (
          <div className='space-y-2 py-1'>
            <Label htmlFor='overview-cc-switch-api-key'>{t('API Key')}</Label>
            <Select
              items={enabledKeys.map((key) => ({
                value: String(key.id),
                label: `${key.name} (#${key.id})`,
              }))}
              value={selectedKey ? String(selectedKey.id) : null}
              onValueChange={(value) =>
                value !== null && setSelectedKeyId(Number(value))
              }
            >
              <SelectTrigger
                id='overview-cc-switch-api-key'
                className='h-10 w-full'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {enabledKeys.map((key) => (
                    <SelectItem key={key.id} value={String(key.id)}>
                      <span className='max-w-72 truncate'>{key.name}</span>
                      <span className='text-muted-foreground'>#{key.id}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
      </Dialog>

      <CCSwitchDialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          setImportDialogOpen(open)
          if (!open) setResolvedKey('')
        }}
        tokenId={selectedKey?.id ?? 0}
        tokenKey={resolvedKey}
      />
    </>
  )
}
