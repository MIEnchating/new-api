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
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useMediaQuery } from '@/hooks'
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
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [open, setOpen] = React.useState(false)
  const [mobileSearch, setMobileSearch] = React.useState('')
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

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setMobileSearch('')
    }
  }

  const trigger = (
    <Button
      variant='outline'
      size='sm'
      className={cn('h-8 border-solid', className)}
    >
      <PlusCircledIcon className='size-4' />
      <span className='min-w-0 truncate'>{title}</span>
      {selectedValues.size > 0 && (
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
    </Button>
  )

  if (isMobile) {
    const query = mobileSearch.trim().toLowerCase()
    const filteredOptions = query
      ? options.filter((option) =>
          [option.value, t(option.label), t(option.selectedLabel ?? '')]
            .join(' ')
            .toLowerCase()
            .includes(query)
        )
      : options

    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent className='max-h-[80dvh] p-0'>
          <div className='mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col'>
            <DrawerHeader className='border-border/70 border-b px-4 pt-3 pb-3 text-left'>
              <DrawerTitle>{title}</DrawerTitle>
              <DrawerDescription className='sr-only'>
                {t('Filter')}: {title}
              </DrawerDescription>
            </DrawerHeader>

            <div className='min-h-0 flex-1 overflow-y-auto px-4 py-3'>
              <Input
                value={mobileSearch}
                onChange={(event) => setMobileSearch(event.target.value)}
                placeholder={title}
                className='mb-2 h-9'
              />
              <div className='space-y-1'>
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((option) => {
                    const isSelected = selectedValues.has(option.value)
                    return (
                      <Button
                        key={option.value}
                        type='button'
                        variant='ghost'
                        data-mobile-faceted-option={option.value}
                        aria-pressed={isSelected}
                        className={cn(
                          'h-11 w-full justify-start gap-3 px-3 text-left font-normal',
                          isSelected && 'bg-muted text-foreground'
                        )}
                        onClick={() => {
                          handleOptionSelect(option.value)
                          if (singleSelect) {
                            handleOpenChange(false)
                          }
                        }}
                      >
                        <span
                          className={cn(
                            'border-primary flex size-5 shrink-0 items-center justify-center rounded border',
                            isSelected
                              ? 'bg-primary text-primary-foreground'
                              : 'opacity-50 [&_svg]:invisible'
                          )}
                        >
                          <CheckIcon className='size-4' />
                        </span>
                        {option.iconNode && (
                          <span className='text-muted-foreground flex size-4 shrink-0 items-center justify-center'>
                            {option.iconNode}
                          </span>
                        )}
                        {option.icon && (
                          <option.icon className='text-muted-foreground size-4 shrink-0' />
                        )}
                        <span className='min-w-0 flex-1 truncate'>
                          {t(option.label)}
                        </span>
                        {typeof option.count === 'number' && (
                          <span className='text-muted-foreground shrink-0 font-mono text-xs'>
                            {option.count}
                          </span>
                        )}
                      </Button>
                    )
                  })
                ) : (
                  <div className='text-muted-foreground py-8 text-center text-sm'>
                    {t('No results found.')}
                  </div>
                )}
              </div>
            </div>

            <DrawerFooter className='border-border/70 grid grid-cols-2 gap-2 border-t px-4 py-3'>
              <Button
                type='button'
                variant='outline'
                disabled={selectedValues.size === 0}
                onClick={() => updateSelectedValues([])}
              >
                {t('Clear filters')}
              </Button>
              <Button type='button' onClick={() => handleOpenChange(false)}>
                {t('Confirm')}
              </Button>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={trigger}>{trigger.props.children}</PopoverTrigger>
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
