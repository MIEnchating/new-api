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
import { Reorder } from 'motion/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AutoGroupOrderItem } from '@/components/auto-group-order-item'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { VendorOperationDialog } from '@/features/models/components/dialogs/vendor-operation-dialog'
import { sortPricingVendors } from '@/features/pricing/lib/filters'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getModelSquareVendors, type ModelSquareVendor } from '../api'
import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'

const EMPTY_VENDORS: ModelSquareVendor[] = []

export function ModelSquareSettingsSection(props: { vendorOrder: string[] }) {
  const { t } = useTranslation()
  const [deleteVendorID, setDeleteVendorID] = useState<number | null>(null)
  const {
    data: vendors = EMPTY_VENDORS,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['vendors', 'model-square'],
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
  const names = orderedVendors.map((vendor) => vendor.name)
  const isSaving = updateOption.isPending || isSubmitting

  const reorderVendors = (next: string[]) => {
    if (isSaving) return
    const knownNames = new Set(next)
    const unavailable = vendorOrder.filter((name) => !knownNames.has(name))
    form.setValue('vendorOrder', [...next, ...unavailable], {
      shouldDirty: true,
    })
  }

  const moveVendor = (index: number, direction: 'up' | 'down') => {
    const target = index + (direction === 'up' ? -1 : 1)
    if (target < 0 || target >= names.length) return
    const next = [...names]
    ;[next[index], next[target]] = [next[target], next[index]]
    reorderVendors(next)
  }

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
        <Reorder.Group
          as='ol'
          axis='y'
          values={names}
          onReorder={reorderVendors}
          aria-label={t('Supplier display order')}
          className='flex flex-col gap-2'
        >
          {orderedVendors.map((vendor, index) => (
            <AutoGroupOrderItem
              key={vendor.id}
              group={vendor.name}
              index={index}
              count={orderedVendors.length}
              disabled={isSaving}
              onMove={moveVendor}
              actions={
                vendor.can_delete && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    disabled={isSaving}
                    aria-label={t('Delete {{name}}', { name: vendor.name })}
                    onClick={() => setDeleteVendorID(vendor.id)}
                  >
                    {t('Delete')}
                  </Button>
                )
              }
            >
              {vendor.can_delete && (
                <Badge variant='secondary'>{t('Unused')}</Badge>
              )}
            </AutoGroupOrderItem>
          ))}
        </Reorder.Group>
      ) : (
        <p className='text-muted-foreground text-sm'>{t('No vendors found')}</p>
      )}
      {deleteVendorID !== null && (
        <VendorOperationDialog
          selection={{ action: 'delete', vendor_ids: [deleteVendorID] }}
          onClose={() => setDeleteVendorID(null)}
        />
      )}
    </SettingsSection>
  )
}
