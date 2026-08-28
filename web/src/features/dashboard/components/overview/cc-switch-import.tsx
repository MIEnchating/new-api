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
import {
  ArrowRight,
  ArrowRightLeft,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Search,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { fetchTokenKey, getApiKeys, searchApiKeys } from '@/features/keys/api'
import { ApiKeyImportButton } from '@/features/keys/components/api-key-import-button'
import { CCSwitchDialog } from '@/features/keys/components/dialogs/cc-switch-dialog'
import { API_KEY_STATUS, API_KEY_STATUSES } from '@/features/keys/constants'
import type { ApiKey } from '@/features/keys/types'
import { useDebounce } from '@/hooks/use-debounce'
import { copyToClipboard } from '@/lib/copy-to-clipboard'

const API_KEY_PAGE_SIZE = 8

export function CCSwitchImport(props: { compact?: boolean }) {
  const { t } = useTranslation()
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null)
  const [resolvedKey, setResolvedKey] = useState('')
  const [activeKeyAction, setActiveKeyAction] = useState<{
    id: number
    type: 'copy' | 'import'
  } | null>(null)
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null)
  const resolvedKeysRef = useRef<Record<number, string>>({})
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const search = useDebounce(searchInput, 250).trim()

  useEffect(() => () => clearTimeout(copiedTimerRef.current), [])

  const keysQuery = useQuery({
    queryKey: ['dashboard', 'cc-switch-api-keys', page, search],
    queryFn: async () => {
      const response = search
        ? await searchApiKeys({
            keyword: search,
            p: page,
            size: API_KEY_PAGE_SIZE,
          })
        : await getApiKeys({ p: page, size: API_KEY_PAGE_SIZE })

      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to load API keys')
      }
      return response.data
    },
    enabled: keyDialogOpen,
    staleTime: 30_000,
  })

  const apiKeys = keysQuery.data?.items ?? []
  const total = keysQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / API_KEY_PAGE_SIZE))
  const resolveKey = async (apiKey: ApiKey): Promise<string | null> => {
    const cached = resolvedKeysRef.current[apiKey.id]
    if (cached) return cached

    try {
      const response = await fetchTokenKey(apiKey.id)
      if (!response.success || !response.data?.key) {
        toast.error(response.message || t('Failed to load API key'))
        return null
      }

      const fullKey = response.data.key.startsWith('sk-')
        ? response.data.key
        : `sk-${response.data.key}`
      resolvedKeysRef.current[apiKey.id] = fullKey
      return fullKey
    } catch {
      toast.error(t('Failed to load API key'))
      return null
    }
  }

  const handleImport = async (apiKey: ApiKey) => {
    if (apiKey.status !== API_KEY_STATUS.ENABLED) return

    setActiveKeyAction({ id: apiKey.id, type: 'import' })
    try {
      const fullKey = await resolveKey(apiKey)
      if (!fullKey) return

      setSelectedKeyId(apiKey.id)
      setResolvedKey(fullKey)
      setKeyDialogOpen(false)
      window.requestAnimationFrame(() => setImportDialogOpen(true))
    } finally {
      setActiveKeyAction(null)
    }
  }

  const handleCopy = async (apiKey: ApiKey) => {
    setActiveKeyAction({ id: apiKey.id, type: 'copy' })
    try {
      const fullKey = await resolveKey(apiKey)
      if (!fullKey) return

      const copied = await copyToClipboard(fullKey)
      if (!copied) return

      setCopiedKeyId(apiKey.id)
      clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setCopiedKeyId(null), 2000)
    } finally {
      setActiveKeyAction(null)
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
        onOpenChange={(open) => {
          setKeyDialogOpen(open)
          if (!open) {
            setPage(1)
            setSearchInput('')
          }
        }}
        title={t('Import to CC Switch')}
        description={t('Select an API key to continue with one-click import.')}
        contentClassName='sm:max-w-4xl'
        contentHeight='auto'
        footer={
          keysQuery.isPending || keysQuery.isError ? null : total === 0 &&
            !search ? (
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
            <Button variant='outline' onClick={() => setKeyDialogOpen(false)}>
              {t('Cancel')}
            </Button>
          )
        }
      >
        <div className='space-y-3'>
          <div className='relative'>
            <Search
              className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2'
              aria-hidden='true'
            />
            <Input
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value)
                setPage(1)
              }}
              placeholder={t('Search')}
              aria-label={t('Search')}
              className='pl-8'
            />
          </div>

          {keysQuery.isPending ? (
            <div className='space-y-2 py-1'>
              <Skeleton className='h-16 w-full rounded-lg' />
              <Skeleton className='h-16 w-full rounded-lg' />
              <Skeleton className='h-16 w-full rounded-lg' />
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
          ) : apiKeys.length === 0 ? (
            <div className='border-border/70 bg-muted/20 flex flex-col items-center rounded-md border px-5 py-7 text-center'>
              <span className='bg-background flex size-10 items-center justify-center rounded-md border shadow-xs'>
                <KeyRound className='text-muted-foreground size-5' />
              </span>
              <p className='mt-3 text-sm font-medium'>
                {search ? t('No results found') : t('No enabled API keys')}
              </p>
              {!search && (
                <p className='text-muted-foreground mt-1 max-w-xs text-xs leading-5'>
                  {t(
                    'Create an enabled API key before importing it to CC Switch.'
                  )}
                </p>
              )}
            </div>
          ) : (
            <div className='border-border/80 overflow-hidden rounded-lg border'>
              <div className='bg-muted/35 text-muted-foreground hidden grid-cols-[minmax(8rem,0.8fr)_7rem_minmax(20rem,1.6fr)] items-center gap-4 border-b px-4 py-2.5 text-xs font-medium sm:grid'>
                <span>{t('Name')}</span>
                <span>{t('Status')}</span>
                <span>{t('API Key')}</span>
              </div>
              <div className='divide-border max-h-[min(56vh,28rem)] divide-y overflow-y-auto'>
                {apiKeys.map((apiKey) => {
                  const statusConfig = API_KEY_STATUSES[apiKey.status]
                  const isEnabled = apiKey.status === API_KEY_STATUS.ENABLED
                  const isCopying =
                    activeKeyAction?.id === apiKey.id &&
                    activeKeyAction.type === 'copy'
                  const isImporting =
                    activeKeyAction?.id === apiKey.id &&
                    activeKeyAction.type === 'import'
                  const maskedKey = apiKey.key.startsWith('sk-')
                    ? apiKey.key
                    : `sk-${apiKey.key}`

                  return (
                    <div
                      key={apiKey.id}
                      className='grid gap-2.5 px-3 py-3 sm:grid-cols-[minmax(8rem,0.8fr)_7rem_minmax(20rem,1.6fr)] sm:items-center sm:gap-4 sm:px-4'
                    >
                      <div className='flex min-w-0 items-center justify-between gap-3 sm:block'>
                        <span className='truncate text-sm font-medium'>
                          {apiKey.name}
                        </span>
                        {statusConfig && (
                          <StatusBadge
                            label={t(statusConfig.label)}
                            variant={statusConfig.variant}
                            type='text'
                            copyable={false}
                            className='sm:hidden'
                          />
                        )}
                      </div>
                      <div className='hidden sm:block'>
                        {statusConfig && (
                          <StatusBadge
                            label={t(statusConfig.label)}
                            variant={statusConfig.variant}
                            type='text'
                            copyable={false}
                          />
                        )}
                      </div>
                      <div className='flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap'>
                        <div className='flex max-w-52 min-w-0 items-center gap-0.5'>
                          <code className='text-muted-foreground max-w-44 min-w-0 truncate text-xs font-medium'>
                            {maskedKey}
                          </code>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  type='button'
                                  variant='ghost'
                                  size='icon-sm'
                                  className='shrink-0'
                                  onClick={() => handleCopy(apiKey)}
                                  disabled={isCopying}
                                  aria-label={t('Copy API key')}
                                />
                              }
                            >
                              {isCopying ? (
                                <Loader2 className='animate-spin' />
                              ) : copiedKeyId === apiKey.id ? (
                                <Check className='text-success' />
                              ) : (
                                <Copy />
                              )}
                            </TooltipTrigger>
                            <TooltipContent>
                              {copiedKeyId === apiKey.id
                                ? t('Copied!')
                                : t('Copy API key')}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <ApiKeyImportButton
                          loading={isImporting}
                          disabled={!isEnabled}
                          onClick={() => handleImport(apiKey)}
                          aria-label={`${t('Import to CC Switch')}: ${apiKey.name}`}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!keysQuery.isPending && !keysQuery.isError && total > 0 && (
            <div className='flex items-center justify-between gap-3'>
              <span className='text-muted-foreground text-sm'>
                {t('Page {{current}} of {{total}}', {
                  current: page,
                  total: totalPages,
                })}
              </span>
              <div className='flex gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1 || keysQuery.isFetching}
                >
                  {t('Previous page')}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                  disabled={page >= totalPages || keysQuery.isFetching}
                >
                  {t('Next page')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Dialog>

      <CCSwitchDialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          setImportDialogOpen(open)
          if (!open) setResolvedKey('')
        }}
        tokenId={selectedKeyId ?? 0}
        tokenKey={resolvedKey}
      />
    </>
  )
}
