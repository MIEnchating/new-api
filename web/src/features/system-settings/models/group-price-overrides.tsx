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
import { Plus, Trash2 } from 'lucide-react'
import { useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getGroups } from '@/features/channels/api'
import type { PricingCurrency } from '@/features/model-pricing/currency'
import { PricingAmountInput } from '@/features/model-pricing/pricing-amount-input'
import { requireServerSuccess } from '@/lib/server-error-message'

type GroupPriceOverridesProps = {
  currency: PricingCurrency
  unit: 'request' | 'image'
  groupPrices: Record<string, string>
  setGroupPrices: Dispatch<SetStateAction<Record<string, string>>>
}

export function GroupPriceOverrides({
  currency,
  unit,
  groupPrices,
  setGroupPrices,
}: GroupPriceOverridesProps) {
  const { t } = useTranslation()
  const [groupToAdd, setGroupToAdd] = useState('')
  const groupPriceLabel =
    unit === 'image' ? t('Price per image') : t('Price per request')
  const groupQuery = useQuery({
    queryKey: ['groups'],
    queryFn: async () => requireServerSuccess(await getGroups()),
  })
  const availableGroups =
    groupQuery.data?.data?.filter(
      (group) => group !== 'auto' && !Object.hasOwn(groupPrices, group)
    ) ?? []
  const selectedGroupToAdd = availableGroups.includes(groupToAdd)
    ? groupToAdd
    : ''

  return (
    <section className='min-w-0 space-y-3'>
      <h5 className='text-sm font-medium'>{t('Group price overrides')}</h5>
      {Object.keys(groupPrices).length > 0 && (
        <div className='rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Group')}</TableHead>
                <TableHead>
                  {groupPriceLabel} ({currency.label})
                </TableHead>
                <TableHead className='w-10'>
                  <span className='sr-only'>{t('Remove')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(groupPrices).map(([group, price]) => (
                <TableRow key={group}>
                  <TableCell className='max-w-36 break-all whitespace-normal'>
                    {group}
                  </TableCell>
                  <TableCell>
                    <PricingAmountInput
                      aria-label={`${group} · ${groupPriceLabel}`}
                      className='max-w-36 min-w-20'
                      currency={currency}
                      value={price}
                      required
                      pattern='(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)'
                      onChange={(value) =>
                        setGroupPrices((current) => ({
                          ...current,
                          [group]: value,
                        }))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      aria-label={`${t('Remove')} ${group}`}
                      title={t('Remove')}
                      onClick={() =>
                        setGroupPrices((current) => {
                          const next = { ...current }
                          delete next[group]
                          return next
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className='flex items-center gap-2'>
        <Combobox
          className='w-full max-w-56'
          aria-label={t('Select group')}
          placeholder={t('Select group')}
          value={selectedGroupToAdd}
          options={availableGroups.map((group) => ({
            value: group,
            label: group,
          }))}
          disabled={!availableGroups.length}
          onValueChange={(group) => setGroupToAdd(group ?? '')}
        />
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={!selectedGroupToAdd}
          onClick={() => {
            setGroupPrices((current) => ({
              ...current,
              [selectedGroupToAdd]: '',
            }))
            setGroupToAdd('')
          }}
        >
          <Plus data-icon='inline-start' />
          {t('Add group')}
        </Button>
      </div>
    </section>
  )
}
