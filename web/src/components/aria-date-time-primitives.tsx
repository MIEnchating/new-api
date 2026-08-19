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
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useState } from 'react'
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  CalendarHeading,
  CalendarMonthPicker,
  CalendarYearPicker,
  DateInput,
  DateSegment,
  Dialog,
  Popover,
} from 'react-aria-components'
import { useTranslation } from 'react-i18next'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type CalendarPickerItem = {
  id: number
  formatted: string
}

type CalendarPickerSelectProps = {
  'aria-label': string
  value: string | number
  onChange: (key: string | number | null) => void
  items: CalendarPickerItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
  wide?: boolean
}

export function SegmentedDateInput({ className }: { className?: string }) {
  return (
    <DateInput
      className={cn(
        'flex min-w-0 flex-1 items-center px-3 py-1.5 tabular-nums',
        className
      )}
    >
      {(segment) => (
        <DateSegment
          segment={segment}
          className='data-[focused]:bg-accent data-[focused]:text-accent-foreground data-[placeholder]:text-muted-foreground rounded-sm px-0.5 outline-none data-[type=literal]:px-0'
        />
      )}
    </DateInput>
  )
}

export function AriaCalendarPopover({
  portalContainer,
  placement = 'bottom start',
  includeTime = false,
  timeValue,
  onTimeChange,
}: {
  portalContainer?: Element
  placement?: 'top start' | 'bottom start'
  includeTime?: boolean
  timeValue?: string
  onTimeChange?: (value: string) => void
}) {
  const { t } = useTranslation()
  const [openPicker, setOpenPicker] = useState<'year' | 'month' | null>(null)

  return (
    <Popover
      UNSTABLE_portalContainer={portalContainer}
      isNonModal
      placement={placement}
      shouldFlip={false}
      offset={4}
      className='bg-popover text-popover-foreground ring-foreground/10 data-[entering]:animate-in data-[entering]:fade-in-0 data-[entering]:zoom-in-95 data-[exiting]:animate-out data-[exiting]:fade-out-0 data-[exiting]:zoom-out-95 z-50 w-[20rem] rounded-lg shadow-md ring-1 outline-none'
    >
      <Dialog className='outline-none'>
        <Calendar className='w-full p-3'>
          <CalendarHeading className='sr-only' />
          <div className='mb-2 flex h-9 items-center justify-between gap-1'>
            <Button
              slot='previous'
              className='hover:bg-accent focus-visible:ring-ring flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2 disabled:opacity-40'
            >
              <ChevronLeft className='size-4' />
            </Button>
            <div className='flex min-w-0 items-center justify-center gap-1'>
              <CalendarYearPicker visibleYears={200}>
                {(props) => (
                  <CalendarPickerSelect
                    {...props}
                    open={openPicker === 'year'}
                    onOpenChange={(open) =>
                      setOpenPicker((current) =>
                        open ? 'year' : current === 'year' ? null : current
                      )
                    }
                    wide
                  />
                )}
              </CalendarYearPicker>
              <CalendarMonthPicker format='long'>
                {(props) => (
                  <CalendarPickerSelect
                    {...props}
                    open={openPicker === 'month'}
                    onOpenChange={(open) =>
                      setOpenPicker((current) =>
                        open ? 'month' : current === 'month' ? null : current
                      )
                    }
                  />
                )}
              </CalendarMonthPicker>
            </div>
            <Button
              slot='next'
              className='hover:bg-accent focus-visible:ring-ring flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2 disabled:opacity-40'
            >
              <ChevronRight className='size-4' />
            </Button>
          </div>
          <CalendarGrid
            weekdayStyle='short'
            className='w-full border-separate border-spacing-y-1'
          >
            <CalendarGridHeader>
              {(day) => (
                <CalendarHeaderCell className='text-muted-foreground h-8 text-center text-xs font-normal'>
                  {day}
                </CalendarHeaderCell>
              )}
            </CalendarGridHeader>
            <CalendarGridBody>
              {(date) => (
                <CalendarCell
                  date={date}
                  className='hover:bg-accent focus-visible:ring-ring data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[today]:bg-muted flex size-9 items-center justify-center rounded-md text-sm outline-none focus-visible:ring-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[outside-visible-range]:invisible data-[today]:font-semibold'
                />
              )}
            </CalendarGridBody>
          </CalendarGrid>
          {includeTime && (
            <div className='border-border mt-2 flex items-center justify-between gap-3 border-t px-1 pt-3'>
              <span className='text-muted-foreground text-sm'>{t('Time')}</span>
              <input
                aria-label={t('Time')}
                type='time'
                step={60}
                value={timeValue ?? ''}
                onChange={(event) => onTimeChange?.(event.target.value)}
                className='border-input bg-background text-foreground focus-visible:ring-ring h-9 rounded-md border px-2 text-sm tabular-nums outline-none focus-visible:ring-2'
              />
            </div>
          )}
        </Calendar>
      </Dialog>
    </Popover>
  )
}

function CalendarPickerSelect({
  'aria-label': ariaLabel,
  value,
  onChange,
  items,
  open,
  onOpenChange,
  wide = false,
}: CalendarPickerSelectProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  )
  const setTriggerRef = useCallback((element: HTMLButtonElement | null) => {
    setPortalContainer(
      element?.closest<HTMLElement>('[data-trigger="DatePicker"]') ?? null
    )
  }, [])

  return (
    <Select
      open={open}
      onOpenChange={onOpenChange}
      value={String(value)}
      items={items.map((item) => ({
        value: String(item.id),
        label: item.formatted,
      }))}
      onValueChange={(nextValue) => onChange(Number(nextValue))}
    >
      <SelectTrigger
        ref={setTriggerRef}
        aria-label={ariaLabel}
        size='sm'
        className={cn(
          'hover:bg-accent h-8 border-0 bg-transparent px-2 font-medium tabular-nums shadow-none focus-visible:ring-2',
          wide ? 'min-w-[5rem]' : 'min-w-[4.5rem]'
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        portalContainer={portalContainer}
        align='start'
        alignItemWithTrigger={false}
        className={cn('max-h-64', wide ? 'min-w-24' : 'min-w-28')}
      >
        {items.map((item) => (
          <SelectItem key={item.id} value={String(item.id)}>
            {item.formatted}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
