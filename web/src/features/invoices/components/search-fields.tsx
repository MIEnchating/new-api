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

import { CompactDateTimeRangePicker } from '@/components/compact-date-time-range-picker'
import { Input } from '@/components/ui/input'

import type { InvoiceSearch } from '../types'

export function InvoiceSearchFields(props: {
  admin?: boolean
  orders?: boolean
  value: InvoiceSearch
  onChange: (value: InvoiceSearch) => void
}) {
  const { t } = useTranslation()
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full max-sm:flex-none'>
      {!props.orders && props.admin && (
        <>
          <Input
            aria-label={t('Search invoice applications')}
            placeholder={t('Search invoice applications')}
            value={props.value.keyword ?? ''}
            onChange={(event) =>
              props.onChange({ ...props.value, keyword: event.target.value })
            }
            className='w-full sm:w-52 lg:w-60'
          />
          <Input
            aria-label={t('Search users by ID or name...')}
            placeholder={t('Search users by ID or name...')}
            value={props.value.user ?? ''}
            onChange={(event) =>
              props.onChange({ ...props.value, user: event.target.value })
            }
            className='w-full sm:w-44'
          />
        </>
      )}
      <CompactDateTimeRangePicker
        start={
          props.value.start_timestamp
            ? new Date(props.value.start_timestamp * 1000)
            : undefined
        }
        end={
          props.value.end_timestamp
            ? new Date(props.value.end_timestamp * 1000)
            : undefined
        }
        onChange={(range) =>
          props.onChange({
            ...props.value,
            start_timestamp: range.start
              ? Math.floor(range.start.getTime() / 1000)
              : undefined,
            end_timestamp: range.end
              ? Math.floor(range.end.getTime() / 1000)
              : undefined,
          })
        }
        className='w-full min-w-0 sm:w-auto sm:max-w-96 sm:min-w-56'
      />
    </div>
  )
}
