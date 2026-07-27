/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TFunction } from 'i18next'
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  sideDrawerContentClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import {
  createRequestErrorRoutingRule,
  parseRequestErrorRoutingRules,
  serializeRequestErrorRoutingRules,
  type RequestErrorMessageMatchMode,
  type RequestErrorRoutingMatchMode,
  type RequestErrorRoutingRule,
} from './request-error-routing-rules'

type RequestErrorRoutingEditorProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

const actionFields = [
  ['retry_same_channel', 'Retry same channel'],
  ['switch_channel', 'Switch next channel'],
  ['switch_group', 'Switch next group'],
  ['cooldown', 'Enter cooldown'],
] as const

const verticalDragModifiers = [restrictToVerticalAxis, restrictToParentElement]

function normalizePriorities(rules: RequestErrorRoutingRule[]) {
  return rules.map((rule, priority) =>
    rule.priority === priority ? rule : { ...rule, priority }
  )
}

function getRuleDisplayName(rule: RequestErrorRoutingRule, t: TFunction) {
  if (
    rule.id === 'context-window-exceeded' &&
    rule.name === 'Context window exceeded'
  ) {
    return t('Context window exceeded')
  }
  return rule.name
}

function getRuleDisplayDescription(
  rule: RequestErrorRoutingRule,
  t: TFunction
) {
  if (
    rule.id === 'context-window-exceeded' &&
    rule.description ===
      'Do not resend an unchanged oversized request to the same channel; continue with other candidates without marking the route unhealthy.'
  ) {
    return t(
      'Do not resend an unchanged oversized request to the same channel; continue with other candidates without marking the route unhealthy.'
    )
  }
  return rule.description
}

