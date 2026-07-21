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
import type { Column } from '@tanstack/react-table'
import { Check as CheckIcon, PlusCircle as PlusCircledIcon } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

type DataTableFacetedFilterProps<TData, TValue> = {
  column?: Column<TData, TValue>
  title?: string
  /** Optional trigger styling for layouts that need a stable filter width. */
  className?: string
  options: {
    label: string
    value: string
    selectedLabel?: string
    icon?: React.ComponentType<{ className?: string }>
    iconNode?: React.ReactNode
    count?: number
  }[]
  /** Enable single select mode (only one option can be selected at a time) */
  singleSelect?: boolean
  /** Controlled selection for form-mode filters. */
  selectedValues?: string[]
  onSelectedValuesChange?: (values: string[]) => void
}

function DataTableFacetedFilterInner<TData, TValue>({
  column,
  title,
  className,
  options,
  singleSelect = false,
  selectedValues: controlledSelectedValues,
  onSelectedValuesChange,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const { t } = useTranslation()
  const facets = column?.getFacetedUniqueValues()
  const filterValue =
    controlledSelectedValues ??
    (column?.getFilterValue() as string[] | undefined)
  const selectedValues = new Set(filterValue)

  const updateSelectedValues = (values: string[]) => {
    if (onSelectedValuesChange) {
      onSelectedValuesChange(values)
      return
    }
    column?.setFilterValue(values.length ? values : undefined)
  }

  const handleOptionSelect = (optionValue: string) => {
    const nextSelectedValues = getNextSelectedValues(
      selectedValues,
      optionValue,
      singleSelect
    )

    updateSelectedValues(nextSelectedValues)
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant='outline'
            size='sm'
            className={cn('h-8 border-dashed', className)}
          />
        }
      >
        <PlusCircledIcon className='size-4' />
        <span className='min-w-0 truncate'>{title}</span>
        {selectedValues?.size > 0 && (
          <>
            <Separator orientation='vertical' className='mx-2 h-4 shrink-0' />
            <Badge
              variant='secondary'
              className='shrink-0 rounded-sm px-1 font-normal lg:hidden'
            >
              {selectedValues.size}
            </Badge>
            <div className='hidden min-w-0 items-center gap-1 overflow-hidden lg:flex'>
              {selectedValues.size > 2 ? (
                <Badge
                  variant='secondary'
                  className='shrink-0 rounded-sm px-1 font-normal'
                >
                  {selectedValues.size} {t('selected')}
                </Badge>
              ) : (
                options
                  .filter((option) => selectedValues.has(option.value))
                  .map((option) => (
                    <Badge
                      variant='secondary'
                      key={option.value}
                      className='max-w-full truncate rounded-sm px-1 font-normal'
                    >
                      {t(option.selectedLabel ?? option.label)}
                    </Badge>
                  ))
              )}
            </div>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent className='max-w-[360px] min-w-[200px] p-0' align='start'>
        <Command
          filter={(value, search, keywords) => {
            const query = search.trim().toLowerCase()
            if (!query) return 1

            const searchableText = [value, ...(keywords ?? [])]
              .join(' ')
              .toLowerCase()
            return searchableText.includes(query) ? 1 : 0
          }}
        >
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>{t('No results found.')}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selectedValues.has(option.value)
                let optionIcon: React.ReactNode = null
                if (option.iconNode) {
                  optionIcon = (
                    <span className='text-muted-foreground flex size-4 items-center justify-center'>
                      {option.iconNode}
                    </span>
                  )
                } else if (option.icon) {
                  optionIcon = (
                    <option.icon className='text-muted-foreground size-4' />
                  )
                }

                let countNode: React.ReactNode = null
                if (typeof option.count === 'number') {
                  countNode = (
                    <span className='text-muted-foreground ms-auto flex h-4 min-w-4 items-center justify-center font-mono text-xs'>
                      {option.count}
                    </span>
                  )
                } else if (facets?.get(option.value)) {
                  countNode = (
                    <span className='ms-auto flex h-4 w-4 items-center justify-center font-mono text-xs'>
                      {facets.get(option.value)}
                    </span>
                  )
                }

                return (
                  <CommandItem
                    key={option.value}
                    keywords={[t(option.label)]}
                    onSelect={() => handleOptionSelect(option.value)}
                  >
                    <div
                      className={cn(
                        'border-primary flex size-4 items-center justify-center rounded-sm border',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'opacity-50 [&_svg]:invisible'
                      )}
                    >
                      <CheckIcon className={cn('text-background h-4 w-4')} />
                    </div>
                    {optionIcon}
                    <span
                      className='min-w-0 flex-1 truncate'
                      title={t(option.label)}
                    >
                      {t(option.label)}
                    </span>
                    {countNode}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selectedValues.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => updateSelectedValues([])}
                    className='justify-center text-center'
                  >
                    {t('Clear filters')}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export const DataTableFacetedFilter = React.memo(
  DataTableFacetedFilterInner
) as typeof DataTableFacetedFilterInner

function getNextSelectedValues(
  selectedValues: Set<string>,
  optionValue: string,
  singleSelect: boolean
): string[] {
  if (singleSelect) {
    return selectedValues.has(optionValue) ? [] : [optionValue]
  }

  const nextSelectedValues = new Set(selectedValues)
  if (nextSelectedValues.has(optionValue)) {
    nextSelectedValues.delete(optionValue)
  } else {
    nextSelectedValues.add(optionValue)
  }

  return [...nextSelectedValues]
}
