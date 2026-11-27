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
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { CalendarClock, Check, Folder, Layers } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useMediaQuery } from '@/hooks'
import { toIntlLocale } from '@/i18n/languages'
import type { GroupVendor } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import {
  AUTO_GROUP_FRAME_CLASS_NAME,
  AutoGroupFlowBorder,
  GroupRatioBadge,
} from './auto-group-visuals'

export type ApiKeyGroupOption = {
  value: string
  label: string
  desc?: string
  vendor?: GroupVendor
  ratio?: number | string
  baseRatio?: number
  scheduleEnabled?: boolean
  scheduleActive?: boolean
  order?: number
}

type ApiKeyGroupComboboxProps = {
  options: ApiKeyGroupOption[]
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  compact?: boolean
}

export function ApiKeyGroupCombobox({
  options,
  value,
  onValueChange,
  placeholder,
  disabled,
  compact = false,
}: ApiKeyGroupComboboxProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [platform, setPlatform] = useState<number | 'other' | 'all'>('all')
  const searchInput = useRef<HTMLInputElement>(null)
  const shouldReduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const selectedOption = options.find((option) => option.value === value)
  const isAutoSelected = selectedOption?.value === 'auto'

  const { sections, hasVendors } = useMemo(() => {
    const sections = new Map<
      number,
      { vendor: GroupVendor; options: ApiKeyGroupOption[] }
    >()
    const otherOptions: ApiKeyGroupOption[] = []
    for (const option of options) {
      if (!option.vendor) {
        otherOptions.push(option)
        continue
      }
      const section = sections.get(option.vendor.id)
      if (section) {
        section.options.push(option)
      } else {
        sections.set(option.vendor.id, {
          vendor: option.vendor,
          options: [option],
        })
      }
    }
    return {
      sections: [
        ...sections.values(),
        ...(otherOptions.length > 0
          ? [{ vendor: undefined, options: otherOptions }]
          : []),
      ],
      hasVendors: sections.size > 0,
    }
  }, [options])

  const search = searchValue.trim().toLowerCase()
  const visibleSections = sections.flatMap(({ vendor, options }) => {
    if (
      hasVendors &&
      platform !== 'all' &&
      platform !== (vendor?.id ?? 'other')
    ) {
      return []
    }
    const matches =
      !search || vendor?.name.toLowerCase().includes(search)
        ? options
        : options.filter((option) =>
            [
              option.value,
              option.label,
              option.desc,
              String(option.ratio ?? ''),
            ].some((text) => text?.toLowerCase().includes(search))
          )
    return matches.length ? [{ vendor, options: matches }] : []
  })

  const handleSelect = (selectedValue: string) => {
    onValueChange(selectedValue)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setPlatform('all')
          setSearchValue('')
        }
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            size={compact ? 'sm' : 'default'}
            role='combobox'
            aria-expanded={open}
            data-auto-group-effect={isAutoSelected ? 'trigger' : undefined}
            disabled={disabled}
            className={cn(
              'border-input bg-muted/40 hover:bg-muted/55 hover:text-foreground active:bg-background data-popup-open:border-ring data-popup-open:bg-background data-popup-open:ring-ring/20 relative h-auto min-w-0 w-full justify-between gap-2 overflow-hidden text-start shadow-none transition-[background-color,border-color,box-shadow] duration-150 data-popup-open:ring-[3px]',
              compact
                ? 'rounded-lg px-2.5 py-1'
                : 'min-h-14 rounded-lg px-3 py-2 sm:min-h-20 sm:gap-3 sm:px-4 sm:py-3',
              isAutoSelected &&
                cn(
                  AUTO_GROUP_FRAME_CLASS_NAME,
                  'hover:border-primary/55 data-popup-open:border-primary/55 data-popup-open:ring-primary/20'
                )
            )}
          />
        }
      >
        {isAutoSelected && (
          <AutoGroupFlowBorder shouldReduceMotion={shouldReduceMotion} />
        )}
        {selectedOption?.vendor && (
          <span aria-hidden='true' className='shrink-0'>
            {getLobeIcon(
              selectedOption.vendor.icon || selectedOption.vendor.name,
              16
            )}
          </span>
        )}
        <span className='flex min-w-0 flex-1 items-center justify-between gap-2 overflow-hidden sm:gap-3'>
          <span className='min-w-0'>
            <span className='block truncate font-medium'>
              {selectedOption?.label || placeholder || t('Select a group')}
            </span>
            {!compact && selectedOption?.desc && (
              <span className='text-muted-foreground block truncate text-[11px] sm:text-xs'>
                {selectedOption.desc}
              </span>
            )}
          </span>
          <span className='hidden sm:block'>
            <span className='flex items-center gap-1.5'>
              {selectedOption?.scheduleEnabled && (
                <ScheduleIndicator active={selectedOption.scheduleActive} />
              )}
              <GroupRatioBadge
                ratio={selectedOption?.ratio}
                isAuto={isAutoSelected}
                shouldReduceMotion={shouldReduceMotion}
              />
            </span>
          </span>
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          aria-hidden='true'
          data-slot='combobox-icon'
          className={cn(
            'size-4 shrink-0 opacity-50 transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className={cn(
          'w-[max(var(--anchor-width),22rem)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-0 shadow-lg',
          hasVendors && 'sm:w-[max(var(--anchor-width),36rem)]'
        )}
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Command shouldFilter={false} label={t('Select a group')}>
          <CommandInput
            ref={searchInput}
            placeholder={t('Search...')}
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <div className='mt-1 flex min-h-0 flex-col border-t sm:flex-row'>
            {hasVendors && (
              <nav
                aria-label={t('Platform')}
                className='flex shrink-0 gap-1 overflow-x-auto border-b p-1.5 sm:max-h-[min(360px,50dvh)] sm:w-40 sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto sm:border-e sm:border-b-0'
                onKeyDown={(event) => {
                  // Let filter buttons handle activation independently of cmdk.
                  if (event.key === 'Enter') event.stopPropagation()
                }}
              >
                {[
                  {
                    id: 'all' as const,
                    label: t('All'),
                    count: options.length,
                    icon: <Layers />,
                  },
                  ...sections.map(({ vendor, options }) => ({
                    id: vendor?.id ?? ('other' as const),
                    label: vendor?.name ?? t('Other groups'),
                    count: options.length,
                    icon: vendor ? (
                      getLobeIcon(vendor.icon || vendor.name, 16)
                    ) : (
                      <Folder />
                    ),
                  })),
                ].map(({ id, label, count, icon }) => (
                  <Button
                    key={id}
                    type='button'
                    size='sm'
                    variant={platform === id ? 'secondary' : 'ghost'}
                    aria-pressed={platform === id}
                    aria-label={`${label} ${formatNumber(count, locale)}`}
                    title={label}
                    className='justify-start gap-2 sm:w-full'
                    onClick={() => {
                      setPlatform(id)
                      searchInput.current?.focus()
                    }}
                  >
                    <span aria-hidden='true' className='shrink-0'>
                      {icon}
                    </span>
                    <span className='truncate'>{label}</span>
                    <span className='bg-muted text-muted-foreground ms-auto rounded-full px-1.5 text-xs tabular-nums'>
                      {formatNumber(count, locale)}
                    </span>
                  </Button>
                ))}
              </nav>
            )}
            <CommandList className='max-h-[min(360px,50dvh)] min-w-0 flex-1'>
              <CommandEmpty>{t('No group found.')}</CommandEmpty>
              {visibleSections.map(({ vendor, options: groupOptions }) => (
                <CommandGroup
                  key={vendor?.id ?? 'other'}
                  value={vendor ? String(vendor.id) : 'other'}
                  heading={vendor?.name ?? (hasVendors && t('Other groups'))}
                >
                  {groupOptions.map((option) => {
                    const isAutoOption = option.value === 'auto'

                    return (
                      <CommandItem
                        key={option.value}
                        value={option.value}
                        data-auto-group-effect={
                          isAutoOption ? 'option' : undefined
                        }
                        onSelect={() => handleSelect(option.value)}
                        className={cn(
                          'data-[selected=true]:bg-muted items-start gap-3 rounded-lg px-3 py-3 transition-colors',
                          isAutoOption &&
                            cn(
                              AUTO_GROUP_FRAME_CLASS_NAME,
                              'border-primary/35 data-[selected=true]:border-primary/55'
                            )
                        )}
                      >
                        {isAutoOption && (
                          <AutoGroupFlowBorder
                            shouldReduceMotion={shouldReduceMotion}
                          />
                        )}
                        <Check
                          aria-hidden='true'
                          className={cn(
                            'mt-0.5 size-4',
                            value === option.value ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <span className='min-w-0 flex-1'>
                          <span className='block truncate font-medium'>
                            {option.label}
                          </span>
                          {option.desc && (
                            <span className='text-muted-foreground block truncate text-xs'>
                              {option.desc}
                            </span>
                          )}
                        </span>
                        <span className='flex items-center gap-1.5'>
                          {option.scheduleEnabled && (
                            <ScheduleIndicator active={option.scheduleActive} />
                          )}
                          <GroupRatioBadge
                            ratio={option.ratio}
                            isAuto={isAutoOption}
                            shouldReduceMotion={shouldReduceMotion}
                          />
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ScheduleIndicator(props: { active?: boolean }) {
  const { t } = useTranslation()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className='inline-flex'
            data-group-ratio-schedule={props.active ? 'active' : 'enabled'}
          />
        }
      >
        <CalendarClock
          className={cn(
            'size-3.5',
            props.active ? 'text-emerald-600' : 'text-muted-foreground'
          )}
        />
      </TooltipTrigger>
      <TooltipContent>
        {props.active
          ? t('Scheduled ratio active')
          : t('Time-based ratio enabled')}
      </TooltipContent>
    </Tooltip>
  )
}
