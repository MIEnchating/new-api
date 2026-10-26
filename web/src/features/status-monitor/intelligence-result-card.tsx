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
import { Clock3, Cpu } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getIntelligenceQuestionName } from './intelligence-labels'
import { IntelligencePreview } from './intelligence-preview'
import type { IntelligenceCardData } from './intelligence-results'

export const IntelligenceResultCard = memo(function IntelligenceResultCard(
  props: IntelligenceCardData & {
    showGroup: boolean
    onGroupSelect: (group: string) => void
  }
) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const groupLabel = props.group || t('Ungrouped')
  const date = new Date(props.task.created_at * 1000)
  const dateLabel = date.toLocaleString(locale)
  const questionName = props.channel
    ? getIntelligenceQuestionName(props.channel.question_name, t)
    : ''
  const active = props.status === 'running' || props.status === 'pending'
  const retryCount = props.channel?.retry_count ?? 0
  const percent =
    props.counts && props.counts.total > 0
      ? Math.min(
          100,
          Math.round((props.counts.processed * 100) / props.counts.total)
        )
      : null
  let statusLabel = t('Pending')
  if (props.status === 'running') statusLabel = t('Running')
  if (props.status === 'succeeded') statusLabel = t('Completed')
  if (props.status === 'failed') statusLabel = t('Failed')
  let error = props.channel?.error ?? props.task.error
  if (!props.channel && props.status === 'failed' && !error) {
    error = 'Intelligence test request failed'
  }

  return (
    <Card
      data-card-hover='false'
      className='min-w-0 gap-0 overflow-hidden border py-0 ring-0'
    >
      <CardHeader className='gap-2 px-4 py-3'>
        <div className='flex min-w-0 items-start justify-between gap-3'>
          <CardTitle className='min-w-0 flex-1'>
            <Badge
              variant='outline'
              aria-label={`${t('Model')}: ${props.model}`}
              title={props.model}
              className='bg-muted/30 h-auto min-h-6 max-w-full min-w-0 justify-start gap-1.5 rounded-md px-2 font-mono text-xs font-semibold'
            >
              <Cpu
                aria-hidden='true'
                className='text-muted-foreground shrink-0'
              />
              <span className='break-all whitespace-normal'>{props.model}</span>
            </Badge>
          </CardTitle>
          <Badge
            variant={props.status === 'failed' ? 'destructive' : 'secondary'}
            className='shrink-0 text-[10px]'
          >
            {statusLabel}
          </Badge>
        </div>
        {(props.showGroup || questionName) && (
          <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
            {props.showGroup && (
              <Button
                variant='ghost'
                size='sm'
                aria-label={t('Filter by group {{group}}', {
                  group: groupLabel,
                })}
                className='h-auto min-h-6 max-w-full min-w-0 justify-start rounded-md p-0'
                onClick={() => props.onGroupSelect(props.group)}
              >
                <GroupBadge
                  group={props.group}
                  label={groupLabel}
                  aria-label={`${t('Group')}: ${groupLabel}`}
                />
              </Button>
            )}
            {questionName && (
              <span
                className='text-muted-foreground min-w-0 flex-1 basis-28 truncate text-xs'
                title={questionName}
              >
                {questionName}
              </span>
            )}
          </div>
        )}
        <div className='text-muted-foreground flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs tabular-nums'>
          <time dateTime={date.toISOString()} title={dateLabel}>
            {date.toLocaleString(locale, {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </time>
          {retryCount > 0 ? (
            <span>
              {t('Retry Times')}: {formatNumber(retryCount, locale)}
            </span>
          ) : null}
          {props.channel && (
            <span
              className='inline-flex shrink-0 items-center gap-1'
              title={t('Latency')}
            >
              <Clock3 aria-hidden='true' className='size-3' />
              {formatNumber(props.channel.latency_ms / 1000, locale)}{' '}
              {t('seconds')}
            </span>
          )}
          {!props.channel && props.counts && props.counts.total > 0 && (
            <span>
              {formatNumber(props.counts.processed, locale)} /{' '}
              {formatNumber(props.counts.total, locale)}
            </span>
          )}
        </div>
        {!props.channel && (active || percent !== null) && (
          <Progress
            value={
              props.status === 'running' && (percent === null || percent === 0)
                ? null
                : (percent ?? 0)
            }
            aria-label={`${t('Progress')}: ${props.group} · ${props.model}`}
            className='[&_[data-slot=progress-indicator][data-indeterminate]]:w-1/3 [&_[data-slot=progress-indicator][data-indeterminate]]:motion-safe:animate-[intelligence-progress_1.4s_ease-in-out_infinite_alternate] [&_[data-slot=progress-track]]:h-1.5'
          />
        )}
      </CardHeader>
      {error ? (
        <p
          role='alert'
          className='text-destructive bg-destructive/5 border-t px-4 py-3 text-xs break-words'
        >
          {t(error)}
        </p>
      ) : null}
      {props.channel && !error && (
        <IntelligencePreview
          taskId={props.task.task_id}
          channelId={props.channel.channel_id}
          group={props.channel.group}
          model={props.channel.model}
          questionIndex={props.channel.question_index}
          label={`${groupLabel} · ${props.model} · ${questionName}`}
        />
      )}
    </Card>
  )
})
