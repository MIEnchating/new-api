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
import { ArrowDown, ArrowUp, CalendarClock, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DatePicker } from '@/components/date-picker'
import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { TimePicker } from '@/components/time-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { WeekdayPicker } from '@/components/weekday-picker'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

import {
  getGroupRatioScheduleScope,
  isGroupRatioSchedulePeriodValid,
  parseGroupRatioSchedules,
  serializeGroupRatioSchedules,
  setGroupRatioScheduleScope,
  type GroupRatioSchedule,
  type GroupRatioSchedulePeriod,
  type GroupRatioScheduleScope,
} from './group-ratio-schedule'

type GroupRatioScheduleEditorProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupName: string
  baseRatio: number
  value: string
  onChange: (value: string) => void
}

function createPeriod(baseRatio: number): GroupRatioSchedulePeriod {
  return {
    start: '00:00',
    end: '23:59',
    ratio: baseRatio,
    enabled: true,
  }
}

function readSchedule(value: string, groupName: string): GroupRatioSchedule {
  const schedule = parseGroupRatioSchedules(value)[groupName]
  if (!schedule || !Array.isArray(schedule.periods)) {
    return { enabled: false, periods: [] }
  }
  return {
    enabled: schedule.enabled,
    periods: schedule.periods.map((period) => ({
      ...period,
      date: period.date || undefined,
      days: period.days?.length ? [...period.days] : undefined,
    })),
  }
}

