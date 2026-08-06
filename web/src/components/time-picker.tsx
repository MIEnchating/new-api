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
import { Clock3 } from 'lucide-react'

import { hourOptions, minuteOptions } from '@/components/date-time-picker-utils'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type TimePickerProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  showIcon?: boolean
  'aria-label'?: string
}

function normalizeTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return { hour: '00', minute: '00' }
  return {
    hour: hourOptions.includes(match[1]) ? match[1] : '00',
    minute: minuteOptions.includes(match[2]) ? match[2] : '00',
  }
}

export function TimePicker({
  value,
  onChange,
  disabled = false,
  className,
  showIcon = true,
  'aria-label': ariaLabel,
}: TimePickerProps) {
  const { hour, minute } = normalizeTime(value)

  return (
    <div
      data-slot='time-picker'
      aria-label={ariaLabel}
      className={cn(
        'border-input focus-within:border-ring focus-within:ring-ring/50 dark:bg-input/30 flex h-8 min-w-0 items-center rounded-lg border bg-transparent px-2 transition-colors focus-within:ring-3',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
    >
      {showIcon && (
        <Clock3 className='text-muted-foreground mr-1.5 size-4 shrink-0' />
      )}
      <TimeUnitSelect
        value={hour}
        options={hourOptions}
        disabled={disabled}
        onValueChange={(nextHour) => onChange(`${nextHour}:${minute}`)}
      />
      <span className='text-muted-foreground px-0.5 text-sm font-medium'>
        :
      </span>
      <TimeUnitSelect
        value={minute}
        options={minuteOptions}
        disabled={disabled}
        onValueChange={(nextMinute) => onChange(`${hour}:${nextMinute}`)}
      />
    </div>
  )
}

function TimeUnitSelect(props: {
  value: string
  options: string[]
  disabled: boolean
  onValueChange: (value: string) => void
}) {
  return (
    <Select<string>
      value={props.value}
      items={props.options.map((option) => ({ value: option, label: option }))}
      disabled={props.disabled}
      onValueChange={(value) => value !== null && props.onValueChange(value)}
    >
      <SelectTrigger
        size='sm'
        className='h-6 min-w-10 flex-1 border-0 bg-transparent px-1 font-medium tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent'
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className='max-h-56 min-w-20'>
        <SelectGroup>
          {props.options.map((option) => (
            <SelectItem key={option} value={option} className='tabular-nums'>
              {option}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
