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
import type { TFunction } from 'i18next'

export function invoiceCopyFieldLabels(t: TFunction) {
  return {
    title: t('Invoice title'),
    title_type: t('Invoice title type'),
    tax_id: t('Tax identification number'),
    email: t('Invoice email'),
    invoice_address: t('Invoice address'),
    invoice_phone: t('Invoice phone number'),
    bank_name: t('Bank name'),
    bank_account: t('Bank account number'),
    amount: t('Invoice amount'),
    remark: t('Remarks'),
  }
}
