import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import {
  ArrowDown01Icon,
  Delete02Icon,
  Drag01Icon,
  PlayIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { GroupOrderControls } from '@/components/auto-group-order-item'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { TitledCard } from '@/components/ui/titled-card'
import { cn } from '@/lib/utils'

export function IntelligenceGroupCard(props: {
  id: string
  title: string
  index: number
  count: number
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  runDisabled: boolean
  onRun: () => void
  onRemove: () => void
  onMove: (direction: 'up' | 'down') => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const sortable = useSortable({
    id: props.id,
    disabled: props.pending || props.count < 2,
  })
  const actions = (
    <>
      <Button
        type='button'
        variant='outline'
        size={props.open ? 'sm' : 'icon-sm'}
        aria-label={t('Run this group')}
        title={t('Run this group')}
        disabled={props.runDisabled}
        onClick={props.onRun}
      >
        <HugeiconsIcon icon={PlayIcon} aria-hidden='true' />
        {props.open && t('Run this group')}
      </Button>
      <Button
        type='button'
        variant='ghost'
        size={props.open ? 'sm' : 'icon-sm'}
        className='text-muted-foreground hover:text-destructive'
        aria-label={t('Remove group')}
        title={t('Remove group')}
        disabled={props.pending || props.count === 1}
        onClick={props.onRemove}
      >
        <HugeiconsIcon icon={Delete02Icon} aria-hidden='true' />
        {props.open && t('Remove group')}
      </Button>
    </>
  )

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(
        'relative min-w-0',
        sortable.isDragging && 'z-10 opacity-80 shadow-lg'
      )}
    >
      <Collapsible open={props.open} onOpenChange={props.onOpenChange}>
        <TitledCard
          title={
            <span className='flex min-w-0 items-center gap-2'>
              <Button
                ref={sortable.setActivatorNodeRef}
                {...sortable.attributes}
                {...sortable.listeners}
                type='button'
                variant='ghost'
                size='icon-sm'
                disabled={props.pending || props.count < 2}
                aria-label={t('Drag {{group}} to reorder', {
                  group: props.title,
                })}
                title={t('Drag {{group}} to reorder', { group: props.title })}
                className='text-muted-foreground shrink-0 touch-none enabled:cursor-grab enabled:active:cursor-grabbing'
              >
                <HugeiconsIcon icon={Drag01Icon} aria-hidden='true' />
              </Button>
              <span className='truncate' title={props.title}>
                {props.title}
              </span>
            </span>
          }
          action={
            <div className='flex flex-wrap items-center justify-end gap-1'>
              {!props.open && actions}
              <GroupOrderControls
                group={props.title}
                index={props.index}
                count={props.count}
                disabled={props.pending}
                onMove={props.onMove}
              />
              <CollapsibleTrigger
                aria-label={props.open ? t('Collapse') : t('Expand')}
                render={
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='gap-1'
                  />
                }
              >
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  aria-hidden='true'
                  className={cn(
                    'transition-transform motion-reduce:transition-none',
                    props.open && 'rotate-180'
                  )}
                />
                {props.open ? t('Collapse') : t('Expand')}
              </CollapsibleTrigger>
            </div>
          }
          className='min-w-0 rounded-lg border shadow-none ring-0'
          headerClassName={cn(
            'bg-muted/30 rounded-t-lg px-4 py-2! sm:px-4 sm:py-2! [&>div]:flex-row [&>div]:items-center [&>div]:justify-between [&>div]:gap-2 [&>div>div:last-child]:w-auto',
            !props.open && 'border-b-0'
          )}
          titleClassName='truncate text-sm font-semibold tracking-normal sm:text-sm'
          contentClassName='p-0 sm:p-0'
          disableHoverEffect
        >
          <CollapsibleContent keepMounted>
            <div className='flex min-w-0 flex-col gap-3 px-4 py-3'>
              {props.children}
              {props.open && (
                <div className='flex flex-wrap items-center justify-between gap-2 border-t pt-2.5'>
                  {actions}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </TitledCard>
      </Collapsible>
    </div>
  )
}
