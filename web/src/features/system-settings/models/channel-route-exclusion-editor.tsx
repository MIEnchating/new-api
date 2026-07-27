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
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import {
  exclusionModes,
  type ExclusionMode,
  type GroupExclusions,
  parseGroupExclusions,
  serializeGroupExclusions,
} from './route-exclusions'

function exclusionModeLabelKey(mode: ExclusionMode) {
  switch (mode) {
    case 'same_channel_retry':
      return 'Do not retry the current channel'
    case 'next_channel':
      return 'Do not switch to another channel'
    case 'all':
      return 'Do not retry or switch channels'
  }
}

type ChannelRouteExclusionEditorProps = {
  value: string
  groupOptions: string[]
  disabled: boolean
  onChange: (value: string) => void
}

export function ChannelRouteExclusionEditor(
  props: ChannelRouteExclusionEditorProps
) {
  const { t } = useTranslation()
  const exclusions = parseGroupExclusions(props.value)
  const entries = Object.entries(exclusions)
  const availableGroups = props.groupOptions.filter(
    (group) => !(group in exclusions)
  )

  const update = (next: GroupExclusions) => {
    props.onChange(serializeGroupExclusions(next))
  }

  const addRule = () => {
    const group = availableGroups[0]
    if (!group) return
    update({
      ...exclusions,
      [group]: { mode: 'all', enabled: true },
    })
  }

  return (
    <div className='space-y-3'>
      {entries.length > 0 ? (
        <div className='grid items-start gap-3 xl:grid-cols-2'>
          {entries.map(([group, rule]) => {
            const selectableGroups = [
              group,
              ...props.groupOptions.filter(
                (option) => option !== group && !(option in exclusions)
              ),
            ]
            return (
              <div
                key={group}
                className='grid min-w-0 gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,1fr)_7.5rem] sm:items-center'
              >
                <Select
                  value={group}
                  disabled={props.disabled}
                  onValueChange={(nextGroup) => {
                    if (!nextGroup || nextGroup === group) return
                    const next = { ...exclusions }
                    delete next[group]
                    next[nextGroup] = rule
                    update(next)
                  }}
                >
                  <SelectTrigger className='min-w-0'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {selectableGroups.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <Select
                  value={rule.mode}
                  disabled={props.disabled}
                  onValueChange={(nextMode) => {
                    if (!exclusionModes.includes(nextMode as ExclusionMode)) {
                      return
                    }
                    update({
                      ...exclusions,
                      [group]: {
                        ...rule,
                        mode: nextMode as ExclusionMode,
                      },
                    })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {t(exclusionModeLabelKey(rule.mode))}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='same_channel_retry'>
                        {t('Do not retry the current channel')}
                      </SelectItem>
                      <SelectItem value='next_channel'>
                        {t('Do not switch to another channel')}
                      </SelectItem>
                      <SelectItem value='all'>
                        {t('Do not retry or switch channels')}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <div className='flex items-center justify-end gap-1.5 sm:border-l sm:pl-2'>
                  <label className='text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs'>
                    <span>{t('Enabled')}</span>
                    <Switch
                      size='sm'
                      checked={rule.enabled}
                      disabled={props.disabled}
                      onCheckedChange={(enabled) =>
                        update({
                          ...exclusions,
                          [group]: { ...rule, enabled },
                        })
                      }
                    />
                  </label>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='text-destructive'
                    disabled={props.disabled}
                    aria-label={t('Delete')}
                    onClick={() => {
                      const next = { ...exclusions }
                      delete next[group]
                      update(next)
                    }}
                  >
                    <Trash2 className='size-4' />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className='text-muted-foreground rounded-md border border-dashed px-3 py-5 text-center text-sm'>
          {t('No route exclusion groups configured')}
        </div>
      )}

      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={props.disabled || availableGroups.length === 0}
        onClick={addRule}
      >
        <Plus data-icon='inline-start' />
        {t('Add excluded group')}
      </Button>
    </div>
  )
}
