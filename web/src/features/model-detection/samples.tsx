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
import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { ModelDetectionChallenge, ModelDetectionSample } from './api'

function SampleCard(props: {
  index: number
  challenge?: ModelDetectionChallenge
  sample?: ModelDetectionSample
  sampling: boolean
  preparing: boolean
}) {
  const { t, i18n } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  let status = t('Waiting to sample')
  if (props.preparing) status = t('Preparing samples…')
  if (props.sampling) status = t('Sampling…')
  if (props.sample?.state === 'complete') status = t('Completed')
  if (props.sample?.state === 'truncated' || props.sample?.state === 'capped') {
    status = t('Truncated')
  }
  if (props.sample?.state === 'failed') status = t('Failed')
  if (props.sample?.state === 'cancelled') status = t('Cancelled')

  const prompt = props.challenge?.prompt
  const total = props.challenge?.expected_count
  const sample = props.sample
  const count = formatNumber(sample?.count ?? 0, locale)
  const metrics = [
    !sample && total != null
      ? t('{{received}} / {{total}} numbers', {
          received: count,
          total: formatNumber(total, locale),
        })
      : t('{{value}} numbers', { value: count }),
  ]
  if (sample) {
    const seconds = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })
    if (
      sample.startedAt != null &&
      sample.finishedAt != null &&
      sample.finishedAt >= sample.startedAt
    ) {
      metrics.push(
        t('{{value}} seconds', {
          value: seconds.format((sample.finishedAt - sample.startedAt) / 1000),
        })
      )
    }
    if (sample.throughput) {
      const ttft = t('{{value}} seconds', {
        value: seconds.format(sample.throughput.ttftMs / 1000),
      })
      metrics.push(`${t('First token')} ${ttft}`)
      if (sample.throughput.tokensPerSecond != null) {
        const rate = formatNumber(
          Math.round(sample.throughput.tokensPerSecond),
          locale
        )
        metrics.push(`${sample.throughput.estimated ? '≈' : ''}${rate} tok/s`)
      }
    }
  }

  return (
    <Card size='sm' className='min-w-0 gap-0'>
      <CardHeader className='pb-1'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <CardTitle>
            <h3>
              {t('Sample {{number}}', {
                number: formatNumber(props.index + 1, locale),
              })}
            </h3>
          </CardTitle>
          <Badge
            variant={
              props.sample?.state === 'failed' ? 'destructive' : 'secondary'
            }
          >
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className='flex flex-1 flex-col gap-2.5'>
        <div className='space-y-1 border-t pt-1.5'>
          <div className='flex items-center justify-between gap-2'>
            <h4 className='text-muted-foreground text-xs font-medium'>
              {t('Sample prompt')}
            </h4>
            {prompt && (
              <CopyButton
                size='sm'
                value={prompt}
                aria-label={t('Copy prompt')}
              />
            )}
          </div>
          {prompt ? (
            <Collapsible open={expanded} onOpenChange={setExpanded}>
              <div className='bg-muted/45 rounded-md px-2.5 py-1.5'>
                {!expanded && (
                  <p className='line-clamp-2 leading-5 break-words whitespace-pre-wrap'>
                    {prompt}
                  </p>
                )}
                <CollapsibleContent>
                  <p className='leading-5 break-words whitespace-pre-wrap'>
                    {prompt}
                  </p>
                </CollapsibleContent>
              </div>
              <CollapsibleTrigger
                type='button'
                render={
                  <Button variant='ghost' size='sm' className='group mt-1' />
                }
              >
                {expanded ? t('Collapse') : t('Expand')}
                <ChevronDown
                  aria-hidden='true'
                  className='group-data-[panel-open]:rotate-180'
                />
              </CollapsibleTrigger>
            </Collapsible>
          ) : (
            <p className='bg-muted/45 text-muted-foreground min-h-19 rounded-md px-2.5 py-2 text-xs'>
              {props.preparing ? t('Preparing samples…') : '—'}
            </p>
          )}
        </div>
        <div className='mt-auto space-y-1.5 border-t pt-2'>
          <h4 className='text-muted-foreground text-xs font-medium'>
            {t('Sample response')}
          </h4>
          {sample?.text ? (
            <pre
              className='bg-muted/45 max-h-48 min-h-20 overflow-auto rounded-md px-2.5 py-2 text-xs leading-5 break-words whitespace-pre-wrap sm:[@media(min-height:750px)]:min-h-28'
              tabIndex={0}
            >
              {sample.text}
            </pre>
          ) : (
            <div className='text-muted-foreground bg-muted/20 flex min-h-20 items-center justify-center rounded-md border border-dashed bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] bg-size-[12px_12px] px-2 text-center text-xs sm:[@media(min-height:750px)]:min-h-28'>
              {sample ? '—' : status}
            </div>
          )}
          <p className='text-muted-foreground pt-1 text-xs tabular-nums'>
            {metrics.join(' · ')}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export function DetectionSamples(props: {
  challenges?: ModelDetectionChallenge[]
  samples?: ModelDetectionSample[]
  sampling?: boolean
  preparing?: boolean
  tokenizer?: ReactElement
}) {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const sampleCards = [0, 1, 2].map((index) => ({
    index,
    key: props.challenges?.[index]?.id || String(index),
    challenge: props.challenges?.[index],
    sample: props.samples?.[index],
    sampling: props.sampling ?? false,
    preparing: props.preparing ?? false,
  }))

  return (
    <section
      aria-labelledby={titleId}
      className='@container/samples space-y-2.5'
    >
      <h2 id={titleId} className='text-base font-semibold'>
        {t('Detection samples')}
      </h2>
      {props.samples?.length ? (
        <Accordion
          className={cn(
            'grid gap-3 @2xl/samples:[&>[data-slot=accordion-item]>:first-child]:row-start-1 [&>[data-slot=accordion-item]>[data-slot=accordion-content]]:col-span-full',
            props.tokenizer
              ? '@2xl/samples:grid-cols-4'
              : '@2xl/samples:grid-cols-3'
          )}
        >
          {sampleCards.map(({ key, ...card }) => (
            <AccordionItem
              key={key}
              value={`sample-${key}`}
              className='contents'
            >
              <AccordionTrigger className='border-border bg-card hover:bg-muted/40 w-full items-center px-3 hover:no-underline'>
                <span className='min-w-0'>
                  {t('Sample {{number}}', {
                    number: formatNumber(card.index + 1, locale),
                  })}
                  {card.sample && (
                    <>
                      <span aria-hidden='true'>{' · '}</span>
                      <span className='text-muted-foreground tabular-nums'>
                        {t('{{value}} numbers', {
                          value: formatNumber(card.sample.count, locale),
                        })}
                      </span>
                    </>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent className='px-px pb-px'>
                <SampleCard {...card} />
              </AccordionContent>
            </AccordionItem>
          ))}
          {props.tokenizer}
        </Accordion>
      ) : (
        <div className='grid gap-3 @2xl/samples:grid-cols-3'>
          {sampleCards.map(({ key, ...card }) => (
            <SampleCard key={key} {...card} />
          ))}
          {props.tokenizer && (
            <Accordion className='col-span-full'>{props.tokenizer}</Accordion>
          )}
        </div>
      )}
    </section>
  )
}
