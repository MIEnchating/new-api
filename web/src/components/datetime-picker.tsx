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
  fromDate,
  getLocalTimeZone,
  toCalendarDateTime,
} from '@internationalized/date'
import { CalendarClock, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import {
  Button,
  DatePicker as ReactAriaDatePicker,
  Group,
  I18nProvider,
} from 'react-aria-components'
import { useTranslation } from 'react-i18next'

import {
  AriaCalendarPopover,
  SegmentedDateInput,
} from '@/components/aria-date-time-primitives'
import {
  getCalendarPopoverPlacement,
  getReactAriaLocale,
  type CalendarPopoverPlacement,
} from '@/components/date-time-picker-utils'
import { cn } from '@/lib/utils'

interface DateTimePickerProps {
  value?: Date
  onChange?: (date: Date | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function DateTimePicker({
  value,
  onChange,
  placeholder,
  className,
  disabled = false,
}: DateTimePickerProps) {
  const { t, i18n } = useTranslation()
  const timeZone = getLocalTimeZone()
  const ariaValue = value ? toCalendarDateTime(fromDate(value, timeZone)) : null
  const label = placeholder ?? t('Select date')
  const [portalContainer, setPortalContainer] = useState<Element>()
  const [calendarPlacement, setCalendarPlacement] =
    useState<CalendarPopoverPlacement>('bottom start')
  const groupElementRef = useRef<HTMLDivElement | null>(null)
  const setGroupRef = useCallback((element: HTMLDivElement | null) => {
    groupElementRef.current = element
    setPortalContainer(
      element?.closest(
        '[data-slot="dialog-content"], [data-slot="sheet-content"]'
      ) ?? undefined
    )
  }, [])

  return (
    <I18nProvider
      locale={getReactAriaLocale(
        i18n.resolvedLanguage ?? i18n.language ?? 'en'
      )}
    >
      <ReactAriaDatePicker
        aria-label={label}
        value={ariaValue}
        placeholderValue={
          ariaValue ?? toCalendarDateTime(fromDate(new Date(), timeZone))
        }
        granularity='minute'
        hourCycle={24}
        isDisabled={disabled}
        shouldCloseOnSelect
        onChange={(nextValue) => {
          const nextDate = nextValue?.toDate(timeZone)
          nextDate?.setSeconds(0, 0)
          onChange?.(nextDate)
        }}
        className={cn('w-full min-w-0', className)}
      >
        <Group
          ref={setGroupRef}
          className='border-input focus-within:border-ring focus-within:ring-ring/50 dark:bg-input/30 flex min-h-9 w-full min-w-0 items-center rounded-lg border bg-transparent transition-colors focus-within:ring-3 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'
        >
          <SegmentedDateInput className='flex-wrap' />
          {ariaValue && (
            <button
              type='button'
              aria-label={t('Clear')}
              className='text-muted-foreground hover:text-foreground focus-visible:ring-ring flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2'
              onClick={() => onChange?.(undefined)}
            >
              <X className='size-3.5' />
            </button>
          )}
          <Button
            aria-label={label}
            onPress={() =>
              setCalendarPlacement(
                getCalendarPopoverPlacement(groupElementRef.current)
              )
            }
            className='text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring mr-1 flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2'
          >
            <CalendarClock className='size-4' />
          </Button>
        </Group>
        <AriaCalendarPopover
          portalContainer={portalContainer}
          placement={calendarPlacement}
        />
      </ReactAriaDatePicker>
    </I18nProvider>
  )
}
