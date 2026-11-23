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
import { Clock3 } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { GroupBadge } from '@/components/group-badge'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { formatThroughput } from '@/features/performance-metrics/lib/format'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

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
  const tps = props.channel?.tokens_per_second
  const throughput = typeof tps === 'number' ? formatThroughput(tps) : ''
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
  const hasPreview =
    props.channel &&
    (props.channel.has_html || (!error && !props.channel.external_result))
  const assessment = props.channel?.external_result
  let ribbonLabel = statusLabel
  let ribbonColor = 'bg-slate-600'
  if (error) {
    ribbonColor = 'bg-red-700'
  } else if (assessment?.label === '参考') {
    ribbonLabel = t('For reference')
  } else if (assessment?.quality === 'normal') {
    ribbonLabel = assessment.label || t('Normal')
    ribbonColor = 'bg-emerald-800'
  } else if (
    assessment?.quality === 'degraded' ||
    assessment?.quality === 'suspicious'
  ) {
    ribbonLabel = assessment.label || t('Suspected degradation')
    ribbonColor = 'bg-amber-800'
  } else if (assessment) {
    ribbonLabel = assessment.label || t('Unknown')
  }
  const previewLabel = [groupLabel, props.model, questionName]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card
      data-card-hover='false'
      className='relative min-w-0 gap-0 overflow-hidden rounded-xl border py-0 ring-0'
    >
      <CardHeader className='order-last shrink-0 content-start gap-1 rounded-none border-t px-3 py-2.5'>
        <div className='flex min-h-6 min-w-0 items-center justify-between gap-2'>
          <CardTitle
            aria-label={`${t('Model')}: ${props.model}`}
            title={props.model}
            className='min-w-0 flex-1 truncate font-mono text-sm font-semibold'
          >
            {props.model}
          </CardTitle>
          {props.showGroup && (
            <Button
              variant='ghost'
              size='sm'
              aria-label={t('Filter by group {{group}}', {
                group: groupLabel,
              })}
              className='h-auto min-h-6 max-w-[55%] min-w-0 justify-start rounded-md p-0'
              onClick={() => props.onGroupSelect(props.group)}
            >
              <GroupBadge
                group={props.group}
                label={groupLabel}
                aria-label={`${t('Group')}: ${groupLabel}`}
              />
            </Button>
          )}
        </div>
        <div className='text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs tabular-nums'>
          {!hasPreview && (
            <Badge
              variant={props.status === 'failed' ? 'destructive' : 'secondary'}
              className='shrink-0 text-[10px]'
            >
              {statusLabel}
            </Badge>
          )}
          {questionName && (
            <span className='max-w-28 min-w-0 truncate' title={questionName}>
              {questionName}
            </span>
          )}
          <time
            className='mr-auto shrink-0'
            dateTime={date.toISOString()}
            title={dateLabel}
          >
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
          {typeof tps === 'number' &&
            Number.isFinite(tps) &&
            tps > 0 &&
            !error && (
              <span
                className='text-foreground shrink-0 font-medium'
                title={
                  props.channel?.average_tps
                    ? t('Average TPS')
                    : t('Sustained tokens per second')
                }
              >
                {props.channel?.average_tps ? t('Average TPS') : 'TPS'}{' '}
                {throughput.replace(/ t\/s$/, '')}
              </span>
            )}
          {!props.channel && props.counts && props.counts.total > 0 && (
            <span>
              {formatNumber(props.counts.processed, locale)} /{' '}
              {formatNumber(props.counts.total, locale)}
            </span>
          )}
        </div>
      </CardHeader>
      <div
        data-slot='intelligence-card-content'
        aria-busy={active}
        className='bg-muted/30 relative aspect-[4/3] shrink-0 overflow-hidden'
      >
        {props.channel && hasPreview ? (
          <div className='absolute inset-0 overflow-hidden'>
            <IntelligencePreview
              variant='gallery'
              version={props.channel.revision || props.task.retry?.revision}
              taskId={props.task.task_id}
              channelId={props.channel.channel_id}
              group={props.channel.group}
              model={props.channel.model}
              questionIndex={props.channel.question_index}
              label={
                assessment || error ? (
                  <>
                    <span className='block'>{previewLabel}</span>
                    {assessment && (
                      <span className='mt-2 block'>
                        {t('Manxue AI')} · {ribbonLabel}
                      </span>
                    )}
                    {assessment?.reason && (
                      <span className='block [overflow-wrap:anywhere]'>
                        {assessment.reason}
                      </span>
                    )}
                    {error && (
                      <span className='text-destructive block'>{t(error)}</span>
                    )}
                  </>
                ) : (
                  previewLabel
                )
              }
            />
            {(assessment || error) && (
              <span className='pointer-events-none absolute top-0 right-0 z-10 size-28 overflow-hidden'>
                <span
                  className={cn(
                    'absolute top-8 -right-9 w-40 rotate-45 px-8 py-1 text-center text-[10px] leading-tight font-semibold text-white shadow-sm',
                    ribbonColor
                  )}
                >
                  {ribbonLabel}
                </span>
              </span>
            )}
          </div>
        ) : (
          <div
            className='absolute inset-0 flex flex-col overflow-auto p-4 pb-10'
            role={error ? 'alert' : undefined}
          >
            {props.channel?.external_result && !error ? (
              <div className='my-auto space-y-2 text-sm'>
                <p className='font-medium'>
                  {props.channel.external_result.label ||
                    props.channel.external_result.status}
                </p>
                {props.channel.external_result.reason && (
                  <p className='text-muted-foreground text-xs'>
                    {props.channel.external_result.reason}
                  </p>
                )}
                {props.channel.external_result.answer && (
                  <p className='max-h-40 overflow-auto break-words whitespace-pre-wrap'>
                    {props.channel.external_result.answer}
                  </p>
                )}
              </div>
            ) : active && !error ? (
              <LoadingState message={statusLabel} className='min-h-0 flex-1' />
            ) : (
              <div className='my-auto'>
                <ErrorState
                  title={
                    error
                      ? t('Failed')
                      : t('Intelligence test returned no output')
                  }
                  description={error ? t(error) : undefined}
                  className='min-h-0 gap-2 p-0 [overflow-wrap:anywhere] [&_[data-slot=empty-description]]:text-xs'
                />
              </div>
            )}
          </div>
        )}
        {!props.channel && !error && (active || percent !== null) && (
          <Progress
            value={
              props.status === 'running' && (percent === null || percent === 0)
                ? null
                : (percent ?? 0)
            }
            aria-label={`${t('Progress')}: ${props.group} · ${props.model}`}
            className='absolute inset-x-4 bottom-4 [&_[data-slot=progress-indicator][data-indeterminate]]:w-1/3 [&_[data-slot=progress-indicator][data-indeterminate]]:motion-safe:animate-[intelligence-progress_1.4s_ease-in-out_infinite_alternate] [&_[data-slot=progress-track]]:h-1.5'
          />
        )}
      </div>
    </Card>
  )
})
