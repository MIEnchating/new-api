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
import { cn } from '@/lib/utils'

type TimePickerProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  showIcon?: boolean
  'aria-label'?: string
}

export function TimePicker({
  value,
  onChange,
  disabled = false,
  className,
  showIcon = true,
  'aria-label': ariaLabel,
}: TimePickerProps) {
  return (
    <input
      type='time'
      step={60}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      onClick={(event) => {
        if (!disabled && showIcon) event.currentTarget.showPicker?.()
      }}
      className={cn(
        'border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 w-full min-w-0 rounded-lg border bg-transparent px-3 py-1 text-sm tabular-nums outline-none transition-colors focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
        !showIcon && '[&::-webkit-calendar-picker-indicator]:hidden',
        className
      )}
    />
  )
}
