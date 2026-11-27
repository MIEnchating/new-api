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
import { FieldSet } from '@/components/ui/field'
import { sortPricingVendors } from '@/features/pricing/lib/filters'
import { getModelSquareVendors } from '@/features/system-settings/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { VendorOperationDialog } from './vendor-operation-dialog'

export function ModelSquareVendorOrder(props: {
  order: string[]
  disabled: boolean
  onReorder: (order: string[]) => void
}) {
  const { t } = useTranslation()
  const [deleteVendorID, setDeleteVendorID] = useState<number | null>(null)
  const {
    data: vendors,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['vendors', 'model-square'],
    queryFn: async () =>
      requireServerSuccess(await getModelSquareVendors()).data,
  })
  const orderedVendors = useMemo(
    () => sortPricingVendors(vendors ?? [], props.order),
    [vendors, props.order]
  )
  const names = orderedVendors.map((vendor) => vendor.name)

  const reorderVendors = (next: string[]) => {
    if (props.disabled) return
    const knownNames = new Set(next)
    const unavailable = props.order.filter((name) => !knownNames.has(name))
    props.onReorder([...next, ...unavailable])
  }

  const moveVendor = (index: number, direction: 'up' | 'down') => {
    const target = index + (direction === 'up' ? -1 : 1)
    if (target < 0 || target >= names.length) return
    const next = [...names]
    ;[next[index], next[target]] = [next[target], next[index]]
    reorderVendors(next)
  }

  return (
    <>
      {isLoading ? (
        <LoadingState />
      ) : error && !vendors ? (
        <ErrorState
          title={t('Failed to load vendors')}
          onRetry={() => void refetch()}
        />
      ) : orderedVendors.length > 0 ? (
        <FieldSet disabled={props.disabled} className='min-w-0'>
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
                onMove={moveVendor}
                actions={
                  vendor.can_delete && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
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
        </FieldSet>
      ) : (
        <p className='text-muted-foreground text-sm'>{t('No vendors found')}</p>
      )}
      {deleteVendorID !== null && (
        <VendorOperationDialog
          selection={{ action: 'delete', vendor_ids: [deleteVendorID] }}
          onClose={() => setDeleteVendorID(null)}
        />
      )}
    </>
  )
}
