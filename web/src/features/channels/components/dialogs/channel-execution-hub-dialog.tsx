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
import { Activity, Workflow } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import {
  defaultChannelExecutionContext,
  syncExecutionTraceContext,
  updateExecutionContextGroup,
} from '../../lib/channel-execution-context'
import { ChannelExecutionPlanPanel } from './channel-execution-dialog'
import { ChannelExecutionTracePanel } from './channel-execution-trace-dialog'

type ChannelExecutionHubDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChannelExecutionHubDialog(
  props: ChannelExecutionHubDialogProps
) {
  const { t } = useTranslation()
  const [view, setView] = useState<'plan' | 'trace'>('plan')
  const [executionContext, setExecutionContext] = useState(
    defaultChannelExecutionContext
  )
  const handleGroupChange = useCallback((group: string) => {
    setExecutionContext((current) =>
      updateExecutionContextGroup(current, group)
    )
  }, [])
  const handleModelChange = useCallback((model: string) => {
    setExecutionContext((current) =>
      current.model === model ? current : { ...current, model }
    )
  }, [])
  const handleRequestPathChange = useCallback((requestPath: string) => {
    setExecutionContext((current) =>
      current.requestPath === requestPath
        ? current
        : { ...current, requestPath }
    )
  }, [])
  const handleModeChange = useCallback((mode: 'route' | 'retry') => {
    setExecutionContext((current) =>
      current.mode === mode ? current : { ...current, mode }
    )
  }, [])
  const handleTraceContextChange = useCallback(
    (context: typeof executionContext) => {
      setExecutionContext((current) =>
        syncExecutionTraceContext(current, context)
      )
    },
    []
  )

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Channel execution')}
      description={t('Execution plan')}
      descriptionClassName='sr-only'
      contentClassName='sm:max-w-5xl'
      contentHeight='min(76dvh, 720px)'
      bodyClassName='h-full pr-1'
    >
      <div className='flex h-full min-h-0 flex-col gap-3'>
        <Tabs
          value={view}
          onValueChange={(value) => setView(value as 'plan' | 'trace')}
        >
          <TabsList className='grid w-full max-w-sm grid-cols-2'>
            <TabsTrigger value='plan'>
              <Workflow className='size-4' />
              {t('Execution plan')}
            </TabsTrigger>
            <TabsTrigger value='trace'>
              <Activity className='size-4' />
              {t('Request execution trace')}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div
          className={
            view === 'plan'
              ? 'min-h-0 flex-1 overflow-y-auto'
              : 'min-h-0 flex-1 overflow-hidden'
          }
        >
          {view === 'plan' ? (
            <ChannelExecutionPlanPanel
              active={props.open}
              group={executionContext.group}
              model={executionContext.model}
              requestPath={executionContext.requestPath}
              mode={executionContext.mode}
              onGroupChange={handleGroupChange}
              onModelChange={handleModelChange}
              onRequestPathChange={handleRequestPathChange}
              onModeChange={handleModeChange}
            />
          ) : (
            <ChannelExecutionTracePanel
              active={props.open}
              group={executionContext.group}
              onGroupChange={handleGroupChange}
              onTraceContextChange={handleTraceContextChange}
            />
          )}
        </div>
      </div>
    </Dialog>
  )
}
