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
import { Clock3, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const AUTO_REFRESH_SECONDS = 60

export function RefreshControl(props: {
  loading: boolean
  refreshing: boolean
  lastUpdated: Date | null
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const { loading, refreshing, lastUpdated, onRefresh } = props
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS)

  useEffect(() => {
    if (loading || refreshing) {
      setCountdown(AUTO_REFRESH_SECONDS)
      return
    }

    const timer = window.setInterval(() => {
      setCountdown((current) => Math.max(current - 1, 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [loading, refreshing])

  useEffect(() => {
    if (countdown !== 0 || loading || refreshing) return

    setCountdown(AUTO_REFRESH_SECONDS)
    onRefresh()
  }, [countdown, loading, onRefresh, refreshing])

  const lastUpdatedText = lastUpdated
    ? t('Updated {{time}}', {
        time: lastUpdated.toLocaleTimeString(undefined, {
          hourCycle: 'h23',
        }),
      })
    : ''

  return (
    <div className='flex w-full min-w-0 items-center justify-between gap-2 sm:w-auto sm:justify-start'>
      {lastUpdatedText ? (
        <div className='text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs'>
          <Clock3 className='size-3.5 shrink-0' />
          <span className='truncate whitespace-nowrap'>{lastUpdatedText}</span>
        </div>
      ) : null}
      <Button
        type='button'
        variant='outline'
        onClick={() => {
          setCountdown(AUTO_REFRESH_SECONDS)
          onRefresh()
        }}
        disabled={loading || refreshing}
        className='gap-2'
      >
        <RotateCw className={cn('size-4', refreshing && 'animate-spin')} />
        {t('Refresh')}
        {!loading ? (
          <span className='border-border min-w-8 border-l pl-2 text-right tabular-nums'>
            {countdown}s
          </span>
        ) : null}
      </Button>
    </div>
  )
}
