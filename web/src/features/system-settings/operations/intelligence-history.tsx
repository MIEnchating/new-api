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
import { CopyButton } from '@/components/copy-button'
import { StaticDataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  deleteIntelligenceRecord,
  type IntelligenceTask,
} from '@/features/status-monitor/intelligence-api'
import { IntelligenceDetails } from '@/features/status-monitor/intelligence-details'
import { getIntelligenceQuestionName } from '@/features/status-monitor/intelligence-labels'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { SettingsCard } from '../components/settings-card'

export function IntelligenceHistory(props: { history: IntelligenceTask[] }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const [selected, setSelected] = useState<IntelligenceTask | null>(null)
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
    <SettingsCard
      title={t('Intelligence test history')}
      disableHoverEffect
      className='min-w-0'
    >
      <p className='text-muted-foreground text-xs'>
        {t('Showing the latest 20 runs.')}
      </p>
      <StaticDataTable
        data={props.history}
        getRowKey={(task) => task.task_id}
        tableClassName='min-w-[760px]'
        emptyContent={t('No intelligence test results yet')}
        columns={[
          {
            id: 'time',
            header: t('Time'),
            cell: (task) => (
              <div className='space-y-1'>
                <time dateTime={new Date(task.created_at * 1000).toISOString()}>
                  {new Date(task.created_at * 1000).toLocaleString(locale)}
                </time>
                <div className='text-muted-foreground flex items-center gap-1 text-xs'>
                  <span>{t('Task ID')}</span>
                  <span className='max-w-28 truncate' title={task.task_id}>
                    {task.task_id}
                  </span>
                  <CopyButton
                    value={task.task_id}
                    size='icon'
                    className='size-6'
                  />
                </div>
              </div>
            ),
          },
          {
            id: 'status',
            header: t('Status'),
            cell: (task) => {
              let status = t('Pending')
              if (task.status === 'running') status = t('Running')
              if (task.status === 'succeeded') status = t('Completed')
              if (task.status === 'failed') status = t('Failed')
              return (
                <div className='space-y-1'>
                  <Badge
                    variant={
                      task.status === 'failed' ? 'destructive' : 'secondary'
                    }
                  >
                    {status}
                  </Badge>
                  {task.error && (
                    <p className='text-destructive max-w-48 text-xs whitespace-normal'>
                      {t(task.error)}
                    </p>
                  )}
                </div>
              )
            },
          },
          {
            id: 'requests',
            header: t('Test requests'),
            cell: (task) => (
              <div className='min-w-64 space-y-3'>
                {task.result?.channels.length ? (
                  task.result.channels.map((row) => (
                    <div
                      key={`${row.group}-${row.model}-${row.channel_id}-${row.question_index}`}
                      className='space-y-1 text-xs'
                    >
                      <p className='font-medium'>
                        {row.group || task.group} · {row.model || task.model}
                      </p>
                      <p className='text-muted-foreground'>
                        {t('Channel')} #{formatNumber(row.channel_id, locale)} ·{' '}
                        {getIntelligenceQuestionName(row.question_name, t)} ·{' '}
                        {formatNumber(row.latency_ms / 1000, locale)}{' '}
                        {t('seconds')}
                      </p>
                      <div className='flex items-center gap-1'>
                        <span className='text-muted-foreground'>
                          {t('Request ID')}:
                        </span>
                        <span
                          className='max-w-60 truncate font-mono'
                          title={row.request_id}
                        >
                          {row.request_id || t('Not recorded')}
                        </span>
                        {row.request_id && (
                          <CopyButton
                            value={row.request_id}
                            className='size-6'
                          />
                        )}
                      </div>
                      {row.upstream_request_id && (
                        <div className='flex items-center gap-1'>
                          <span className='text-muted-foreground'>
                            {t('Upstream Request ID')}:
                          </span>
                          <span
                            className='max-w-60 truncate font-mono'
                            title={row.upstream_request_id}
                          >
                            {row.upstream_request_id}
                          </span>
                          <CopyButton
                            value={row.upstream_request_id}
                            className='size-6'
                          />
                        </div>
                      )}
                      {row.error && (
                        <p className='text-destructive whitespace-normal'>
                          {t(row.error)}
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <span className='text-muted-foreground'>
                    {t('No request records yet')}
                  </span>
                )}
              </div>
            ),
          },
          {
            id: 'actions',
            header: t('Actions'),
            cell: (task) => (
              <div className='flex items-center gap-1'>
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
                  className='text-destructive'
                  disabled={
                    task.status === 'pending' ||
                    task.status === 'running' ||
                    remove.isPending
                  }
                  onClick={() => setSelected(task)}
                >
                  {t('Delete')}
                </Button>
              </div>
            ),
          },
        ]}
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
    </SettingsCard>
  )
}
