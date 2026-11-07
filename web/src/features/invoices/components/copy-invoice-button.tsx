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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getInvoiceSettings } from '../api'
import { invoiceCopyFields } from '../constants'
import { invoiceCopyFieldLabels } from '../lib/copy-fields'
import type { InvoiceCopyField, InvoiceRequest } from '../types'

export function InvoiceCopyButton(props: { request: InvoiceRequest }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const request = props.request
  const settings = useQuery({
    queryKey: ['invoices', 'settings'],
    queryFn: getInvoiceSettings,
    staleTime: 60_000,
  })
  const labels = invoiceCopyFieldLabels(t)
  const values: Partial<Record<InvoiceCopyField, string>> = {
    ...request,
    title_type: request.title_type === 'company' ? t('Company') : t('Personal'),
    amount: formatNumber(
      request.orders.reduce((total, order) => total + order.money, 0),
      locale
    ),
  }
  const selected = settings.data?.copy_fields ?? invoiceCopyFields
  const invoiceDetails = invoiceCopyFields
    .filter((field) => selected.includes(field) && values[field]?.trim())
    .map((field) => `${labels[field]}: ${values[field]}`)
    .join('\n')
  return (
    <CopyButton
      value={invoiceDetails}
      disabled={!settings.data || settings.isError || !invoiceDetails}
      variant='outline'
      size='icon'
      className='size-7'
      iconClassName='size-3.5'
      tooltip={t('Copy invoice details')}
      aria-label={t('Copy invoice details')}
    />
  )
}
