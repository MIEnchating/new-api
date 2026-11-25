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
import { Award, ChevronDown } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { IconBadge } from '@/components/ui/icon-badge'
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

export function ModelDetectionResults(props: { result: ModelDetectionResult }) {
  const { t, i18n } = useTranslation()
  const leaderId = useId()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const percent = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  })
  const result = props.result
  const round = result.rounds?.[0]
  const candidates = round?.analysis?.results ?? []
  const leader = candidates[0]

  return (
    <div className='@container/report min-w-0 space-y-2.5'>
      {result.upstream_status ? (
        <Alert>
          <AlertDescription>
            {t('The upstream returned HTTP {{status}}.', {
              status: result.upstream_status,
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      {leader && (
        <Card
          role='region'
          aria-labelledby={leaderId}
          className='bg-primary/5 ring-primary/20'
          size='sm'
        >
          <CardContent className='flex flex-col gap-4 @sm/report:flex-row @sm/report:items-center @sm/report:justify-between'>
            <div className='flex min-w-0 items-start gap-3'>
              <IconBadge tone='primary' size='title'>
                <Award aria-hidden='true' />
              </IconBadge>
              <div className='min-w-0 space-y-1'>
                <p id={leaderId} className='text-muted-foreground text-xs'>
                  {t('Top reference candidate')}
                </p>
                <h3 className='text-xl font-semibold tracking-tight [overflow-wrap:anywhere] @md/report:text-2xl'>
                  {leader.display_name || leader.model}
                </h3>
                {leader.family_name && (
                  <p className='text-muted-foreground text-sm'>
                    {leader.family_name}
                  </p>
                )}
              </div>
            </div>
            <div className='shrink-0 @sm/report:text-end'>
              <p className='text-primary text-3xl leading-none font-semibold tracking-tight tabular-nums @md/report:text-4xl'>
                {leader.probability == null
                  ? '—'
                  : percent.format(leader.probability)}
              </p>
              <p className='text-muted-foreground mt-1 text-xs'>
                {t('Confidence')}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {round &&
        (leader ? (
          <Collapsible>
            <h3>
              <CollapsibleTrigger
                render={
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='group w-full justify-between'
                  />
                }
              >
                {t('Candidate models')}
                <ChevronDown
                  aria-hidden='true'
                  className='group-aria-expanded:rotate-180'
                />
              </CollapsibleTrigger>
            </h3>
            <CollapsibleContent className='space-y-2 pt-2'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-9'>#</TableHead>
                    <TableHead>{t('Model')}</TableHead>
                    <TableHead className='text-end'>
                      {t('Confidence')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.slice(0, 5).map((candidate, index) => (
                    <TableRow
                      key={candidate.model}
                      className={
                        index === 0
                          ? 'bg-primary/5 hover:bg-primary/5'
                          : undefined
                      }
                    >
                      <TableCell className='text-muted-foreground tabular-nums'>
                        {formatNumber(index + 1, locale)}
                      </TableCell>
                      <TableCell className='min-w-0 [overflow-wrap:anywhere] whitespace-normal'>
                        <p
                          className={index === 0 ? 'font-semibold' : undefined}
                        >
                          {candidate.display_name || candidate.model}
                        </p>
                        {candidate.family_name && (
                          <p className='text-muted-foreground text-xs'>
                            {candidate.family_name}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className='w-24 @sm/report:w-42'>
                        <div className='flex items-center justify-end gap-2'>
                          {candidate.probability != null && (
                            <Progress
                              value={candidate.probability * 100}
                              aria-hidden='true'
                              className='hidden w-20 @sm/report:flex'
                            />
                          )}
                          <span className='min-w-12 text-end tabular-nums'>
                            {candidate.probability == null
                              ? '—'
                              : percent.format(candidate.probability)}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className='text-muted-foreground text-xs'>
                {t('Confidence compares models in the reference library.')}
              </p>
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <p className='text-muted-foreground text-sm'>
            {t('The samples could not be scored.')}
          </p>
        ))}
    </div>
  )
}
