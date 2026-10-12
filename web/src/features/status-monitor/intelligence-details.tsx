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
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { IntelligenceAttempt } from './intelligence-api'
import { getIntelligenceQuestionName } from './intelligence-labels'

type DiagnosticChannel = {
  group?: string
  model?: string
  question_name?: string
  error?: string
  attempts?: IntelligenceAttempt[]
}

export function IntelligenceDetails(props: {
  taskId: string
  error?: string
  result?: unknown
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const result = props.result as { channels?: DiagnosticChannel[] } | undefined
  const channels = Array.isArray(result?.channels) ? result.channels : []
  return (
    <Dialog
      title={t('Intelligence test details')}
      trigger={
        <Button variant='ghost' size='sm'>
          {t('Detail')}
        </Button>
      }
    >
      <div className='space-y-4 text-sm'>
        <div className='flex items-center gap-2'>
          <span className='min-w-0 font-mono break-all'>{props.taskId}</span>
          <CopyButton value={props.taskId} />
        </div>
        {props.error && (
          <p className='text-destructive break-words whitespace-pre-wrap'>
            {t(props.error)}
          </p>
        )}
        {channels.map((row, index) => (
          <section key={index} className='space-y-2 rounded-lg border p-3'>
            <p className='font-medium break-words'>
              {row.group} · {row.model} ·{' '}
              {getIntelligenceQuestionName(row.question_name || '', t)}
            </p>
            {row.error && (
              <p className='text-destructive break-words whitespace-pre-wrap'>
                {t(row.error)}
              </p>
            )}
            {row.attempts?.length ? (
              row.attempts.map((attempt, attemptIndex) => (
                <div
                  key={attempt.request_id}
                  className='space-y-1 border-t pt-2'
                >
                  <p className='text-muted-foreground'>
                    {t('Attempt {{number}}', {
                      number: formatNumber(attemptIndex + 1, locale),
                    })}{' '}
                    · {formatNumber(attempt.latency_ms / 1000, locale)}{' '}
                    {t('seconds')}
                    {attempt.http_status
                      ? ` · HTTP ${attempt.http_status}`
                      : ''}
                  </p>
                  <p
                    className={
                      attempt.error
                        ? 'text-destructive break-words whitespace-pre-wrap'
                        : 'text-muted-foreground'
                    }
                  >
                    {attempt.error ? t(attempt.error) : t('Completed')}
                  </p>
                  <div className='flex items-center gap-1'>
                    <span className='text-muted-foreground shrink-0'>
                      {t('Request ID')}:
                    </span>
                    <span className='min-w-0 font-mono text-xs break-all'>
                      {attempt.request_id}
                    </span>
                    <CopyButton value={attempt.request_id} />
                  </div>
                  {attempt.upstream_request_id && (
                    <div className='flex items-center gap-1'>
                      <span className='text-muted-foreground shrink-0'>
                        {t('Upstream Request ID')}:
                      </span>
                      <span className='min-w-0 font-mono text-xs break-all'>
                        {attempt.upstream_request_id}
                      </span>
                      <CopyButton value={attempt.upstream_request_id} />
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className='text-muted-foreground'>
                {t('This older record has no detailed attempt information.')}
              </p>
            )}
          </section>
        ))}
        {channels.length === 0 && (
          <p className='text-muted-foreground'>{t('No request records yet')}</p>
        )}
      </div>
    </Dialog>
  )
}
