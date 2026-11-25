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
import { ArrowLeft, Check, ChevronRight, History, Minus, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Accordion } from '@/components/ui/accordion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { DetectionHistoryRecord } from './history-storage'
import { ModelDetectionResults } from './results'
import { DetectionSamples } from './samples'
import { TokenizerProbeResult } from './tokenizer-result'

const historyColumns =
  'grid-cols-[minmax(0,1fr)_auto_1rem] @lg/history:grid-cols-[minmax(0,1fr)_9rem_6.25rem_1rem]'

export function DetectionHistory(props: { records: DetectionHistoryRecord[] }) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const returningTo = useRef<string | null>(null)
  const focusBackButton = useCallback((button: HTMLButtonElement | null) => {
    button?.focus()
  }, [])
  const statuses = {
    success: {
      label: t('Completed'),
      variant: 'success',
      icon: Check,
      className: 'bg-success/10',
    },
    error: {
      label: t('Failed'),
      variant: 'danger',
      icon: X,
      className: 'bg-destructive/10',
    },
    cancelled: {
      label: t('Cancelled'),
      variant: 'neutral',
      icon: Minus,
      className: 'bg-muted',
    },
  } as const
  const selected = props.records.find((record) => record.id === selectedId)
  const result =
    selected?.outcome.status === 'success' ? selected.outcome.result : undefined
  const round = result?.rounds?.[0]
  const tokenizer =
    selected && result?.tokenizer ? (
      <TokenizerProbeResult
        report={result.tokenizer}
        selectedModel={selected.target.model}
      />
    ) : undefined

  return (
    <Dialog
      title={
        <span className='flex items-center gap-2.5'>
          <IconBadge tone='primary' size='sm'>
            <History aria-hidden='true' />
          </IconBadge>
          {t('Detection history')}
        </span>
      }
      onOpenChange={(open) => {
        if (!open) {
          returningTo.current = null
          setSelectedId(null)
        }
      }}
      trigger={
        <Button type='button' variant='outline'>
          <History data-icon='inline-start' aria-hidden='true' />
          {t('Detection history')}
        </Button>
      }
      contentClassName='gap-3 overflow-hidden sm:max-w-[46rem]'
      headerClassName='pe-8'
      titleClassName='font-semibold'
      bodyClassName='@container/history'
    >
      {selected ? (
        <div className='space-y-3'>
          <div className='bg-popover sticky top-0 z-10'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              ref={focusBackButton}
              onClick={() => {
                returningTo.current = selected.id
                setSelectedId(null)
              }}
            >
              <ArrowLeft
                data-icon='inline-start'
                aria-hidden='true'
                className='rtl:rotate-180'
              />
              {t('Back to history')}
            </Button>
          </div>
          <Card size='sm' className='bg-muted/30'>
            <CardContent className='space-y-1.5'>
              <div className='flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5'>
                <h3 className='min-w-0 text-base leading-snug font-semibold [overflow-wrap:anywhere]'>
                  {selected.target.model}
                </h3>
                <StatusBadge
                  {...statuses[selected.outcome.status]}
                  copyable={false}
                />
              </div>
              <div className='text-muted-foreground flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs'>
                <span className='min-w-0 [overflow-wrap:anywhere]'>
                  {selected.target.group} ·{' '}
                  <span className='font-mono'>{selected.target.endpoint}</span>
                </span>
                <span className='tabular-nums'>
                  {formatTimestampToDate(selected.finishedAt, 'milliseconds')}
                </span>
              </div>
              {selected.target.api_url && (
                <p className='text-muted-foreground text-xs [overflow-wrap:anywhere]'>
                  {selected.target.api_url}
                </p>
              )}
            </CardContent>
          </Card>
          {round ? (
            <DetectionSamples
              challenges={round.challenges}
              samples={round.samples}
              tokenizer={tokenizer}
            />
          ) : (
            tokenizer && <Accordion>{tokenizer}</Accordion>
          )}
          {result && <ModelDetectionResults result={result} />}
          {selected.outcome.status === 'error' && (
            <Alert variant='destructive'>
              <AlertDescription className='[overflow-wrap:anywhere]'>
                {selected.outcome.message}
              </AlertDescription>
            </Alert>
          )}
          {selected.outcome.status === 'cancelled' && (
            <p className='text-muted-foreground text-sm'>
              {t('Detection cancelled.')}
            </p>
          )}
        </div>
      ) : props.records.length > 0 ? (
        <div className='border-border overflow-hidden rounded-lg border'>
          <div
            aria-hidden='true'
            className={cn(
              'bg-muted/45 text-muted-foreground hidden gap-x-3 border-b px-3 py-2 text-xs font-medium @lg/history:grid',
              historyColumns
            )}
          >
            <span>{t('Model')}</span>
            <span>{t('Time')}</span>
            <span>{t('Status')}</span>
          </div>
          <ul
            role='list'
            aria-label={t('Detection history')}
            className='divide-y'
          >
            {props.records.map((record) => (
              <li key={record.id}>
                <Button
                  type='button'
                  variant='ghost'
                  ref={(button) => {
                    if (button && returningTo.current === record.id) {
                      returningTo.current = null
                      button.focus()
                    }
                  }}
                  onClick={() => setSelectedId(record.id)}
                  className={cn(
                    'grid h-auto min-h-12 w-full items-center gap-x-3 rounded-none px-3 py-2 text-start whitespace-normal focus-visible:ring-inset',
                    historyColumns
                  )}
                >
                  <span className='sr-only'>{t('View result')}</span>
                  <span className='grid min-w-0 gap-1 @lg/history:contents'>
                    <span className='min-w-0 space-y-0.5'>
                      <span className='block leading-tight font-semibold [overflow-wrap:anywhere]'>
                        {record.target.model}
                      </span>
                      <span className='text-muted-foreground block text-xs font-normal [overflow-wrap:anywhere]'>
                        {record.target.group}
                      </span>
                    </span>
                    <span className='text-muted-foreground text-xs font-normal tabular-nums'>
                      {formatTimestampToDate(record.finishedAt, 'milliseconds')}
                    </span>
                  </span>
                  <StatusBadge
                    {...statuses[record.outcome.status]}
                    copyable={false}
                  />
                  <ChevronRight
                    aria-hidden='true'
                    className='text-muted-foreground size-4 justify-self-end rtl:rotate-180'
                  />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState
          icon={History}
          title={t('No detection history yet')}
          className='min-h-36'
        />
      )}
    </Dialog>
  )
}
