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
import { CalendarDays } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const weekdayKeys = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

type WeekdayPickerProps = {
  value: number[]
  onChange: (value: number[]) => void
  disabled?: boolean
  className?: string
}

export function WeekdayPicker({
  value,
  onChange,
  disabled = false,
  className,
}: WeekdayPickerProps) {
  const { t } = useTranslation()
  const selected = new Set(value)

  return (
    <div
      data-slot='weekday-picker'
      className={cn('rounded-lg border p-2', className)}
    >
      <div className='text-muted-foreground mb-2 flex items-center gap-1.5 text-xs'>
        <CalendarDays className='size-3.5' />
        <span>{t('Weekdays')}</span>
      </div>
      <div className='grid grid-cols-4 gap-1.5 sm:grid-cols-7'>
        {weekdayKeys.map((key, weekday) => {
          const active = selected.has(weekday)
          return (
            <Button
              key={key}
              type='button'
              size='sm'
              variant={active ? 'default' : 'outline'}
              aria-pressed={active}
              disabled={disabled}
              className='h-8 min-w-0 px-1.5 text-xs'
              onClick={() => {
                const next = new Set(selected)
                if (active) next.delete(weekday)
                else next.add(weekday)
                onChange([...next].sort((a, b) => a - b))
              }}
            >
              <span className='truncate'>{t(key)}</span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}
