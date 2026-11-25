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
import { Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { ModelDetectionResult } from './api'

export function TokenizerEvidence(props: {
  report: NonNullable<ModelDetectionResult['tokenizer']>
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const percent = new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  const steps = props.report.steps ?? []
  const baseline = steps.find(
    (step) => step.probe === null && step.state === 'done'
  )?.tokens
  const knownClasses = props.report.verdict
    ? (props.report.classes ?? []).slice(0, 6)
    : []
  const candidates = knownClasses.map((candidate, index) => ({
    key: candidate.id,
    rank: formatNumber(index + 1, locale),
    name: candidate.series || candidate.id,
    lab: candidate.lab_name,
    probability: candidate.exact,
  }))
  if (props.report.verdict && props.report.unknown != null) {
    candidates.push({
      key: 'unlisted',
      rank: '—',
      name: t('Unlisted tokenizer'),
      lab: undefined,
      probability: props.report.unknown,
    })
  }

  const categories: Record<string, string> = {
    cjk: t('Chinese'),
    cjk_rare: t('Chinese'),
    indic: t('Indic scripts'),
    devanagari: t('Indic scripts'),
    sea: t('Southeast Asian scripts'),
    thai: t('Southeast Asian scripts'),
    symbol: t('Symbols'),
  }
  const duration = props.report.duration_ms

  return (
    <>
      {(candidates.length > 0 || steps.length > 0) && (
        <div className='grid gap-4 @3xl/report:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]'>
          {candidates.length > 0 && (
            <div className='min-w-0 space-y-2'>
              <div className='flex flex-wrap items-baseline justify-between gap-2'>
                <h4 className='font-medium'>{t('Candidate tokenizers')}</h4>
                {props.report.bank && knownClasses.length > 0 && (
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {t('{{shown}} of {{total}} classes', {
                      shown: formatNumber(knownClasses.length, locale),
                      total: formatNumber(props.report.bank.classes, locale),
                    })}
                  </span>
                )}
              </div>
              <ol className='divide-y border-y'>
                {candidates.map((candidate) => (
                  <li
                    key={candidate.key}
                    className='grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 py-2'
                  >
                    <span className='text-muted-foreground w-5 text-xs tabular-nums'>
                      {candidate.rank}
                    </span>
                    <div className='min-w-0 [overflow-wrap:anywhere]'>
                      <p className='text-xs font-medium'>{candidate.name}</p>
                      {candidate.lab && (
                        <p className='text-muted-foreground text-xs'>
                          {candidate.lab}
                        </p>
                      )}
                    </div>
                    <div className='flex items-center gap-2'>
                      {candidate.probability != null && (
                        <Progress
                          aria-hidden='true'
                          value={candidate.probability * 100}
                          className='hidden w-14 @sm/report:flex'
                        />
                      )}
                      <span className='min-w-11 text-end text-xs tabular-nums'>
                        {candidate.probability == null
                          ? '—'
                          : percent.format(candidate.probability)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {steps.length > 0 && (
            <div className='min-w-0 space-y-2'>
              <div className='flex flex-wrap items-baseline justify-between gap-2'>
                <h4 className='font-medium'>{t('Request log')}</h4>
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {formatNumber(steps.length, locale)} {t('Requests')}
                </span>
              </div>
              <ol
                aria-label={t('Request log')}
                className='max-h-64 divide-y overflow-y-auto border-y'
                tabIndex={0}
              >
                {steps.map((step, index) => {
                  const category = step.category
                    ? categories[step.category]
                    : undefined
                  const delta =
                    step.probe != null &&
                    step.tokens != null &&
                    baseline != null
                      ? step.tokens - baseline
                      : undefined
                  return (
                    <li
                      key={index}
                      className='grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 py-2 pe-2'
                    >
                      <div className='min-w-0 space-y-1'>
                        <div className='flex items-start gap-1.5'>
                          {step.state === 'done' && (
                            <Check
                              aria-hidden='true'
                              className='text-success mt-0.5 size-3 shrink-0'
                            />
                          )}
                          <p className='text-xs font-medium [overflow-wrap:anywhere]'>
                            {step.probe == null
                              ? t('Baseline request')
                              : category || step.probe}
                          </p>
                        </div>
                        {step.text && (
                          <p className='text-muted-foreground text-xs [overflow-wrap:anywhere]'>
                            {step.text}
                          </p>
                        )}
                      </div>
                      <div className='flex items-center justify-end gap-2 text-xs tabular-nums'>
                        {step.tokens != null && (
                          <span>{formatNumber(step.tokens, locale)}</span>
                        )}
                        {delta != null && (
                          <span className='text-muted-foreground'>
                            {delta > 0 ? '+' : ''}
                            {formatNumber(delta, locale)}
                          </span>
                        )}
                        {step.tokens == null && (
                          <StatusBadge
                            label={
                              step.state === 'failed'
                                ? t('Failed')
                                : t('Incomplete')
                            }
                            variant='warning'
                            copyable={false}
                          />
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
        </div>
      )}
      {duration != null && (
        <p className='text-muted-foreground text-xs tabular-nums'>
          {t('Duration')} ·{' '}
          {t('{{value}} seconds', {
            value: formatNumber(Math.round(duration / 100) / 10, locale),
          })}
        </p>
      )}
      <div className='space-y-1'>
        {steps.some((step) => step.tokens != null) && (
          <Collapsible>
            <CollapsibleTrigger className='group flex items-center gap-1 py-1 text-start text-sm'>
              <ChevronDown
                aria-hidden='true'
                className='size-4 group-aria-expanded:rotate-180'
              />
              {t('Probe text counts')}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Test text')}</TableHead>
                    <TableHead className='text-end'>
                      {t('Input tokens')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {steps.map((step, index) => (
                    <TableRow key={index}>
                      <TableCell className='[overflow-wrap:anywhere] whitespace-normal'>
                        {step.probe == null
                          ? t('Baseline request')
                          : step.text || step.probe}
                      </TableCell>
                      <TableCell className='text-end tabular-nums'>
                        {step.tokens == null
                          ? '—'
                          : formatNumber(step.tokens, locale)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CollapsibleContent>
          </Collapsible>
        )}
        <Collapsible>
          <CollapsibleTrigger className='group flex items-center gap-1 py-1 text-start text-sm'>
            <ChevronDown
              aria-hidden='true'
              className='size-4 group-aria-expanded:rotate-180'
            />
            {t('How to read this result')}
          </CollapsibleTrigger>
          <CollapsibleContent className='text-muted-foreground ps-5 text-xs'>
            {t(
              'Several models can share the same tokenizer. The nearest class is a comparison to the reference library.'
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </>
  )
}