export function GroupRatioScheduleEditor(props: GroupRatioScheduleEditorProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<GroupRatioSchedule>(() =>
    readSchedule(props.value, props.groupName)
  )

  useEffect(() => {
    if (props.open) setDraft(readSchedule(props.value, props.groupName))
  }, [props.groupName, props.open, props.value])

  const isValid = useMemo(
    () => draft.periods.every(isGroupRatioSchedulePeriodValid),
    [draft.periods]
  )

  const updatePeriod = (
    index: number,
    update: (period: GroupRatioSchedulePeriod) => GroupRatioSchedulePeriod
  ) => {
    setDraft((current) => ({
      ...current,
      periods: current.periods.map((period, periodIndex) =>
        periodIndex === index ? update(period) : period
      ),
    }))
  }

  const movePeriod = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= draft.periods.length) return
    setDraft((current) => {
      const periods = [...current.periods]
      ;[periods[index], periods[target]] = [periods[target], periods[index]]
      return { ...current, periods }
    })
  }

  const handleSave = () => {
    if (!isValid) return
    const schedules = parseGroupRatioSchedules(props.value)
    schedules[props.groupName] = draft
    props.onChange(serializeGroupRatioSchedules(schedules))
    props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <span className='flex items-center gap-2'>
          <CalendarClock className='text-primary size-5' />
          {t('Time-based ratio')}: {props.groupName}
        </span>
      }
      description={t(
        'Use the first enabled period that matches the current server time; otherwise use the base ratio.'
      )}
      contentClassName='sm:max-w-3xl'
      contentHeight='min(65vh, 42rem)'
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            {t('Save changes')}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <div className='bg-muted/35 flex items-center justify-between gap-4 rounded-lg border p-4'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='font-medium'>
                {t('Enable time-based ratio')}
              </span>
              <StatusBadge
                label={draft.enabled ? t('Enabled') : t('Disabled')}
                variant={draft.enabled ? 'success' : 'neutral'}
                copyable={false}
              />
            </div>
            <p className='text-muted-foreground mt-1 text-xs'>
              {t('Base ratio')}: {props.baseRatio}&times;
            </p>
          </div>
          <Switch
            checked={draft.enabled}
            onCheckedChange={(enabled) =>
              setDraft((current) => ({ ...current, enabled }))
            }
            aria-label={t('Enable time-based ratio')}
          />
        </div>

        <div className='flex items-center justify-between gap-3'>
          <div>
            <h3 className='text-sm font-medium'>{t('Ratio periods')}</h3>
            <p className='text-muted-foreground text-xs'>
              {t('{{count}} periods configured', {
                count: draft.periods.length,
              })}
            </p>
          </div>
          <Button
            type='button'
            size='sm'
            onClick={() =>
              setDraft((current) => ({
                ...current,
                periods: [...current.periods, createPeriod(props.baseRatio)],
              }))
            }
          >
            <Plus className='mr-2 size-4' />
            {t('Add period')}
          </Button>
        </div>

        {draft.periods.length === 0 ? (
          <div className='text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm'>
            {t('No ratio periods configured.')}
          </div>
        ) : (
          <div className='space-y-3'>
            {draft.periods.map((period, index) => {
              const scope = getGroupRatioScheduleScope(period)
              const periodValid = isGroupRatioSchedulePeriodValid(period)
              return (
                <div
                  key={index}
                  className={cn(
                    'rounded-lg border p-3 sm:p-4',
                    !periodValid && 'border-destructive/60'
                  )}
                >
                  <div className='mb-3 flex items-center justify-between gap-3'>
                    <div className='flex items-center gap-2'>
                      <span className='text-sm font-medium'>
                        {t('Period {{index}}', { index: index + 1 })}
                      </span>
                      <Switch
                        checked={period.enabled !== false}
                        onCheckedChange={(enabled) =>
                          updatePeriod(index, (current) => ({
                            ...current,
                            enabled,
                          }))
                        }
                        aria-label={t('Enable period')}
                      />
                    </div>
                    <div className='flex items-center gap-1'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        onClick={() => movePeriod(index, -1)}
                        disabled={index === 0}
                        aria-label={t('Move up')}
                      >
                        <ArrowUp className='size-4' />
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        onClick={() => movePeriod(index, 1)}
                        disabled={index === draft.periods.length - 1}
                        aria-label={t('Move down')}
                      >
                        <ArrowDown className='size-4' />
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            periods: current.periods.filter(
                              (_, periodIndex) => periodIndex !== index
                            ),
                          }))
                        }
                        aria-label={t('Delete period')}
                      >
                        <Trash2 className='size-4' />
                      </Button>
                    </div>
                  </div>

                  <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                    <div className='space-y-1.5 sm:col-span-2'>
                      <Label>{t('Applies on')}</Label>
                      <Select
                        value={scope}
                        items={[
                          { value: 'daily', label: t('Every day') },
                          {
                            value: 'weekdays',
                            label: t('Selected weekdays'),
                          },
                          { value: 'date', label: t('Specific date') },
                        ]}
                        onValueChange={(nextScope) =>
                          updatePeriod(index, (current) =>
                            setGroupRatioScheduleScope(
                              current,
                              nextScope as GroupRatioScheduleScope
                            )
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='daily'>
                            {t('Every day')}
                          </SelectItem>
                          <SelectItem value='weekdays'>
                            {t('Selected weekdays')}
                          </SelectItem>
                          <SelectItem value='date'>
                            {t('Specific date')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='space-y-1.5'>
                      <Label>{t('Start time')}</Label>
                      <TimePicker
                        value={period.start}
                        aria-label={t('Start time')}
                        onChange={(value) =>
                          updatePeriod(index, (current) => ({
                            ...current,
                            start: value,
                          }))
                        }
                      />
                    </div>
                    <div className='space-y-1.5'>
                      <Label>{t('End time')}</Label>
                      <TimePicker
                        value={period.end}
                        aria-label={t('End time')}
                        onChange={(value) =>
                          updatePeriod(index, (current) => ({
                            ...current,
                            end: value,
                          }))
                        }
                      />
                    </div>
                    {scope === 'date' && (
                      <div className='space-y-1.5 sm:col-span-2 lg:col-span-3'>
                        <Label>{t('Specific date')}</Label>
                        <DatePicker
                          selected={
                            period.date
                              ? new Date(`${period.date}T00:00:00`)
                              : undefined
                          }
                          onSelect={(date) =>
                            updatePeriod(index, (current) => ({
                              ...current,
                              date: date
                                ? dayjs(date).format('YYYY-MM-DD')
                                : undefined,
                            }))
                          }
                        />
                      </div>
                    )}
                    {scope === 'weekdays' && (
                      <div className='space-y-2 sm:col-span-2 lg:col-span-3'>
                        <WeekdayPicker
                          value={period.days || []}
                          onChange={(days) =>
                            updatePeriod(index, (current) => ({
                              ...current,
                              days,
                            }))
                          }
                        />
                      </div>
                    )}
                    <div className='space-y-1.5'>
                      <Label>{t('Target ratio')}</Label>
                      <div className='relative'>
                        <Input
                          type='number'
                          min={0}
                          step={0.01}
                          value={
                            Number.isFinite(period.ratio) ? period.ratio : ''
                          }
                          className='pr-8'
                          onChange={(event) =>
                            updatePeriod(index, (current) => ({
                              ...current,
                              ratio:
                                event.target.value === ''
                                  ? Number.NaN
                                  : Number(event.target.value),
                            }))
                          }
                        />
                        <span className='text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs'>
                          &times;
                        </span>
                      </div>
                    </div>
                  </div>
                  {!periodValid && (
                    <p className='text-destructive mt-2 text-xs'>
                      {t(
                        'Complete the time, scope, and ratio for this period.'
                      )}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Dialog>
  )
}
