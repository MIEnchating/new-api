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
  ChartNoAxesColumnIncreasing,
  Gift,
  PackageOpen,
  Sparkles,
  Trophy,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatCurrencyFromUSD } from '@/lib/currency'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { LotteryPrize } from './types'

function customPrizeName(prize: LotteryPrize): string | undefined {
  const name = prize.name?.trim()
  if (
    name &&
    name !== prize.type &&
    name !== `${prize.amount} USD` &&
    name !== 'No prize'
  ) {
    return name
  }
}

export function LotteryPrizeShowcase(props: {
  prizes: LotteryPrize[]
  pityEnabled: boolean
  drawing: boolean
  revealedQuota?: number
}) {
  const { t, i18n } = useTranslation()
  const reducedMotion = useReducedMotion()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const percent = new Intl.NumberFormat(locale, { style: 'percent' })
  const formatAmount = (amount: number) =>
    formatCurrencyFromUSD(amount, { locale, abbreviate: false })

  let grandPrize: LotteryPrize | undefined
  for (const prize of props.prizes) {
    if (prize.probability > 0 && prize.amount > (grandPrize?.amount ?? 0)) {
      grandPrize = prize
    }
  }
  const grandPrizeName = grandPrize && customPrizeName(grandPrize)
  const revealedQuota = props.revealedQuota
  const revealed = revealedQuota !== undefined
  const won = (revealedQuota ?? 0) > 0
  const restingPhase = revealed ? 'revealed' : 'idle'
  const phase = props.drawing ? 'drawing' : restingPhase
  const shaking = props.drawing && !reducedMotion
  let StageIcon = Trophy
  if (props.drawing) {
    StageIcon = Gift
  } else if (revealed) {
    StageIcon = won ? Sparkles : PackageOpen
  }

  return (
    <div
      className={cn(
        'to-card flex h-full min-w-0 flex-col rounded-2xl border bg-linear-to-br p-3.5 sm:p-4',
        props.drawing && 'border-primary/25 from-primary/10',
        !props.drawing &&
          grandPrize &&
          'border-amber-200/75 from-amber-50 dark:border-amber-300/20 dark:from-amber-950/45',
        !props.drawing && !grandPrize && 'border-border from-muted/50'
      )}
    >
      <div className='flex min-w-0 flex-wrap items-center justify-between gap-2'>
        {grandPrize && (
          <div className='flex min-w-0 flex-wrap items-baseline gap-x-2'>
            <h3 className='text-sm font-semibold [overflow-wrap:anywhere] text-amber-900 dark:text-amber-200'>
              {t('Grand prize')}
            </h3>
            {phase !== 'idle' && (
              <span className='text-muted-foreground text-sm font-medium [overflow-wrap:anywhere] tabular-nums'>
                {formatAmount(grandPrize.amount)}
              </span>
            )}
          </div>
        )}
        <Dialog
          title={t('Draw probabilities')}
          description={
            <>
              {t(
                'These are the base odds for each draw, including no-prize outcomes.'
              )}
              {props.pityEnabled && (
                <>
                  {' '}
                  {t(
                    'When the guarantee triggers, the draw awards the highest-value prize with a positive probability.'
                  )}
                </>
              )}
            </>
          }
          headerClassName='pr-6'
          trigger={
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='bg-background/80 ms-auto h-auto min-h-9 max-w-full rounded-lg px-2.5 py-1.5 text-xs [overflow-wrap:anywhere] whitespace-normal'
            >
              <ChartNoAxesColumnIncreasing aria-hidden='true' />
              {t('Draw probabilities')}
            </Button>
          }
        >
          <StaticDataTable
            data={props.prizes}
            getRowKey={(prize) => prize.type}
            tableProps={{ 'aria-label': t('Draw probabilities') }}
            columns={[
              {
                id: 'prize',
                header: t('Prize'),
                cellClassName: 'whitespace-normal break-words',
                cell: (prize) => {
                  const reward =
                    prize.amount > 0
                      ? formatAmount(prize.amount)
                      : t('No prize')
                  const name = customPrizeName(prize)
                  return name ? (
                    <>
                      <div>{name}</div>
                      <div className='text-muted-foreground text-xs'>
                        {reward}
                      </div>
                    </>
                  ) : (
                    reward
                  )
                },
              },
              {
                id: 'probability',
                header: t('Probability'),
                className: 'text-end',
                cellClassName: 'text-end tabular-nums',
                cell: (prize) => percent.format(prize.probability / 100),
              },
            ]}
          />
        </Dialog>
      </div>
      {(grandPrize || phase !== 'idle') && (
        <div
          className='flex min-h-24 w-full flex-1 items-center justify-center gap-4 px-1 pt-2 sm:gap-6 @min-[46rem]/lottery:min-h-36'
          data-testid='lottery-prize-stage'
          data-state={phase}
          aria-busy={props.drawing}
        >
          <div className='relative isolate shrink-0'>
            <div
              aria-hidden='true'
              className={cn(
                'pointer-events-none absolute -inset-1.5 -z-10 rounded-[1.15rem] border sm:-inset-2 sm:rounded-3xl',
                props.drawing
                  ? 'border-primary/20'
                  : 'border-amber-300/55 dark:border-amber-300/20'
              )}
            />
            <motion.div
              key={phase}
              aria-hidden='true'
              data-testid='lottery-prize-emblem'
              initial={
                revealed && !reducedMotion
                  ? { opacity: 0, scale: 0.72, y: 8 }
                  : false
              }
              animate={
                shaking
                  ? {
                      rotate: [0, -12, 11, -7, 6, 0],
                      y: [0, -5, -10, -5, -2, 0],
                    }
                  : { opacity: 1, scale: 1, y: 0 }
              }
              transition={
                shaking
                  ? { duration: 0.82, repeat: Infinity }
                  : { duration: reducedMotion ? 0 : 0.32 }
              }
            >
              <IconBadge
                tone={props.drawing ? 'primary' : 'warning'}
                className={cn(
                  'size-14 rounded-2xl ring-1 ring-inset sm:size-[4.5rem] [&>svg]:size-7 sm:[&>svg]:size-9',
                  props.drawing
                    ? 'ring-primary/25'
                    : 'bg-amber-100/90 text-amber-800 ring-amber-400/30 dark:bg-amber-300/10 dark:text-amber-300'
                )}
              >
                <StageIcon />
              </IconBadge>
            </motion.div>
          </div>
          {props.drawing ? (
            <p className='text-primary min-w-0 text-base font-semibold [overflow-wrap:anywhere] sm:text-lg'>
              {t('Drawing...')}
            </p>
          ) : revealedQuota !== undefined ? (
            <div className='motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 min-w-0 motion-safe:duration-300'>
              <h3 className='text-muted-foreground text-xs font-medium'>
                {t('Result')}
              </h3>
              <p
                className={cn(
                  'mt-0.5 font-semibold tracking-tight [overflow-wrap:anywhere] tabular-nums',
                  won ? 'text-3xl sm:text-5xl' : 'text-lg sm:text-2xl'
                )}
              >
                {won ? formatQuota(revealedQuota) : t('No prize this time')}
              </p>
            </div>
          ) : grandPrize ? (
            <div className='min-w-0'>
              <p className='text-4xl leading-none font-semibold tracking-tight [overflow-wrap:anywhere] tabular-nums sm:text-6xl'>
                {formatAmount(grandPrize.amount)}
              </p>
              {grandPrizeName && (
                <p className='text-muted-foreground mt-1.5 text-sm [overflow-wrap:anywhere]'>
                  {grandPrizeName}
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
