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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { GroupOrderControls } from '@/components/auto-group-order-item'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { sortPricingVendors } from '@/features/pricing/lib/filters'
import type { PricingVendor } from '@/features/pricing/types'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getModelSquareVendors } from '../api'
import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'

const EMPTY_VENDORS: PricingVendor[] = []

export function ModelSquareSettingsSection(props: { vendorOrder: string[] }) {
  const { t } = useTranslation()
  const {
    data: vendors = EMPTY_VENDORS,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['model-square-vendors'],
    queryFn: async () =>
      requireServerSuccess(await getModelSquareVendors()).data,
  })
  const updateOption = useUpdateOption()
  const { form, handleSubmit, handleReset, isDirty, isSubmitting } =
    useSettingsForm({
      defaultValues: { vendorOrder: props.vendorOrder },
      onSubmit: async (values) => {
        await updateOption.mutateAsync({
          key: 'ModelSquareVendorOrder',
          value: JSON.stringify(values.vendorOrder),
        })
      },
    })

  const vendorOrder = form.watch('vendorOrder')
  const orderedVendors = useMemo(
    () => sortPricingVendors(vendors, vendorOrder),
    [vendors, vendorOrder]
  )
  const isSaving = updateOption.isPending || isSubmitting

  return (
    <SettingsSection title={t('Model Square')}>
      <FormNavigationGuard when={isDirty} />
      <SettingsPageFormActions
        onSave={() => void handleSubmit().catch(() => {})}
        onReset={handleReset}
        isSaving={isSaving}
        isSaveDisabled={!isDirty}
        isResetDisabled={!isDirty}
      />
      <FormDirtyIndicator isDirty={isDirty} />
      <h3 className='text-sm font-semibold'>{t('Supplier display order')}</h3>
      {isLoading ? (
        <LoadingState />
      ) : error && vendors.length === 0 ? (
        <ErrorState
          title={t('Failed to load vendors')}
          onRetry={() => void refetch()}
        />
      ) : orderedVendors.length > 0 ? (
        <ol aria-label={t('Supplier display order')} className='divide-y'>
          {orderedVendors.map((vendor, index) => (
            <li
              key={vendor.id}
              className='flex min-w-0 items-center justify-between gap-3 py-2'
            >
              <span className='min-w-0 text-sm wrap-break-word'>
                {vendor.name}
              </span>
              <GroupOrderControls
                group={vendor.name}
                index={index}
                count={orderedVendors.length}
                disabled={isSaving}
                onMove={(direction) => {
                  const target = index + (direction === 'up' ? -1 : 1)
                  if (target < 0 || target >= orderedVendors.length) return

                  const next = orderedVendors.map((item) => item.name)
                  ;[next[index], next[target]] = [next[target], next[index]]
                  const unavailable = vendorOrder.filter(
                    (name) => !next.includes(name)
                  )
                  form.setValue('vendorOrder', [...next, ...unavailable], {
                    shouldDirty: true,
                  })
                }}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className='text-muted-foreground text-sm'>{t('No vendors found')}</p>
      )}
    </SettingsSection>
  )
}
