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
import { CalendarDays, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getCalendarLocale,
  getDateFormat,
} from '@/components/date-time-picker-utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

type DatePickerProps = {
  selected: Date | undefined
  onSelect: (date: Date | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  fromDate?: Date
  toDate?: Date
}

export function DatePicker({
  selected,
  onSelect,
  placeholder,
  className,
  disabled = false,
  fromDate,
  toDate,
}: DatePickerProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const language = i18n.resolvedLanguage ?? i18n.language
  const calendarLocale = getCalendarLocale(language)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            disabled={disabled}
            data-empty={!selected}
            className={cn(
              'data-[empty=true]:text-muted-foreground w-full min-w-0 justify-start gap-2 px-2.5 text-start font-normal tabular-nums',
              className
            )}
          />
        }
      >
        <CalendarDays className='text-muted-foreground size-4 shrink-0' />
        <span className='min-w-0 flex-1 truncate'>
          {selected
            ? dayjs(selected).format(getDateFormat(language))
            : (placeholder ?? t('Pick a date'))}
        </span>
        {selected && (
          <span
            role='button'
            tabIndex={0}
            aria-label={t('Clear')}
            className='text-muted-foreground hover:text-foreground -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md'
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onSelect(undefined)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              event.stopPropagation()
              onSelect(undefined)
            }}
          >
            <X className='size-3.5' />
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align='start'
        collisionPadding={8}
        className='w-auto max-w-[calc(100vw-1rem)] overflow-hidden p-0'
      >
        <Calendar
          mode='single'
          captionLayout='dropdown'
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            onSelect(date)
            if (date) setOpen(false)
          }}
          locale={calendarLocale}
          startMonth={fromDate}
          endMonth={toDate}
          disabled={(date) =>
            Boolean((fromDate && date < fromDate) || (toDate && date > toDate))
          }
        />
      </PopoverContent>
    </Popover>
  )
}