function SortableRuleRow(props: {
  rule: RequestErrorRoutingRule
  index: number
  disabled: boolean
  onEdit: () => void
  onEnabledChange: (enabled: boolean) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const sortable = useSortable({
    id: props.rule.id,
    disabled: props.disabled,
    transition: {
      duration: 220,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
  })
  const displayName = getRuleDisplayName(props.rule, t)
  const displayDescription = getRuleDisplayDescription(props.rule, t)
  const messagePatterns = props.rule.message_patterns
    .split(/\r?\n/)
    .map((pattern) => pattern.trim())
    .filter(Boolean)
  const matchItems = [
    props.rule.status_codes.trim()
      ? {
          label: t('Match status codes'),
          value: props.rule.status_codes.trim(),
        }
      : null,
    props.rule.error_codes.trim()
      ? {
          label: t('Match error codes'),
          value: props.rule.error_codes.trim(),
        }
      : null,
    messagePatterns.length > 0
      ? {
          label: t('Match error messages'),
          value: messagePatterns.join(', '),
        }
      : null,
  ].filter((item): item is { label: string; value: string } => item !== null)
  const enabledActions = actionFields.filter(([field]) => props.rule[field])

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
        zIndex: sortable.isDragging ? 10 : undefined,
      }}
      className={cn(
        'bg-background grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] transition-[background-color,box-shadow,opacity] sm:grid-cols-[2.5rem_minmax(0,1fr)_auto]',
        !props.rule.enabled && 'bg-muted/15',
        sortable.isDragging && 'relative z-10 opacity-75 shadow-md'
      )}
    >
      <div className='border-border/60 row-span-2 flex flex-col items-center justify-center gap-0.5 border-r py-2 sm:row-span-1'>
        <span className='text-muted-foreground text-[11px] font-medium tabular-nums'>
          {props.index + 1}
        </span>
        <button
          type='button'
          ref={sortable.setActivatorNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          disabled={props.disabled}
          className='text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 touch-none items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 enabled:cursor-grab enabled:active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40'
          aria-label={t('Drag to reorder')}
          title={t('Drag to reorder')}
        >
          <GripVertical className='size-4' />
        </button>
      </div>

      <button
        type='button'
        data-press-animation='none'
        className='hover:bg-muted/20 min-w-0 px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset'
        onClick={props.onEdit}
        aria-label={t('Edit {{title}}', {
          title:
            displayName || t('Rule {{number}}', { number: props.index + 1 }),
        })}
      >
        <span className='flex min-w-0 flex-wrap items-center gap-1.5'>
          <span className='max-w-full truncate text-sm font-medium'>
            {displayName || t('Rule {{number}}', { number: props.index + 1 })}
          </span>
        </span>
        {displayDescription ? (
          <span className='text-muted-foreground mt-0.5 block truncate text-xs'>
            {displayDescription}
          </span>
        ) : null}

        <span className='mt-2 flex min-w-0 flex-wrap items-center gap-1.5'>
          <span className='text-muted-foreground text-[11px] font-medium'>
            {t('Match conditions')}
          </span>
          <span className='border-border/70 bg-muted/30 rounded-sm border px-1.5 py-0.5 text-[11px]'>
            {props.rule.match_mode === 'all'
              ? t('All conditions')
              : t('Any condition')}
          </span>
          {matchItems.length > 0 ? (
            matchItems.map((item) => (
              <span
                key={item.label}
                className='border-border/70 inline-flex max-w-80 min-w-0 rounded-sm border px-1.5 py-0.5 text-[11px] xl:max-w-96'
                title={`${item.label}: ${item.value}`}
              >
                <span className='text-muted-foreground shrink-0'>
                  {item.label}:
                </span>
                <span className='ml-1 truncate'>{item.value}</span>
              </span>
            ))
          ) : (
            <span className='text-muted-foreground text-xs'>{t('None')}</span>
          )}

          <span
            aria-hidden='true'
            className='bg-border mx-1 hidden h-3 w-px shrink-0 sm:block'
          />
          <span className='text-muted-foreground text-[11px] font-medium'>
            {t('Routing behavior')}
          </span>
          {enabledActions.length > 0 ? (
            enabledActions.map(([field, label]) => (
              <span
                key={field}
                className='border-border/70 bg-muted/30 rounded-sm border px-1.5 py-0.5 text-[11px]'
              >
                {t(label)}
              </span>
            ))
          ) : (
            <span className='text-muted-foreground text-xs'>{t('None')}</span>
          )}
        </span>
      </button>

      <div className='border-border/60 col-start-2 flex items-center justify-end gap-1 border-t px-2 py-2 sm:col-start-auto sm:border-t-0 sm:border-l'>
        <span
          className={cn(
            'mr-1 hidden text-xs font-medium md:inline',
            props.rule.enabled ? 'text-success' : 'text-muted-foreground'
          )}
        >
          {props.rule.enabled ? t('Enabled') : t('Disabled')}
        </span>
        <Switch
          size='sm'
          checked={props.rule.enabled}
          disabled={props.disabled}
          aria-label={t('Enabled')}
          onCheckedChange={props.onEnabledChange}
        />
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          aria-label={t('Edit')}
          title={t('Edit')}
          onClick={props.onEdit}
        >
          <Pencil />
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          disabled={props.disabled}
          aria-label={t('Delete')}
          title={t('Delete')}
          onClick={props.onRemove}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}

function RuleEditorSheet(props: {
  rule: RequestErrorRoutingRule | null
  disabled: boolean
  onOpenChange: (open: boolean) => void
  onChange: (patch: Partial<RequestErrorRoutingRule>) => void
}) {
  const { t } = useTranslation()
  const rule = props.rule

  return (
    <Sheet open={rule !== null} onOpenChange={props.onOpenChange}>
      <SheetContent
        side='right'
        className={sideDrawerContentClassName('sm:max-w-xl')}
      >
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {t('Edit {{title}}', {
              title: rule ? getRuleDisplayName(rule, t) : t('Edit Rule'),
            })}
          </SheetTitle>
          <SheetDescription>
            {t(
              'Configure retry, candidate failover, group failover, and cooldown behavior by error semantics.'
            )}
          </SheetDescription>
        </SheetHeader>

        {rule ? (
          <div className={sideDrawerFormClassName('gap-0')}>
            <section className='border-border/60 space-y-4 border-b pb-6'>
              <div className='flex items-center justify-between gap-4'>
                <div className='min-w-0'>
                  <Label>{t('Enabled')}</Label>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    {t('Priority {{number}} · lower numbers match first', {
                      number: rule.priority,
                    })}
                  </p>
                </div>
                <Switch
                  checked={rule.enabled}
                  disabled={props.disabled}
                  onCheckedChange={(enabled) => props.onChange({ enabled })}
                />
              </div>

              <div className='space-y-1.5'>
                <Label>{t('Rule name')}</Label>
                <Input
                  value={rule.name}
                  maxLength={100}
                  disabled={props.disabled}
                  onChange={(event) =>
                    props.onChange({ name: event.target.value })
                  }
                />
              </div>

              <div className='space-y-1.5'>
                <Label>{t('Description')}</Label>
                <Input
                  value={rule.description}
                  maxLength={500}
                  disabled={props.disabled}
                  onChange={(event) =>
                    props.onChange({ description: event.target.value })
                  }
                />
              </div>
            </section>

            <section className='border-border/60 space-y-4 border-b py-6'>
              <div className='text-sm font-semibold'>
                {t('Match conditions')}
              </div>

              <div className='grid min-w-0 gap-3 sm:grid-cols-2'>
                <div className='space-y-1.5'>
                  <Label>{t('Condition combination')}</Label>
                  <Select
                    items={[
                      { value: 'any', label: t('Any condition') },
                      { value: 'all', label: t('All conditions') },
                    ]}
                    value={rule.match_mode}
                    disabled={props.disabled}
                    onValueChange={(matchMode) =>
                      props.onChange({
                        match_mode: matchMode as RequestErrorRoutingMatchMode,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {rule.match_mode === 'all'
                          ? t('All conditions')
                          : t('Any condition')}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        <SelectItem value='any'>
                          {t('Any condition')}
                        </SelectItem>
                        <SelectItem value='all'>
                          {t('All conditions')}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1.5'>
                  <Label>{t('Match status codes')}</Label>
                  <Input
                    value={rule.status_codes}
                    disabled={props.disabled}
                    placeholder={t('e.g. 429, 500-599')}
                    onChange={(event) =>
                      props.onChange({ status_codes: event.target.value })
                    }
                  />
                </div>
              </div>

              <div className='space-y-1.5'>
                <Label>{t('Match error codes')}</Label>
                <Input
                  value={rule.error_codes}
                  disabled={props.disabled}
                  placeholder='context_length_exceeded,input_too_long'
                  onChange={(event) =>
                    props.onChange({ error_codes: event.target.value })
                  }
                />
                <p className='text-muted-foreground text-xs'>
                  {t('Separate multiple error codes with commas')}
                </p>
              </div>

              <div className='grid min-w-0 gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]'>
                <div className='space-y-1.5'>
                  <Label>{t('Error message match mode')}</Label>
                  <Select
                    items={[
                      { value: 'contains', label: t('Fuzzy contains') },
                      { value: 'exact', label: t('Exact message') },
                    ]}
                    value={rule.message_match_mode}
                    disabled={props.disabled}
                    onValueChange={(messageMatchMode) =>
                      props.onChange({
                        message_match_mode:
                          messageMatchMode as RequestErrorMessageMatchMode,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {rule.message_match_mode === 'exact'
                          ? t('Exact message')
                          : t('Fuzzy contains')}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        <SelectItem value='contains'>
                          {t('Fuzzy contains')}
                        </SelectItem>
                        <SelectItem value='exact'>
                          {t('Exact message')}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1.5'>
                  <Label>{t('Match error messages')}</Label>
                  <Textarea
                    rows={5}
                    value={rule.message_patterns}
                    disabled={props.disabled}
                    placeholder={t('One message pattern per line')}
                    onChange={(event) =>
                      props.onChange({ message_patterns: event.target.value })
                    }
                  />
                </div>
              </div>
            </section>

            <section className='space-y-3 pt-6'>
              <div className='text-sm font-semibold'>
                {t('Routing behavior')}
              </div>
              <div className='divide-border/60 border-border/60 divide-y border-y'>
                {actionFields.map(([field, label]) => (
                  <label
                    key={field}
                    className='flex min-h-12 cursor-pointer items-center justify-between gap-3 py-2.5'
                  >
                    <span className='flex min-w-0 items-center gap-2 text-sm'>
                      <span className='truncate'>{t(label)}</span>
                      {field === 'switch_group' ? (
                        <span className='bg-muted text-muted-foreground shrink-0 rounded-sm px-1.5 py-0.5 text-[11px]'>
                          {t('Group routing')}
                        </span>
                      ) : null}
                    </span>
                    <Switch
                      size='sm'
                      checked={rule[field]}
                      disabled={props.disabled}
                      onCheckedChange={(checked) =>
                        props.onChange({ [field]: checked })
                      }
                    />
                  </label>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export function RequestErrorRoutingEditor({
  value,
  onChange,
  disabled = false,
}: RequestErrorRoutingEditorProps) {
  const { t } = useTranslation()
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const rules = useMemo(
    () =>
      parseRequestErrorRoutingRules(value)
        .map((rule, sourceIndex) => ({ rule, sourceIndex }))
        .sort(
          (left, right) =>
            left.rule.priority - right.rule.priority ||
            left.sourceIndex - right.sourceIndex
        )
        .map(({ rule }) => rule),
    [value]
  )
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  const editingIndex = rules.findIndex((rule) => rule.id === editingRuleId)
  const editingRule = editingIndex >= 0 ? rules[editingIndex] : null

  const updateRules = (nextRules: RequestErrorRoutingRule[]) => {
    onChange(serializeRequestErrorRoutingRules(nextRules))
  }

  const updateRule = (
    ruleId: string,
    patch: Partial<RequestErrorRoutingRule>
  ) => {
    updateRules(
      rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule))
    )
  }

  const addRule = () => {
    const rule = createRequestErrorRoutingRule(rules.length)
    updateRules(normalizePriorities([...rules, rule]))
    setEditingRuleId(rule.id)
  }

  const removeRule = (ruleId: string) => {
    updateRules(normalizePriorities(rules.filter((rule) => rule.id !== ruleId)))
    if (editingRuleId === ruleId) setEditingRuleId(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return

    const sourceIndex = rules.findIndex((rule) => rule.id === event.active.id)
    const targetIndex = rules.findIndex((rule) => rule.id === event.over?.id)
    if (sourceIndex < 0 || targetIndex < 0) return

    updateRules(normalizePriorities(arrayMove(rules, sourceIndex, targetIndex)))
  }

  return (
    <div className='min-w-0 space-y-3'>
      <div className='flex min-h-8 items-center justify-between gap-3'>
        <span className='text-muted-foreground text-xs'>
          {t('{{count}} request error routing rules', { count: rules.length })}
        </span>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          onClick={addRule}
        >
          <Plus data-icon='inline-start' />
          {t('Add rule')}
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className='border-border/70 text-muted-foreground rounded-md border border-dashed p-4 text-sm'>
          {t('No request error routing rules')}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={verticalDragModifiers}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={rules.map((rule) => rule.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className='border-border/70 divide-border/70 min-w-0 divide-y overflow-hidden rounded-md border'>
              {rules.map((rule, index) => (
                <SortableRuleRow
                  key={rule.id}
                  rule={rule}
                  index={index}
                  disabled={disabled}
                  onEdit={() => setEditingRuleId(rule.id)}
                  onEnabledChange={(enabled) =>
                    updateRule(rule.id, { enabled })
                  }
                  onRemove={() => removeRule(rule.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <RuleEditorSheet
        rule={editingRule}
        disabled={disabled}
        onOpenChange={(open) => {
          if (!open) setEditingRuleId(null)
        }}
        onChange={(patch) => {
          if (editingRule) updateRule(editingRule.id, patch)
        }}
      />
    </div>
  )
}
