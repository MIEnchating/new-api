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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import {
  deleteIntelligenceRecord,
  retryIntelligenceModel,
  intelligenceQueryKey,
  type IntelligenceMonitorData,
  type IntelligenceRetryTarget,
  type IntelligenceTask,
} from '@/features/status-monitor/intelligence-api'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { IntelligenceHistoryRun } from './intelligence-history-run'

export function IntelligenceHistory(props: { history: IntelligenceTask[] }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const [selected, setSelected] = useState<IntelligenceTask | null>(null)
  const [retryTarget, setRetryTarget] = useState<{
    task: IntelligenceTask
    target: IntelligenceRetryTarget
  } | null>(null)
  const [queued, setQueued] = useState<{
    before: IntelligenceTask
    after: IntelligenceTask
  } | null>(null)
  const retry = useMutation({
    mutationFn: retryIntelligenceModel,
    onSuccess: async (updated) => {
      if (retryTarget) setQueued({ before: retryTarget.task, after: updated })
      setRetryTarget(null)
      client.setQueriesData<IntelligenceMonitorData>(
        { queryKey: intelligenceQueryKey },
        (data) =>
          data
            ? {
                ...data,
                history: data.history.map((task) =>
                  task.task_id === updated.task_id ? updated : task
                ),
              }
            : data
      )
      client.removeQueries({
        queryKey: ['status-monitor', 'intelligence-result', updated.task_id],
      })
      toast.success(t('Intelligence test queued'))
      await client.invalidateQueries({
        queryKey: ['status-monitor', 'intelligence'],
      })
    },
  })
  const remove = useMutation({
    mutationFn: deleteIntelligenceRecord,
    onSuccess: async (_, taskId) => {
      setSelected(null)
      toast.success(t('Deleted successfully'))
      client.removeQueries({
        queryKey: ['status-monitor', 'intelligence-result', taskId],
        exact: true,
      })
      await client.invalidateQueries({
        queryKey: ['status-monitor', 'intelligence'],
      })
    },
  })
  return (
    <section
      aria-label={t('Intelligence test history')}
      className='@container/history flex min-w-0 flex-col gap-4'
    >
      <header className='flex flex-col gap-1.5'>
        <div className='flex items-center gap-2'>
          <h3 className='text-sm font-semibold'>
            {t('Intelligence test history')}
          </h3>
          <Badge variant='secondary' className='tabular-nums'>
            {formatNumber(props.history.length, locale)}
          </Badge>
        </div>
        <p className='text-muted-foreground text-xs'>
          {t('Showing the latest 20 runs.')}
        </p>
      </header>
      {props.history.length === 0 ? (
        <EmptyState title={t('No intelligence test results yet')} bordered />
      ) : (
        <div className='flex min-w-0 flex-col gap-4'>
          {props.history.map((task) => (
            <IntelligenceHistoryRun
              key={task.task_id}
              task={queued?.before === task ? queued.after : task}
              deleting={remove.isPending || retry.isPending}
              onRetry={(target) => setRetryTarget({ task, target })}
              onDelete={() => setSelected(task)}
            />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={retryTarget !== null}
        onOpenChange={(open) => {
          if (!open && !retry.isPending) setRetryTarget(null)
        }}
        title={t('Retry {{model}} and replace its results?', {
          model: retryTarget?.target.model,
        })}
        desc={
          retryTarget?.target.channel_id !== undefined
            ? t(
                'This reruns only this channel and question for the selected model and replaces this result. Other results continue independently. Upstream API usage may incur charges.'
              )
            : t(
                'This reruns only this model in the selected group using the recorded questions and replaces its results in this run. Other models are unchanged. Upstream API usage may incur charges.'
              )
        }
        confirmText={t('Retry model')}
        isLoading={retry.isPending}
        handleConfirm={() => {
          if (retryTarget) {
            retry.mutate({
              taskId: retryTarget.task.task_id,
              target: retryTarget.target,
            })
          }
        }}
      />
      <ConfirmDialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setSelected(null)
        }}
        title={t('Delete intelligence test record?')}
        desc={t(
          'This removes the entire run and its public previews. This cannot be undone.'
        )}
        confirmText={t('Delete')}
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (selected) remove.mutate(selected.task_id)
        }}
      />
    </section>
  )
}
