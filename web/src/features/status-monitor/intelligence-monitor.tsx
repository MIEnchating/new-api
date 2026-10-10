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
import { Cpu, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { GroupBadge } from '@/components/group-badge'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import {
  getIntelligenceResults,
  intelligenceResultsQueryKey,
} from './intelligence-api'
import { getIntelligenceQuestionName } from './intelligence-labels'
import { IntelligencePreview } from './intelligence-preview'
import { RefreshControl } from './refresh-control'

export function IntelligenceMonitor() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const query = useQuery({
    queryKey: intelligenceResultsQueryKey,
    queryFn: getIntelligenceResults,
    refetchInterval: (state) =>
      state.state.data?.history.some(
        (task) => task.status === 'pending' || task.status === 'running'
      )
        ? 3000
        : 30000,
    meta: { errorToast: false },
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />

  return (
    <section
      aria-label={t('Intelligence test history')}
      className='min-w-0 space-y-4'
    >
      <div className='flex justify-end'>
        <RefreshControl
          loading={false}
          refreshing={query.isFetching}
          lastUpdated={new Date(query.dataUpdatedAt)}
          onRefresh={() => void query.refetch()}
        />
      </div>
      {query.data.history.length === 0 && (
        <EmptyState title={t('No intelligence test results yet')} />
      )}
      <div className='grid min-w-0 items-start gap-4 md:grid-cols-2 2xl:grid-cols-3'>
        {query.data.history.map((task) => {
          let status = t('Pending')
          if (task.status === 'running') status = t('Running')
          if (task.status === 'succeeded') status = t('Completed')
          if (task.status === 'failed') status = t('Failed')
          const date = new Date(task.created_at * 1000).toLocaleString(locale)
          const channels = task.result?.channels ?? []
          if (channels.length === 0) {
            return (
              <Card
                key={task.task_id}
                data-card-hover='false'
                className='min-w-0 gap-3 border ring-0'
              >
                <CardHeader className='gap-2'>
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0 flex-1 space-y-1.5'>
                      {(task.groups?.length
                        ? task.groups
                        : [{ group: task.group, model: task.model }]
                      ).map((group) => (
                        <IntelligenceResultIdentity
                          key={group.group}
                          group={group.group}
                          model={group.model}
                        />
                      ))}
                    </div>
                    <Badge
                      variant={
                        task.status === 'failed' ? 'destructive' : 'secondary'
                      }
                    >
                      {status}
                    </Badge>
                  </div>
                  <p className='text-muted-foreground text-xs'>{date}</p>
                  {(task.status === 'running' || task.status === 'pending') && (
                    <Progress
                      value={task.state?.progress ?? 0}
                      aria-label={t('Progress')}
                    />
                  )}
                  {task.error && (
                    <p
                      role='alert'
                      className='text-destructive text-xs break-words'
                    >
                      {t(task.error)}
                    </p>
                  )}
                </CardHeader>
              </Card>
            )
          }
          return channels.map((channel) => (
            <Card
              key={`${task.task_id}-${channel.group}-${channel.channel_id}-${channel.question_index}`}
              data-card-hover='false'
              className='min-w-0 gap-0 border py-0 ring-0'
            >
              <CardHeader className='gap-1.5 py-3'>
                <div className='flex items-start justify-between gap-2'>
                  <IntelligenceResultIdentity
                    group={channel.group || task.group}
                    model={channel.model || task.model}
                  />
                  <Badge
                    variant={channel.error ? 'destructive' : 'secondary'}
                    className='shrink-0 text-[10px]'
                  >
                    {channel.error ? t('Failed') : t('Completed')}
                  </Badge>
                </div>
                <div className='text-muted-foreground flex min-w-0 items-center gap-2 text-xs'>
                  <span
                    className='min-w-0 flex-1 truncate'
                    title={getIntelligenceQuestionName(
                      channel.question_name,
                      t
                    )}
                  >
                    {getIntelligenceQuestionName(channel.question_name, t)}
                  </span>
                  <span className='shrink-0 tabular-nums' title={t('Latency')}>
                    {formatNumber(channel.latency_ms / 1000, locale)}{' '}
                    {t('seconds')}
                  </span>
                  <time
                    className='shrink-0 text-[10px] tabular-nums'
                    dateTime={new Date(task.created_at * 1000).toISOString()}
                    title={date}
                  >
                    {new Date(task.created_at * 1000).toLocaleString(locale, {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </time>
                </div>
              </CardHeader>
              {channel.error ? (
                <p
                  role='alert'
                  className='text-destructive border-t px-4 py-3 text-xs break-words'
                >
                  {t(channel.error)}
                </p>
              ) : (
                <IntelligencePreview
                  taskId={task.task_id}
                  channelId={channel.channel_id}
                  group={channel.group}
                  questionIndex={channel.question_index}
                />
              )}
            </Card>
          ))
        })}
      </div>
    </section>
  )
}

function IntelligenceResultIdentity(props: { group: string; model: string }) {
  const { t } = useTranslation()
  return (
    <CardTitle className='flex min-w-0 flex-1 items-center gap-1.5'>
      <GroupBadge
        group={props.group}
        icon={Layers}
        aria-label={`${t('Group')}: ${props.group}`}
        className='bg-muted/70 h-6 max-w-[45%] rounded-md border border-current/15 px-2 text-xs font-semibold'
      />
      <Badge
        variant='outline'
        aria-label={`${t('Model')}: ${props.model}`}
        title={props.model}
        className='bg-muted/30 h-6 min-w-0 shrink justify-start gap-1.5 rounded-md px-2 font-mono text-xs font-semibold'
      >
        <Cpu aria-hidden='true' className='text-muted-foreground shrink-0' />
        <span className='truncate'>{props.model}</span>
      </Badge>
    </CardTitle>
  )
}
