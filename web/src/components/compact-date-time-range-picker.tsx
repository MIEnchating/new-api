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
import { CalendarDays, Clock3 } from 'lucide-react'
import { type ComponentProps, useMemo, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { useTranslation } from 'react-i18next'

import {
  getCalendarLocale,
  getDateFormat,
} from '@/components/date-time-picker-utils'
import { TimePicker } from '@/components/time-picker'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

interface CompactDateTimeRangePickerProps {
  start?: Date
  end?: Date
  onChange: (range: { start?: Date; end?: Date }) => void
  className?: string
}

function mergeDateAndTime(
  date: Date,
  timeSource: Date | undefined,
  fallbackHour: number,
  fallbackMinute: number
) {
  const next = new Date(date)
  next.setHours(
    timeSource?.getHours() ?? fallbackHour,
    timeSource?.getMinutes() ?? fallbackMinute,
    0,
    0
  )
  return next
}

export function CompactDateTimeRangePicker({
  start,
  end,
  onChange,
  className,
}: CompactDateTimeRangePickerProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draftStart, setDraftStart] = useState<Date | undefined>(start)
  const [draftEnd, setDraftEnd] = useState<Date | undefined>(end)

  const calendarLocale = getCalendarLocale(
    i18n.resolvedLanguage ?? i18n.language
  )
  const dateFormat = getDateFormat(i18n.resolvedLanguage ?? i18n.language)

  const label = useMemo(() => {
    if (!start && !end) return t('Date Range')
    const startText = start ? dayjs(start).format(`${dateFormat} HH:mm`) : '-'
    const endText = end ? dayjs(end).format(`${dateFormat} HH:mm`) : '-'
    return `${startText} ~ ${endText}`
  }, [dateFormat, end, start, t])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftStart(start)
      setDraftEnd(end)
    }
    setOpen(nextOpen)
  }

  const applyDraft = () => {
    onChange({ start: draftStart, end: draftEnd })
    setOpen(false)
  }

  const handleDateSelect = (range: DateRange | undefined) => {
    if (!range?.from) {
      setDraftStart(undefined)
      setDraftEnd(undefined)
      return
    }

    setDraftStart(mergeDateAndTime(range.from, draftStart, 0, 0))
    setDraftEnd(
      range.to ? mergeDateAndTime(range.to, draftEnd, 23, 59) : undefined
    )
  }

  const updateTime = (target: 'start' | 'end', value: string) => {
    const current = target === 'start' ? draftStart : draftEnd
    if (!current) return
    const next = new Date(current)
    const [hours, minutes] = value.split(':').map(Number)
    next.setHours(hours, minutes, 0, 0)
    if (target === 'start') setDraftStart(next)
    else setDraftEnd(next)
  }

  const applyPreset = (kind: 'today' | '7d' | 'week' | '30d' | 'month') => {
    const now = dayjs()
    const presets = {
      today: {
        start: now.startOf('day').toDate(),
        end: now.endOf('day').toDate(),
      },
      '7d': {
        start: now.subtract(6, 'day').startOf('day').toDate(),
        end: now.endOf('day').toDate(),
      },
      week: {
        start: now.startOf('week').toDate(),
        end: now.endOf('week').toDate(),
      },
      '30d': {
        start: now.subtract(29, 'day').startOf('day').toDate(),
        end: now.endOf('day').toDate(),
      },
      month: {
        start: now.startOf('month').toDate(),
        end: now.endOf('month').toDate(),
      },
    }
    const range = presets[kind]
    setDraftStart(range.start)
    setDraftEnd(range.end)
    onChange(range)
    setOpen(false)
  }

  const selectedRange =
    draftStart || draftEnd ? { from: draftStart, to: draftEnd } : undefined
  const invalidRange =
    draftStart && draftEnd && draftEnd.getTime() < draftStart.getTime()

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            className={cn(
              'w-full justify-start gap-2 px-2.5 text-sm leading-5 font-normal tabular-nums',
              !start && !end && 'text-muted-foreground',
              className
            )}
          />
        }
      >
        <CalendarDays className='text-muted-foreground size-4 shrink-0' />
        <span className='truncate'>{label}</span>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        collisionAvoidance={{ side: 'shift', align: 'shift' }}
        collisionPadding={8}
        className='max-h-[calc(100dvh-1rem)] w-[min(36rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain p-0 sm:max-h-[min(680px,calc(100dvh-2rem))] sm:w-[min(36rem,calc(100vw-2rem))]'
      >
        <div className='grid sm:grid-cols-[16rem_minmax(0,1fr)]'>
          <div className='flex justify-center border-b p-2 sm:border-r sm:border-b-0 sm:p-3'>
            <Calendar
              mode='range'
              selected={selectedRange}
              onSelect={handleDateSelect}
              defaultMonth={draftStart ?? draftEnd}
              locale={calendarLocale}
              numberOfMonths={1}
              className='max-sm:p-0'
              classNames={{
                day_button:
                  'group-data-[focused=true]/day:border-0 group-data-[focused=true]/day:ring-0 focus-visible:ring-0',
              }}
            />
          </div>

          <div className='min-w-0 p-3 sm:flex sm:flex-col sm:justify-center sm:p-4'>
            <div className='flex items-center gap-2 pb-2 sm:pb-3'>
              <Clock3 className='text-muted-foreground size-4' />
              <span className='text-sm font-medium'>{t('Time')}</span>
            </div>

            <div
              data-mobile-time-grid
              className='grid grid-cols-2 gap-3 sm:block sm:space-y-3'
            >
              <div className='space-y-1.5'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-muted-foreground text-xs'>
                    {t('Start Time')}
                  </span>
                  <span className='text-xs font-medium tabular-nums'>
                    {draftStart
                      ? dayjs(draftStart).format(dateFormat)
                      : t('Select date')}
                  </span>
                </div>
                <TimeSelectRow
                  value={draftStart}
                  disabled={!draftStart}
                  onChange={(value) => updateTime('start', value)}
                />
              </div>

              <div className='space-y-1.5'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-muted-foreground text-xs'>
                    {t('End Time')}
                  </span>
                  <span className='text-xs font-medium tabular-nums'>
                    {draftEnd
                      ? dayjs(draftEnd).format(dateFormat)
                      : t('Select date')}
                  </span>
                </div>
                <TimeSelectRow
                  value={draftEnd}
                  disabled={!draftEnd}
                  onChange={(value) => updateTime('end', value)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className='border-t px-3 py-2.5 sm:px-4 sm:py-3'>
          <div className='text-muted-foreground mb-1.5 text-xs sm:mb-2'>
            {t('Quick ranges')}
          </div>
          <div
            data-mobile-preset-grid
            className='grid grid-cols-3 gap-1.5 sm:grid-cols-5'
          >
            <PresetButton onClick={() => applyPreset('today')}>
              {t('Today')}
            </PresetButton>
            <PresetButton onClick={() => applyPreset('7d')}>
              {t('7 Days')}
            </PresetButton>
            <PresetButton onClick={() => applyPreset('week')}>
              {t('This week')}
            </PresetButton>
            <PresetButton onClick={() => applyPreset('30d')}>
              {t('30 Days')}
            </PresetButton>
            <PresetButton
              className='col-span-2 sm:col-span-1'
              onClick={() => applyPreset('month')}
            >
              {t('This month')}
            </PresetButton>
          </div>
        </div>

        <div className='flex items-center justify-between border-t px-3 py-2 sm:px-4 sm:py-3'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-8 px-2'
            onClick={() => {
              setDraftStart(undefined)
              setDraftEnd(undefined)
            }}
          >
            {t('Clear')}
          </Button>
          <Button
            type='button'
            size='sm'
            className='h-8'
            disabled={Boolean(invalidRange)}
            onClick={applyDraft}
          >
            {t('Confirm')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface TimeSelectRowProps {
  value?: Date
  disabled: boolean
  onChange: (value: string) => void
}

function TimeSelectRow({ value, disabled, onChange }: TimeSelectRowProps) {
  return (
    <TimePicker
      value={value ? dayjs(value).format('HH:mm') : '00:00'}
      disabled={disabled}
      showIcon={false}
      onChange={onChange}
    />
  )
}

function PresetButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type='button'
      variant='secondary'
      size='sm'
      className={cn('h-7 px-2 text-xs', className)}
      {...props}
    />
  )
}
