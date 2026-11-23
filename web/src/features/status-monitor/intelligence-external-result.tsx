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
import { useTranslation } from 'react-i18next'

import { RichContent } from '@/components/rich-content'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { cn } from '@/lib/utils'

import type { IntelligenceExternalResult as ExternalResult } from './intelligence-api'

export function IntelligenceExternalResult(props: {
  result: ExternalResult
  className?: string
}) {
  const { t } = useTranslation()
  const candy = props.result.benchmark === 'candy'
  let label = props.result.label || t('Unknown')
  let variant: StatusVariant = 'neutral'
  if (candy) {
    if (props.result.status === 'passed') {
      label = t('Passed')
      variant = 'success'
    } else if (props.result.status === 'incorrect') {
      label = t('Incorrect answer')
      variant = 'warning'
    } else if (props.result.status === 'error') {
      label = t('Failed')
      variant = 'danger'
    }
  } else if (props.result.label === '参考') {
    label = t('For reference')
  } else if (props.result.quality === 'normal') {
    label = props.result.label || t('Normal')
    variant = 'success'
  } else if (
    props.result.quality === 'degraded' ||
    props.result.quality === 'suspicious'
  ) {
    label = props.result.label || t('Suspected degradation')
    variant = 'warning'
  }

  return (
    <div className={cn('min-w-0 space-y-3 text-sm', props.className)}>
      <div className='flex flex-wrap items-center justify-between gap-2 border-b pb-3'>
        <span className='font-medium'>
          {candy ? t('Candy test') : t('Manxue AI')}
        </span>
        <StatusBadge label={label} variant={variant} copyable={false} />
      </div>
      {props.result.reason && (
        <RichContent
          content={props.result.reason}
          breaks
          className='text-muted-foreground text-xs'
        />
      )}
      {props.result.answer && (
        <RichContent content={props.result.answer} breaks />
      )}
    </div>
  )
}
