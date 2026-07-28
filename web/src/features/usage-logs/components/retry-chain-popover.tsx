/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Check, GitBranch, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import { buildRetryChainView, type RetryChainStep } from '../lib/retry-chain'

type RetryChainPopoverProps = {
  channelIds: Array<number | string>
  logType: number
  retryIntermediate: boolean
}

function transitionLabel(
  step: RetryChainStep,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (step.transition === 'initial') return t('Initial request')
  if (step.transition === 'channel-switch') return t('Switched channel')
  return `${t('Same-channel retry')} ${step.sameChannelRetry}`
}

export function RetryChainPopover(props: RetryChainPopoverProps) {
  const { t } = useTranslation()
  const view = buildRetryChainView(
    props.channelIds,
    props.logType,
    props.retryIntermediate
  )
  const outcomeConfig: Record<
    typeof view.outcome,
    { label: string; variant: StatusVariant }
  > = {
    succeeded: { label: t('Succeeded'), variant: 'success' },
    retrying: { label: t('Retry continues'), variant: 'warning' },
    failed: { label: t('Final failure'), variant: 'danger' },
  }

  if (view.steps.length <= 1) return null

  const outcome = outcomeConfig[view.outcome]

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type='button'
            className='text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-5 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none'
            aria-label={t('Retry Chain')}
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <GitBranch className='size-3.5 text-amber-500' aria-hidden='true' />
      </PopoverTrigger>
      <PopoverContent
        side='top'
        align='start'
        className='w-80 overflow-hidden p-0'
      >
        <div className='bg-muted/25 flex items-start justify-between gap-3 border-b px-3 py-2.5'>
          <div className='min-w-0'>
            <p className='text-sm font-medium'>{t('Retry Chain')}</p>
            <p className='text-muted-foreground mt-0.5 text-xs'>
              {t('Attempt {{count}}', { count: view.steps.length })}
            </p>
          </div>
          <StatusBadge
            label={outcome.label}
            variant={outcome.variant}
            size='sm'
            copyable={false}
          />
        </div>

        <ol className='max-h-72 overflow-y-auto px-3 py-2'>
          {view.steps.map((step, index) => {
            const succeeded = step.status === 'succeeded'
            const StepIcon = succeeded ? Check : X

            return (
              <li
                key={`${step.attempt}-${step.channelId}`}
                className='grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-2'
              >
                <div className='relative flex justify-center'>
                  {index < view.steps.length - 1 ? (
                    <span className='bg-border absolute top-5 bottom-0 w-px' />
                  ) : null}
                  <span
                    className={cn(
                      'bg-background z-10 mt-0.5 flex size-5 items-center justify-center rounded-full border',
                      succeeded
                        ? 'border-success/40 text-success'
                        : 'border-destructive/40 text-destructive'
                    )}
                  >
                    <StepIcon className='size-3' aria-hidden='true' />
                  </span>
                </div>

                <div className='min-w-0 pb-3'>
                  <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
                    <span className='text-xs font-medium'>
                      {transitionLabel(step, t)}
                    </span>
                    {step.current ? (
                      <StatusBadge
                        label={t('Current')}
                        variant='info'
                        size='sm'
                        copyable={false}
                        className='h-4 px-1 text-[10px]'
                      />
                    ) : null}
                  </div>
                  <span className='text-muted-foreground mt-1 block font-mono text-[11px]'>
                    {t('Attempt {{count}}', { count: step.attempt })}
                  </span>
                </div>

                <div className='flex items-start gap-1.5 pb-3'>
                  <StatusBadge
                    label={`#${step.channelId}`}
                    autoColor={step.channelId}
                    size='sm'
                    copyable={false}
                    className='font-mono'
                  />
                  <span
                    className={cn(
                      'pt-0.5 text-[11px] font-medium whitespace-nowrap',
                      succeeded ? 'text-success' : 'text-destructive'
                    )}
                  >
                    {t(succeeded ? 'Succeeded' : 'Failed')}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      </PopoverContent>
    </Popover>
  )
}
