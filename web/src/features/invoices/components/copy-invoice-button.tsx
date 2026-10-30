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

import { CopyButton } from '@/components/copy-button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { InvoiceRequest } from '../types'

export function InvoiceCopyButton(props: { request: InvoiceRequest }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const request = props.request
  const invoiceDetails = [
    [t('Invoice title'), request.title],
    [
      t('Invoice title type'),
      request.title_type === 'company' ? t('Company') : t('Personal'),
    ],
    [t('Tax identification number'), request.tax_id],
    [t('Invoice email'), request.email],
    [t('Invoice address'), request.invoice_address],
    [t('Invoice phone number'), request.invoice_phone],
    [t('Bank name'), request.bank_name],
    [t('Bank account number'), request.bank_account],
    [
      t('Invoice amount'),
      formatNumber(
        request.orders.reduce((total, order) => total + order.money, 0),
        locale
      ),
    ],
    [t('Remarks'), request.remark],
  ]
    .filter(([, value]) => value?.trim())
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n')
  return (
    <CopyButton
      value={invoiceDetails}
      variant='outline'
      size='sm'
      aria-label={t('Copy invoice details')}
    >
      {t('Copy invoice details')}
    </CopyButton>
  )
}
