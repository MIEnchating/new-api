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
import {
  Clock01Icon,
  Delete02Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type {
  IntelligenceRetryTarget,
  IntelligenceTask,
} from '@/features/status-monitor/intelligence-api'
import { IntelligenceDetails } from '@/features/status-monitor/intelligence-details'
import { getIntelligenceQuestionName } from '@/features/status-monitor/intelligence-labels'
import { IntelligencePreview } from '@/features/status-monitor/intelligence-preview'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export function IntelligenceHistoryRun(props: {
  task: IntelligenceTask
  deleting: boolean
  onDelete: () => void
  onRetry: (target: IntelligenceRetryTarget) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const task = props.task
  const active = task.status === 'pending' || task.status === 'running'
  const channels = [...(task.result?.channels ?? [])]
  let models = task.groups ?? []
  if (models.length === 0 && channels.length === 0) {
    models = [{ group: task.group, model: task.model, endpoint: task.endpoint }]
  }
  for (const model of models) {
    if (
      channels.some(
        (row) =>
          (row.group || task.group) === model.group &&
          (row.model || task.model) === model.model
      )
    ) {
      continue
    }
    channels.push({
      group: model.group,
      model: model.model,
      channel_id: 0,
      question_index: -1,
      question_name: '',
      latency_ms: 0,
      error: active ? '' : task.error || 'Intelligence test request failed',
    })
  }
  const groupRanks = new Map<string, number>()
  const modelRanks = new Map<string, number>()
  for (const [index, model] of models.entries()) {
    if (!groupRanks.has(model.group)) groupRanks.set(model.group, index)
    modelRanks.set(JSON.stringify([model.group, model.model]), index)
  }
  channels.sort((a, b) => {
    const aGroup = a.group || task.group
    const bGroup = b.group || task.group
    const groupRank =
      (groupRanks.get(aGroup) ?? models.length) -
      (groupRanks.get(bGroup) ?? models.length)
    if (groupRank !== 0) return groupRank
    const modelRank =
      (modelRanks.get(JSON.stringify([aGroup, a.model || task.model])) ??
        models.length) -
      (modelRanks.get(JSON.stringify([bGroup, b.model || task.model])) ??
        models.length)
    return (
      modelRank ||
      (a.model || task.model).localeCompare(b.model || task.model) ||
      a.channel_id - b.channel_id ||
      a.question_index - b.question_index
    )
  })
  const groupedChannels = new Map<string, typeof channels>()
  for (const row of channels) {
    const group = row.group || task.group || t('Ungrouped')
    const rows = groupedChannels.get(group) ?? []
    rows.push(row)
    groupedChannels.set(group, rows)
  }
  const createdAt = new Date(task.created_at * 1000)
  let status = t('Pending')
  let variant: StatusVariant = 'warning'
  if (task.status === 'running') {
    status = t('Running')
    variant = 'info'
  } else if (task.status === 'succeeded') {
    status = t('Completed')
    variant = 'success'
  } else if (task.status === 'failed') {
    status = t('Failed')
    variant = 'danger'
  }

  return (
    <Card className='min-w-0 gap-0 py-0' data-card-hover='false'>
      <CardHeader className='flex flex-col gap-3 border-b p-3 @min-[36rem]/history:flex-row @min-[36rem]/history:items-start @min-[36rem]/history:justify-between'>
        <div className='flex w-full min-w-0 flex-col gap-1.5 @min-[36rem]/history:w-auto'>
          <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
            <time
              dateTime={createdAt.toISOString()}
              className='text-sm font-semibold tabular-nums'
            >
              {createdAt.toLocaleString(locale)}
            </time>
            <StatusBadge variant={variant} copyable={false} showDot>
              {status}
            </StatusBadge>
            <span className='text-muted-foreground text-xs'>
              {t('Test requests')}{' '}
              <span className='tabular-nums'>
                {formatNumber(task.result?.channels.length ?? 0, locale)}
              </span>
            </span>
          </div>
          <div className='max-w-sm min-w-0'>
            <HistoryIdentifier label={t('Task ID')} value={task.task_id} />
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-1 self-end @min-[36rem]/history:self-start'>
          <IntelligenceDetails
            taskId={task.task_id}
            group={task.group}
            model={task.model}
            endpoint={task.endpoint}
            error={task.error}
            result={task.result}
          />
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='text-muted-foreground hover:text-destructive'
            disabled={
              task.status === 'pending' ||
              task.status === 'running' ||
              props.deleting
            }
            onClick={props.onDelete}
          >
            <HugeiconsIcon
              icon={Delete02Icon}
              data-icon='inline-start'
              aria-hidden='true'
            />
            {t('Delete')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className='flex min-w-0 flex-col gap-3 p-3'>
        {task.error && (
          <Alert variant='destructive'>
            <AlertDescription className='break-all whitespace-pre-wrap'>
              {t(task.error)}
            </AlertDescription>
          </Alert>
        )}
        {channels.length > 0 ? (
          <div className='flex min-w-0 flex-col gap-4'>
            {[...groupedChannels.entries()].map(([group, rows]) => (
              <section
                key={group}
                aria-label={`${t('Group')}: ${group}`}
                className='flex min-w-0 flex-col gap-2'
              >
                <div className='flex items-center gap-2 px-1'>
                  <span className='text-muted-foreground text-xs'>
                    {t('Group')}
                  </span>
                  <Badge variant='secondary' className='max-w-full break-all'>
                    {group}
                  </Badge>
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {formatNumber(rows.length, locale)}
                  </span>
                </div>
                <ul
                  aria-label={t('Test requests')}
                  className={cn(
                    'grid min-w-0 grid-cols-1 gap-3',
                    rows.length > 1 && '@min-[44rem]/history:grid-cols-2',
                    rows.length > 2 && '@min-[76rem]/history:grid-cols-3'
                  )}
                >
                  {rows.map((row) => {
                    const retrying = [
                      ...(task.retries ?? []),
                      ...(task.retry &&
                      (!row.revision || row.revision !== task.retry.revision)
                        ? [task.retry]
                        : []),
                    ].some(
                      (target) =>
                        target.group === (row.group || task.group) &&
                        target.model === (row.model || task.model) &&
                        (target.channel_id === undefined ||
                          (target.channel_id === row.channel_id &&
                            target.question_index === row.question_index))
                    )
                    return (
                      <li
                        key={`${row.group}-${row.model}-${row.channel_id}-${row.question_index}`}
                        className='bg-muted/20 flex min-w-0 flex-col gap-2 rounded-lg border p-3'
                      >
                        <div className='flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1'>
                          <p className='max-w-full min-w-0 text-sm font-medium break-all'>
                            {row.model || task.model || t('Not recorded')}
                          </p>
                        </div>
                        {row.channel_id > 0 && (
                          <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                            <Badge
                              variant='outline'
                              className='text-xs font-normal tabular-nums'
                            >
                              {t('Channel')} #
                              {formatNumber(row.channel_id, locale)}
                            </Badge>
                            <span className='text-muted-foreground min-w-0 text-xs break-all'>
                              {getIntelligenceQuestionName(
                                row.question_name,
                                t
                              )}
                            </span>
                            <span className='text-muted-foreground inline-flex items-center gap-1 text-xs tabular-nums'>
                              <HugeiconsIcon
                                icon={Clock01Icon}
                                className='size-3.5'
                                aria-hidden='true'
                              />
                              {formatNumber(row.latency_ms / 1000, locale)}{' '}
                              {t('seconds')}
                            </span>
                          </div>
                        )}
                        {row.channel_id > 0 && (
                          <div className='mt-auto flex min-w-0 flex-col gap-1'>
                            <HistoryIdentifier
                              label={t('Request ID')}
                              value={row.request_id}
                            />
                            {row.upstream_request_id && (
                              <HistoryIdentifier
                                label={t('Upstream Request ID')}
                                value={row.upstream_request_id}
                              />
                            )}
                          </div>
                        )}
                        {row.channel_id === 0 && active && (
                          <p className='text-muted-foreground text-xs'>
                            {t(
                              task.status === 'pending' ? 'Pending' : 'Running'
                            )}
                          </p>
                        )}
                        {retrying && (
                          <p className='text-muted-foreground text-xs'>
                            {t('Running')}
                          </p>
                        )}
                        {row.error && (
                          <p className='text-destructive text-xs break-all whitespace-pre-wrap'>
                            {t(row.error)}
                          </p>
                        )}
                        <div className='mt-auto flex flex-wrap justify-end gap-2'>
                          {(row.channel_id > 0 || !active) && (
                            <Button
                              type='button'
                              variant='outline'
                              size='sm'
                              aria-label={t('Retry model {{model}}', {
                                model: row.model || task.model,
                              })}
                              disabled={
                                retrying ||
                                props.deleting ||
                                !(row.model || task.model)
                              }
                              onClick={() =>
                                props.onRetry({
                                  group: row.group || task.group,
                                  model: row.model || task.model,
                                  ...(row.channel_id > 0
                                    ? {
                                        channel_id: row.channel_id,
                                        question_index: row.question_index,
                                      }
                                    : {}),
                                })
                              }
                            >
                              <HugeiconsIcon
                                icon={RefreshIcon}
                                data-icon='inline-start'
                                aria-hidden='true'
                              />
                              {t('Retry model')}
                            </Button>
                          )}
                          {!row.error && row.channel_id > 0 && (
                            <IntelligencePreview
                              version={row.revision || task.retry?.revision}
                              variant='button'
                              taskId={task.task_id}
                              channelId={row.channel_id}
                              group={row.group}
                              model={row.model}
                              questionIndex={row.question_index}
                              label={`${row.group || task.group || t('Ungrouped')} · ${row.model || task.model || t('Not recorded')} · ${getIntelligenceQuestionName(row.question_name, t)}`}
                            />
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className='text-muted-foreground bg-muted/20 rounded-lg border border-dashed px-3 py-5 text-center text-xs'>
            {t('No request records yet')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function HistoryIdentifier(props: { label: string; value?: string }) {
  const { t } = useTranslation()
  return (
    <div className='flex min-w-0 items-center gap-1.5 text-xs'>
      <span className='text-muted-foreground max-w-[45%] shrink-0'>
        {props.label}
      </span>
      <span
        className='text-muted-foreground min-w-0 truncate font-mono'
        title={props.value}
      >
        {props.value || t('Not recorded')}
      </span>
      {props.value && (
        <CopyButton
          value={props.value}
          aria-label={props.label}
          className='text-muted-foreground size-6'
        />
      )}
    </div>
  )
}
