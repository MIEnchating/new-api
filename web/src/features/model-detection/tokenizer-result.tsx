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
import { ChevronDown, ScanText } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { IconBadge } from '@/components/ui/icon-badge'
import { toIntlLocale } from '@/i18n/languages'

import type { ModelDetectionResult } from './api'
import { TokenizerEvidence } from './tokenizer-evidence'

export function TokenizerProbePending() {
  const { t } = useTranslation()
  return (
    <Card>
      <CardContent className='space-y-2'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <h3 className='font-semibold'>{t('Tokenizer probe')}</h3>
          <StatusBadge
            label={t('In progress')}
            variant='info'
            copyable={false}
          />
        </div>
        <LoadingState
          inline
          size='sm'
          message={t('Waiting for tokenizer probe results…')}
        />
      </CardContent>
    </Card>
  )
}

export function TokenizerProbeResult(props: {
  report: NonNullable<ModelDetectionResult['tokenizer']>
  selectedModel: string
  onRetry?: () => void
  pending?: boolean
  error?: string
}) {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const percent = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  })
  const report = props.report
  const verdict = report.verdict
  const nearest = verdict?.top?.series || verdict?.top?.id
  const hasFailures = report.steps?.some((step) => step.state === 'failed')
  const pending = props.pending ?? false
  const responseModel = report.steps?.find(
    (step) => step.responseModel
  )?.responseModel
  const claim = verdict?.claim
  const claimLabels = {
    consistent: t('Tokenizer consistent with the selected model'),
    inconsistent: t('Tokenizer differs from the selected model'),
    uncertain: t('Tokenizer comparison inconclusive'),
  }
  const expected = claim?.expected?.length
    ? claim.expected.join(' / ')
    : claim?.vendor
      ? t('Unpublished {{vendor}} tokenizer', { vendor: claim.vendor })
      : undefined

  let status = t('Incomplete')
  let tone: 'neutral' | 'warning' | 'success' | 'info' = 'warning'
  if (pending) {
    status = t('In progress')
    tone = 'info'
  } else if (report.cancelled) {
    status = t('Cancelled')
  } else if (verdict && hasFailures) {
    status = t('Partial result')
  } else if (verdict?.kind === 'exact') {
    status = t('Tokenizer match')
    tone = 'success'
  } else if (verdict?.kind === 'related') {
    status = t('Related tokenizer')
    tone = 'neutral'
  } else if (verdict?.kind === 'unknown') {
    status = t('Not listed')
    tone = 'neutral'
  }

  const displayName =
    verdict?.kind === 'exact' && nearest ? nearest : t('Unlisted tokenizer')

  return (
    <section aria-labelledby={titleId}>
      <Collapsible>
        <Card className='gap-0 py-0'>
          <h3 id={titleId}>
            <CollapsibleTrigger
              render={
                <Button
                  type='button'
                  variant='ghost'
                  className='group h-auto w-full justify-start gap-2.5 rounded-xl px-3 py-3 text-start whitespace-normal sm:px-4'
                />
              }
            >
              <IconBadge tone='primary' size='sm'>
                <ScanText aria-hidden='true' />
              </IconBadge>
              <span className='min-w-0 flex-1'>
                <span className='block font-semibold'>
                  {t('Tokenizer probe')}
                </span>
                {verdict && !pending && (
                  <span className='text-muted-foreground block text-xs [overflow-wrap:anywhere]'>
                    {verdict.kind !== 'exact' && nearest
                      ? t('Nearest to {{tokenizer}}', { tokenizer: nearest })
                      : displayName}{' '}
                    · {percent.format(verdict.confidence)}
                  </span>
                )}
              </span>
              <StatusBadge
                label={status}
                variant={tone}
                copyable={false}
                className='h-auto max-w-28 py-1 text-xs whitespace-normal'
              />
              <ChevronDown
                data-icon='inline-end'
                aria-hidden='true'
                className='shrink-0 group-aria-expanded:rotate-180'
              />
            </CollapsibleTrigger>
          </h3>
          <CollapsibleContent className='min-w-0 border-t'>
            <CardContent className='space-y-4 px-3 py-4 sm:px-4'>
              {pending ? (
                <LoadingState
                  inline
                  size='sm'
                  message={t('Waiting for tokenizer probe results…')}
                />
              ) : (
                <>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'Tokenizer results use reported input token counts. The model ranking and its confidence are calculated independently.'
                    )}
                  </p>
                  {props.error && (
                    <Alert variant='destructive'>
                      <AlertDescription>{props.error}</AlertDescription>
                    </Alert>
                  )}
                  <div className='grid gap-3 @2xl/report:grid-cols-2'>
                    <div className='bg-muted/40 flex min-w-0 flex-wrap items-start justify-between gap-2 rounded-lg p-3'>
                      <div className='min-w-0'>
                        <p className='text-muted-foreground text-xs'>
                          {t('Upstream tokenizer')}
                        </p>
                        <p className='mt-1 text-base font-semibold [overflow-wrap:anywhere]'>
                          {verdict
                            ? displayName
                            : t('No tokenizer result was available.')}
                        </p>
                        {verdict && verdict.kind !== 'exact' && nearest && (
                          <p className='text-muted-foreground mt-1 text-xs'>
                            {t('Nearest to {{tokenizer}}', {
                              tokenizer: nearest,
                            })}
                          </p>
                        )}
                      </div>
                      {verdict && (
                        <div>
                          <p className='text-muted-foreground text-xs'>
                            {t('Confidence')}
                          </p>
                          <p className='mt-1 text-lg font-semibold tabular-nums'>
                            {percent.format(verdict.confidence)}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className='bg-muted/40 min-w-0 space-y-1 rounded-lg p-3 [overflow-wrap:anywhere]'>
                      <p className='text-muted-foreground text-xs'>
                        {t('Selected model')}
                      </p>
                      <p className='font-semibold'>{props.selectedModel}</p>
                      {verdict && (
                        <StatusBadge
                          label={claimLabels[claim?.status ?? 'uncertain']}
                          variant={
                            claim?.status === 'consistent'
                              ? 'success'
                              : 'warning'
                          }
                          copyable={false}
                          className='h-auto py-1 text-xs whitespace-normal'
                        />
                      )}
                      {expected && (
                        <p className='text-muted-foreground text-xs'>
                          {expected}
                        </p>
                      )}
                      {responseModel && (
                        <p className='text-muted-foreground text-xs'>
                          {t('Response model: {{model}}', {
                            model: responseModel,
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                  {report.baseline_drift && (
                    <Alert>
                      <AlertDescription>
                        {t(
                          'The upstream reported inconsistent baseline token counts.'
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                  <TokenizerEvidence report={report} />
                  {props.onRetry && (
                    <div className='flex justify-end'>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={props.onRetry}
                      >
                        {t('Retry tokenizer probe')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </section>
  )
}
