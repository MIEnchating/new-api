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
/* eslint-disable no-nested-ternary */
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  CheckCircle2,
  Equal,
  Loader2,
  RefreshCcw,
  Shuffle,
  Snowflake,
} from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

import { getChannelExecutionPlan, getChannelExecutionOptions } from '../../api'
import { resolvePlanCandidateStatuses } from '../../lib/channel-execution-plan'

type ChannelExecutionPlanPanelProps = {
  active: boolean
  group: string
  model: string
  requestPath: string
  mode: 'route' | 'retry'
  onGroupChange: (value: string) => void
  onModelChange: (value: string) => void
  onRequestPathChange: (value: string) => void
  onModeChange: (value: 'route' | 'retry') => void
}

function queryErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    const responseMessage = (
      error as { response?: { data?: { message?: unknown } } }
    ).response?.data?.message
    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return fallback
}

export function ChannelExecutionPlanPanel(
  props: ChannelExecutionPlanPanelProps
) {
  const { t } = useTranslation()
  const channelsQuery = useQuery({
    queryKey: ['channel-execution-options'],
    queryFn: getChannelExecutionOptions,
    enabled: props.active,
    staleTime: 30_000,
  })
  const groups = useMemo(
    () => channelsQuery.data?.data?.groups ?? [],
    [channelsQuery.data?.data?.groups]
  )
  const selectedGroup = groups.find((item) => item.name === props.group)
  const models = useMemo(() => selectedGroup?.models ?? [], [selectedGroup])

  useEffect(() => {
    if (!props.active || groups.length === 0) return
    if (!groups.some((item) => item.name === props.group)) {
      props.onGroupChange(groups[0].name)
    }
  }, [groups, props])

  useEffect(() => {
    if (!props.active || models.length === 0) return
    if (!models.includes(props.model)) {
      props.onModelChange(models[0] ?? '')
    }
  }, [models, props])

  const planQuery = useQuery({
    queryKey: [
      'channel-execution-plan',
      props.group,
      props.model,
      props.requestPath,
      props.mode,
    ],
    queryFn: () =>
      getChannelExecutionPlan({
        group: props.group,
        model: props.model,
        path: props.requestPath.trim(),
        mode: props.mode,
      }),
    enabled: props.active && props.group !== '' && props.model !== '',
    retry: false,
  })

  const plan = planQuery.data?.data
  const planCandidateState = plan
    ? resolvePlanCandidateStatuses(plan)
    : undefined

  const content = (
    <section className='space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='space-y-0.5'>
          <h3 className='text-sm font-medium'>{t('Strategy preview')}</h3>
          <p className='text-muted-foreground text-xs'>
            {t(
              'The selected group determines the candidate channels and execution order'
            )}
          </p>
        </div>
        <div className='bg-muted inline-flex h-8 items-center rounded-md p-0.5'>
          <Button
            type='button'
            size='sm'
            variant={props.mode === 'route' ? 'secondary' : 'ghost'}
            className='h-7 rounded-sm px-3'
            onClick={() => props.onModeChange('route')}
          >
            {t('Channel routing')}
          </Button>
          <Button
            type='button'
            size='sm'
            variant={props.mode === 'retry' ? 'secondary' : 'ghost'}
            className='h-7 rounded-sm px-3'
            onClick={() => props.onModeChange('retry')}
          >
            {t('Traditional retry')}
          </Button>
        </div>
      </div>

      <div className='grid gap-3 sm:grid-cols-3'>
        <div className='space-y-1.5'>
          <Label>{t('Group')}</Label>
          <Select<string>
            value={props.group}
            items={groups.map((item) => ({
              value: item.name,
              label: item.name,
            }))}
            onValueChange={(value) =>
              value !== null && props.onGroupChange(value)
            }
          >
            <SelectTrigger className='w-full'>
              <SelectValue
                placeholder={
                  channelsQuery.isLoading
                    ? t('Loading groups...')
                    : t('Select group')
                }
              />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {groups.map((item) => (
                  <SelectItem key={item.name} value={item.name}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1.5'>
          <Label>{t('Model')}</Label>
          <Select<string>
            value={props.model}
            items={models.map((value) => ({ value, label: value }))}
            onValueChange={(value) =>
              value !== null && props.onModelChange(value)
            }
          >
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {models.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='route-execution-path'>{t('Path')}</Label>
          <Input
            id='route-execution-path'
            value={props.requestPath}
            onChange={(event) => props.onRequestPathChange(event.target.value)}
          />
        </div>
      </div>

      {planQuery.isLoading ? (
        <div className='text-muted-foreground flex h-20 items-center justify-center gap-2 text-sm'>
          <Loader2 className='size-4 animate-spin' />
          {t('Calculating execution plan...')}
        </div>
      ) : planQuery.isError ? (
        <div className='flex flex-wrap items-center justify-between gap-3 py-4'>
          <p className='text-destructive text-sm'>
            {queryErrorMessage(
              planQuery.error,
              t('Failed to load execution plan')
            )}
          </p>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => void planQuery.refetch()}
            disabled={planQuery.isFetching}
          >
            <RefreshCcw
              className={cn('size-3.5', planQuery.isFetching && 'animate-spin')}
            />
            {t('Retry')}
          </Button>
        </div>
      ) : planQuery.data && !planQuery.data.success ? (
        <p className='text-destructive py-4 text-sm'>
          {planQuery.data.message || t('Failed to load execution plan')}
        </p>
      ) : plan?.pools.length ? (
        <div className='space-y-3'>
          <div className='bg-muted/30 grid overflow-hidden rounded-md border sm:grid-cols-3 sm:divide-x'>
            <div className='flex min-w-0 items-center gap-2.5 border-b px-3 py-2.5 sm:border-b-0'>
              <div className='bg-background text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border'>
                <ArrowDown className='size-4' />
              </div>
              <div className='min-w-0'>
                <div className='text-xs font-medium'>{t('Priority')}</div>
                <div className='text-muted-foreground mt-0.5 text-xs'>
                  {t('Higher values are selected first')}
                </div>
              </div>
            </div>
            <div className='flex min-w-0 items-center gap-2.5 border-b px-3 py-2.5 sm:border-b-0'>
              <div className='bg-background text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border'>
                <Shuffle className='size-4' />
              </div>
              <div className='min-w-0'>
                <div className='text-xs font-medium'>{t('Same priority')}</div>
                <div className='text-muted-foreground mt-0.5 text-xs'>
                  {t('Random selection by weight')}
                </div>
              </div>
            </div>
            <div className='flex min-w-0 items-center gap-2.5 px-3 py-2.5'>
              <div className='bg-background text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border'>
                <Equal className='size-4' />
              </div>
              <div className='min-w-0'>
                <div className='text-xs font-medium'>
                  {t('All weights are 0')}
                </div>
                <div className='text-muted-foreground mt-0.5 text-xs'>
                  {t('Equal probability selection')}
                </div>
              </div>
            </div>
          </div>
          <div className='space-y-3'>
            {plan.pools.map((pool, index) => {
              return (
                <div
                  key={pool.priority}
                  className='overflow-hidden rounded-md border'
                >
                  <div className='bg-muted/30 flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5'>
                    <div className='flex min-w-0 items-center gap-2'>
                      <span className='text-sm font-medium'>
                        {t('Priority level {{level}}', {
                          level: index + 1,
                        })}
                      </span>
                      <StatusBadge variant='neutral' size='sm' copyable={false}>
                        {t('Priority')} {pool.priority}
                      </StatusBadge>
                    </div>
                    <span className='text-muted-foreground text-xs'>
                      {t('{{count}} candidate channels', {
                        count: pool.candidates.length,
                      })}
                    </span>
                  </div>
                  <div className='divide-y'>
                    <div className='text-muted-foreground bg-muted/10 hidden grid-cols-[minmax(0,1fr)_7rem_8rem] gap-3 px-3 py-1.5 text-[11px] sm:grid'>
                      <span>{t('Candidate channel')}</span>
                      <span>{t('Weight')}</span>
                      <span className='text-right'>{t('Status')}</span>
                    </div>
                    {pool.candidates.map((candidate) => {
                      const displayStatus =
                        planCandidateState?.statuses.get(
                          candidate.channel_id
                        ) ?? 'standby'
                      const candidateCooling = displayStatus === 'cooling'
                      const zeroWeightExcluded = displayStatus === 'excluded'
                      return (
                        <div
                          key={candidate.channel_id}
                          className={cn(
                            'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_8rem]',
                            (candidateCooling ||
                              zeroWeightExcluded ||
                              displayStatus === 'standby') &&
                              'bg-muted/20'
                          )}
                        >
                          <div className='flex min-w-0 items-center gap-2'>
                            <span className='bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px]'>
                              #{candidate.channel_id}
                            </span>
                            <span
                              className={cn(
                                'truncate text-sm font-medium',
                                (candidateCooling ||
                                  zeroWeightExcluded ||
                                  displayStatus === 'standby') &&
                                  'text-muted-foreground'
                              )}
                            >
                              {candidate.channel_name}
                            </span>
                          </div>
                          <div className='text-muted-foreground text-right text-xs sm:text-left'>
                            <span className='sm:hidden'>{t('Weight')} </span>
                            <span className='text-foreground font-medium'>
                              {candidate.weight}
                            </span>
                          </div>
                          <div className='col-span-2 flex sm:col-span-1 sm:justify-end'>
                            {candidateCooling ? (
                              <StatusBadge
                                variant='warning'
                                size='sm'
                                copyable={false}
                              >
                                <Snowflake className='size-3' />
                                {t('Cooling')}
                              </StatusBadge>
                            ) : zeroWeightExcluded ? (
                              <StatusBadge
                                variant='neutral'
                                size='sm'
                                copyable={false}
                              >
                                {t('Not selected')}
                              </StatusBadge>
                            ) : displayStatus === 'current' ? (
                              <StatusBadge
                                variant='success'
                                size='sm'
                                copyable={false}
                              >
                                <CheckCircle2 className='size-3' />
                                {t('Current selection')}
                              </StatusBadge>
                            ) : displayStatus === 'standby' ? (
                              <StatusBadge
                                variant='neutral'
                                size='sm'
                                copyable={false}
                              >
                                {t('Backup candidate')}
                              </StatusBadge>
                            ) : (
                              <StatusBadge
                                variant='info'
                                size='sm'
                                copyable={false}
                              >
                                <Shuffle className='size-3' />
                                {t('Eligible')}
                              </StatusBadge>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <p className='text-muted-foreground py-4 text-sm'>
          {t('No matching candidates')}
        </p>
      )}
    </section>
  )

  return content
}
