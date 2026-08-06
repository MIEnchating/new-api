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
import { CalendarClock } from 'lucide-react'
import { useEffect, useState } from 'react'
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

interface DateTimePickerProps {
  value?: Date
  onChange?: (date: Date | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

function toTime(date: Date | undefined) {
  return date ? dayjs(date).format('HH:mm') : '00:00'
}

export function DateTimePicker({
  value,
  onChange,
  placeholder,
  className,
  disabled = false,
}: DateTimePickerProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Date | undefined>(value)
  const [time, setTime] = useState(toTime(value))
  const language = i18n.resolvedLanguage ?? i18n.language
  const calendarLocale = getCalendarLocale(language)
  const currentYear = new Date().getFullYear()

  useEffect(() => {
    setDraft(value)
    setTime(toTime(value))
  }, [value])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraft(value)
      setTime(toTime(value))
    }
    setOpen(nextOpen)
  }

  const mergeTime = (date: Date, nextTime: string) => {
    const [hours, minutes] = nextTime.split(':').map(Number)
    const next = new Date(date)
    next.setHours(hours, minutes, 0, 0)
    return next
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            disabled={disabled}
            className={cn(
              'w-full min-w-0 justify-start gap-2 px-2.5 font-normal tabular-nums',
              !value && 'text-muted-foreground',
              className
            )}
          />
        }
      >
        <CalendarClock className='text-muted-foreground size-4 shrink-0' />
        <span className='truncate'>
          {value
            ? `${dayjs(value).format(getDateFormat(language))} ${dayjs(value).format('HH:mm')}`
            : (placeholder ?? t('Select date'))}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        collisionPadding={8}
        className='w-auto max-w-[calc(100vw-1rem)] overflow-hidden p-0'
      >
        <Calendar
          mode='single'
          selected={draft}
          defaultMonth={draft ?? value}
          captionLayout='dropdown'
          onSelect={(selectedDate) =>
            setDraft(selectedDate ? mergeTime(selectedDate, time) : undefined)
          }
          locale={calendarLocale}
          startMonth={new Date(currentYear - 100, 0)}
          endMonth={new Date(currentYear + 100, 11)}
        />
        <div className='border-t p-3'>
          <div className='text-muted-foreground mb-1.5 text-xs'>
            {t('Time')}
          </div>
          <TimePicker
            value={time}
            disabled={!draft}
            onChange={(nextTime) => {
              setTime(nextTime)
              setDraft((current) =>
                current ? mergeTime(current, nextTime) : current
              )
            }}
          />
        </div>
        <div className='flex items-center justify-between border-t px-3 py-2.5'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => {
              setDraft(undefined)
              setTime('00:00')
              onChange?.(undefined)
              setOpen(false)
            }}
          >
            {t('Clear')}
          </Button>
          <Button
            type='button'
            size='sm'
            disabled={!draft}
            onClick={() => {
              onChange?.(draft)
              setOpen(false)
            }}
          >
            {t('Confirm')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
