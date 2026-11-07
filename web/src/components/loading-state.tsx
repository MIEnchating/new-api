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
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

interface LoadingStateProps {
  className?: string
  message?: string
  size?: 'sm' | 'md' | 'lg'
  inline?: boolean
  variant?: 'default' | 'page'
}

const sizeMap = {
  sm: 'size-4',
  md: 'size-6',
  lg: 'size-8',
} as const

export function LoadingState(props: LoadingStateProps) {
  const { t } = useTranslation()
  const iconSize = sizeMap[props.size ?? 'md']

  if (props.variant === 'page') {
    return (
      <div className={cn('app-loading-screen', props.className)}>
        <div
          className='app-loading-progress'
          role='progressbar'
          aria-label={props.message ?? t('Loading...')}
        />
        <div className='app-loading-mark' aria-hidden='true'>
          <div className='app-loading-ring app-loading-ring-outer' />
          <div className='app-loading-ring' />
          <div className='app-loading-core'>
            <svg viewBox='0 0 24 24' focusable='false'>
              <path d='m12 3 9 5-9 5-9-5 9-5Z' />
              <path d='m3 12 9 5 9-5M3 16l9 5 9-5' />
            </svg>
          </div>
          <div className='app-loading-dots'>
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
    )
  }

  if (props.inline) {
    return (
      <span className={cn('inline-flex items-center gap-2', props.className)}>
        <Loader2 className={cn(iconSize, 'animate-spin')} />
        {props.message != null && (
          <span className='text-muted-foreground text-sm'>{props.message}</span>
        )}
      </span>
    )
  }

  return (
    <div
      className={cn(
        'flex min-h-[200px] flex-col items-center justify-center gap-3',
        props.className
      )}
    >
      <div className='animate-spin'>
        <Loader2 className={iconSize} />
      </div>
      <p className='text-muted-foreground text-sm'>
        {props.message ?? t('Loading...')}
      </p>
    </div>
  )
}
