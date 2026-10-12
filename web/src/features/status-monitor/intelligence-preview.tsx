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
import { Maximize2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  WebPreview,
  WebPreviewBody,
} from '@/components/ai-elements/web-preview'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'

import { getIntelligenceResult } from './intelligence-api'
import { intelligencePreviewDocument } from './intelligence-html'

export function IntelligencePreview(props: {
  taskId: string
  channelId: number
  group?: string
  questionIndex: number
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const query = useQuery({
    queryKey: ['status-monitor', 'intelligence-result', props.taskId],
    queryFn: () => getIntelligenceResult(props.taskId),
    staleTime: Infinity,
    meta: { errorToast: false },
  })
  const row = query.data?.result?.channels.find(
    (channel) =>
      channel.channel_id === props.channelId &&
      channel.group === props.group &&
      channel.question_index === props.questionIndex
  )
  const html = row?.html ?? ''
  const previewDocument = useMemo(
    () => intelligencePreviewDocument(html),
    [html]
  )

  if (query.isPending) return <LoadingState className='aspect-[6/5] min-h-0' />
  if (query.isError) {
    return (
      <ErrorState className='min-h-48' onRetry={() => void query.refetch()} />
    )
  }
  if (!html) {
    return (
      <ErrorState
        className='min-h-48'
        title={t('Intelligence test returned no output')}
      />
    )
  }

  return (
    <>
      <div className='relative border-t'>
        <div className='pointer-events-none' inert>
          <IntelligenceAnimation document={previewDocument} />
        </div>
        <Button
          variant='ghost'
          aria-label={t('Enlarge preview')}
          className='absolute inset-0 h-full w-full rounded-none p-0 hover:bg-transparent active:translate-y-0'
          onClick={() => setExpanded(true)}
        >
          <span className='bg-background/80 text-foreground absolute right-2 bottom-2 rounded-md border p-1.5'>
            <Maximize2 aria-hidden='true' className='size-3.5' />
          </span>
        </Button>
      </div>
      <Dialog
        open={expanded}
        onOpenChange={setExpanded}
        title={t('Generated animation preview')}
        contentClassName='sm:max-w-[min(64rem,95vw)]'
        bodyClassName='flex justify-center'
      >
        {expanded && (
          <div className='w-full max-w-[min(960px,84vh)]'>
            <IntelligenceAnimation document={previewDocument} />
          </div>
        )}
      </Dialog>
    </>
  )
}

function IntelligenceAnimation(props: { document: string }) {
  const { t } = useTranslation()
  const viewport = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    // Keep the generated page at a consistent desktop viewport, then fit the
    // whole scene into the card instead of cropping a full-width document.
    setScale(element.getBoundingClientRect().width / 960)
    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / 960)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [props.document])

  return (
    <div
      ref={viewport}
      data-preview-viewport
      className='bg-muted relative aspect-[6/5] overflow-hidden'
    >
      <WebPreview
        className='absolute top-0 left-0 h-[800px] w-[960px] origin-top-left rounded-none border-0'
        style={{ transform: `scale(${scale})` }}
      >
        <WebPreviewBody
          srcDoc={props.document}
          sandbox='allow-scripts'
          referrerPolicy='no-referrer'
          title={t('Generated animation preview')}
        />
      </WebPreview>
    </div>
  )
}
