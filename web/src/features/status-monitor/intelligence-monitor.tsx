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
import { AlertTriangle, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import {
  getIntelligenceResults,
  intelligenceResultsQueryKey,
} from './intelligence-api'
import { getIntelligenceQuestionName } from './intelligence-labels'
import { IntelligenceResultCard } from './intelligence-result-card'
import { buildIntelligenceCards } from './intelligence-results'
import { RefreshControl } from './refresh-control'

export function IntelligenceMonitor() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [activeGroupKey, setActiveGroupKey] = useState('all')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const searchInput = useRef<HTMLInputElement>(null)
  const groupTabs = useRef<HTMLDivElement>(null)
  const resultsViewport = useRef<HTMLDivElement>(null)
  const focusGroup = useRef(false)
  const query = useQuery({
    queryKey: intelligenceResultsQueryKey,
    queryFn: getIntelligenceResults,
    refetchInterval: (query) =>
      query.state.data?.history.some(
        (task) => task.status === 'pending' || task.status === 'running'
      )
        ? 3000
        : 30000,
    meta: { errorToast: false },
  })
  const { cards, groupCounts } = useMemo(
    () => buildIntelligenceCards(query.data?.history ?? []),
    [query.data?.history]
  )
  const groupOptions = useMemo(
    () =>
      [...groupCounts].map(([group, count]) => ({
        key: JSON.stringify(group),
        label: group || t('Ungrouped'),
        count,
      })),
    [groupCounts, t]
  )
  const selectedGroupKey = groupOptions.some(
    (group) => group.key === activeGroupKey
  )
    ? activeGroupKey
    : 'all'
  const filteredCards = useMemo(() => {
    const text = search.trim().toLowerCase()
    return cards.filter((card) => {
      if (
        selectedGroupKey !== 'all' &&
        JSON.stringify(card.group) !== selectedGroupKey
      ) {
        return false
      }
      if (status !== 'all' && card.status !== status) return false
      if (!text) return true
      const question = card.channel
        ? getIntelligenceQuestionName(card.channel.question_name, t)
        : ''
      return `${card.model} ${card.group || t('Ungrouped')} ${question}`
        .toLowerCase()
        .includes(text)
    })
  }, [cards, selectedGroupKey, search, status, t])
  const handleGroupSelect = useCallback((group: string) => {
    focusGroup.current = true
    setActiveGroupKey(JSON.stringify(group))
  }, [])
  useEffect(() => {
    const selected = groupTabs.current?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]'
    )
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (focusGroup.current) {
      selected?.focus({ preventScroll: true })
      focusGroup.current = false
    }
  }, [selectedGroupKey])
  useEffect(() => {
    if (resultsViewport.current) resultsViewport.current.scrollTop = 0
  }, [selectedGroupKey, search, status])

  if (query.isPending) return <LoadingState />
  if (!query.data) return <ErrorState onRetry={() => void query.refetch()} />
  const statusOptions = [
    { value: 'all', label: t('All statuses') },
    { value: 'running', label: t('Running') },
    { value: 'pending', label: t('Pending') },
    { value: 'succeeded', label: t('Completed') },
    { value: 'failed', label: t('Failed') },
  ]
  const hasFilters =
    search !== '' || status !== 'all' || selectedGroupKey !== 'all'

  return (
    <section
      aria-label={t('Intelligence test history')}
      className='flex h-full min-h-0 min-w-0 flex-col'
    >
      <Tabs
        value={selectedGroupKey}
        onValueChange={(value) => {
          setActiveGroupKey(value || 'all')
        }}
        className='min-h-0 min-w-0 flex-1 gap-3'
      >
        <div className='flex shrink-0 flex-col gap-3 border-b pb-3'>
          <div className='flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center'>
            {groupOptions.length > 0 && (
              <TabsList
                ref={groupTabs}
                aria-label={t('Group')}
                className='w-full max-w-full min-w-0 shrink-0 [scrollbar-width:none] flex-nowrap justify-start gap-1.5 overflow-x-auto bg-transparent p-1 group-data-horizontal/tabs:h-auto lg:w-auto lg:flex-1 [&::-webkit-scrollbar]:hidden'
              >
                {[
                  { key: 'all', label: t('All'), count: cards.length },
                  ...groupOptions,
                ].map((group) => (
                  <TabsTrigger
                    key={group.key}
                    value={group.key}
                    aria-label={group.label}
                    className='group/group-tab hover:bg-muted/60 data-active:border-primary/20 data-active:bg-primary/10 data-active:text-primary h-9 flex-none gap-2 rounded-lg px-3 py-1.5 group-data-[variant=default]/tabs-list:data-active:shadow-none'
                  >
                    <span
                      className='max-w-32 truncate sm:max-w-48'
                      title={group.label}
                    >
                      {group.label}
                    </span>
                    <Badge
                      aria-hidden='true'
                      variant='secondary'
                      className='h-5 min-w-5 px-1 text-[10px] tabular-nums'
                    >
                      {formatNumber(group.count, locale)}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            )}
            <div className='shrink-0 lg:ml-auto'>
              <RefreshControl
                loading={false}
                refreshing={query.isFetching}
                lastUpdated={new Date(query.dataUpdatedAt)}
                onRefresh={() => void query.refetch()}
                autoRefresh={false}
              />
            </div>
          </div>
          {cards.length > 0 && (
            <div className='flex flex-wrap items-center gap-2'>
              <InputGroup className='w-full sm:w-80'>
                <InputGroupAddon>
                  <Search aria-hidden='true' />
                </InputGroupAddon>
                <InputGroupInput
                  ref={searchInput}
                  type='search'
                  aria-label={t('Search test results')}
                  placeholder={t('Search models, groups or questions')}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setSearch('')
                    }
                  }}
                />
                {search !== '' && (
                  <InputGroupAddon align='inline-end'>
                    <InputGroupButton
                      size='icon-xs'
                      aria-label={t('Clear search')}
                      onClick={() => {
                        setSearch('')
                        searchInput.current?.focus()
                      }}
                    >
                      <X aria-hidden='true' />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
              <Select
                items={statusOptions}
                value={status}
                onValueChange={(value) => {
                  setStatus(value || 'all')
                }}
              >
                <SelectTrigger aria-label={t('Status')} className='w-36'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span
                role='status'
                className='text-muted-foreground ml-auto text-xs tabular-nums'
              >
                {t('Total:')} {formatNumber(filteredCards.length, locale)}
              </span>
            </div>
          )}
          {query.isError && (
            <Alert variant='destructive'>
              <AlertTriangle aria-hidden='true' />
              <AlertDescription>
                {t('Refresh failed. Showing the last available data.')}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <TabsContent
          ref={resultsViewport}
          value={selectedGroupKey}
          className='min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-2'
        >
          {filteredCards.length === 0 && (
            <EmptyState
              title={
                cards.length === 0
                  ? t('No intelligence test results yet')
                  : t('No matching results')
              }
              bordered
              action={
                hasFilters ? (
                  <Button
                    variant='outline'
                    onClick={() => {
                      setSearch('')
                      setStatus('all')
                      setActiveGroupKey('all')
                      searchInput.current?.focus()
                    }}
                  >
                    {t('Clear filters')}
                  </Button>
                ) : undefined
              }
            />
          )}
          <div className='grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] items-start gap-3 sm:gap-4'>
            {filteredCards.map((card) => (
              <IntelligenceResultCard
                key={card.id}
                {...card}
                showGroup={selectedGroupKey === 'all'}
                onGroupSelect={handleGroupSelect}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}
