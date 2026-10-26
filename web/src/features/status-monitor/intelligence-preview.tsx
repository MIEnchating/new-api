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
import { focusManager, useQuery } from '@tanstack/react-query'
import { Eye, Maximize2 } from 'lucide-react'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import {
  WebPreview,
  WebPreviewBody,
} from '@/components/ai-elements/web-preview'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'

import {
  getIntelligenceResult,
  type IntelligenceTask,
} from './intelligence-api'
import { intelligencePreviewDocument } from './intelligence-html'

const IntelligencePreviewScrollingContext = createContext(false)

export function IntelligencePreviewScrollProvider(props: {
  scrolling: boolean
  children: ReactNode
}) {
  return (
    <IntelligencePreviewScrollingContext.Provider value={props.scrolling}>
      {props.children}
    </IntelligencePreviewScrollingContext.Provider>
  )
}

type IntelligencePreviewProps = {
  taskId: string
  channelId: number
  group?: string
  model?: string
  questionIndex: number
  label?: string
  variant?: 'inline' | 'button'
}

export const IntelligencePreview = memo(function IntelligencePreview(
  props: IntelligencePreviewProps
) {
  const viewport = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined'
  )
  const [visited, setVisited] = useState(visible)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const element = viewport.current
    if (
      props.variant === 'button' ||
      !element ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return
    }
    let enterTimer: ReturnType<typeof setTimeout>
    // Ignore cards crossed during a fast scroll. Once visited, keep the
    // document mounted and pause its playback when it leaves the viewport.
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(enterTimer)
      if (!entry.isIntersecting) {
        setVisible(false)
        return
      }
      enterTimer = setTimeout(() => {
        setVisible(true)
        setVisited(true)
      }, 150)
    })
    observer.observe(element)
    return () => {
      clearTimeout(enterTimer)
      observer.disconnect()
    }
  }, [props.variant])

  if (props.variant === 'button') {
    return (
      <IntelligencePreviewContent
        {...props}
        visible={false}
        expanded={expanded}
        onExpandedChange={setExpanded}
      />
    )
  }

  return (
    <div ref={viewport} className='bg-muted relative aspect-[6/5] border-t'>
      {(visited || expanded) && (
        <IntelligencePreviewContent
          {...props}
          visible={visible}
          expanded={expanded}
          onExpandedChange={setExpanded}
        />
      )}
    </div>
  )
})

function IntelligencePreviewContent(
  props: IntelligencePreviewProps & {
    visible: boolean
    expanded: boolean
    onExpandedChange: (expanded: boolean) => void
  }
) {
  const { t } = useTranslation()
  const scrolling = useContext(IntelligencePreviewScrollingContext)
  const dialogTitle = useRef<HTMLSpanElement>(null)
  // React Query shares one visibility listener across all preview cards.
  const pageVisible = useSyncExternalStore(
    focusManager.subscribe,
    () => focusManager.isFocused(),
    () => false
  )
  const query = useQuery({
    queryKey: ['status-monitor', 'intelligence-result', props.taskId],
    queryFn: () => getIntelligenceResult(props.taskId),
    enabled: pageVisible && (props.expanded || (props.visible && !scrolling)),
    staleTime: (query) =>
      findIntelligencePreview(query.state.data, props)?.html ||
      query.state.data?.status === 'succeeded' ||
      query.state.data?.status === 'failed'
        ? Infinity
        : 0,
    refetchInterval: (query) =>
      (props.expanded || (props.visible && !scrolling)) &&
      !findIntelligencePreview(query.state.data, props)?.html &&
      (query.state.data?.status === 'running' ||
        query.state.data?.status === 'pending')
        ? 3000
        : false,
    meta: { errorToast: false },
  })
  const row = findIntelligencePreview(query.data, props)
  const html = row?.html ?? ''
  const previewDocument = useMemo(
    () => (html ? intelligencePreviewDocument(html) : ''),
    [html]
  )

  let feedback: ReactNode = null
  if (query.isPending) {
    feedback = <LoadingState className='aspect-[6/5] min-h-0' />
  } else if (query.isError) {
    feedback = (
      <ErrorState className='min-h-48' onRetry={() => void query.refetch()} />
    )
  } else if (!html) {
    feedback = (
      <ErrorState
        className='min-h-48'
        title={t('Intelligence test returned no output')}
      />
    )
  }

  if (props.variant !== 'button' && feedback) return feedback

  return (
    <div className='relative'>
      {props.variant !== 'button' && (
        <div className='pointer-events-none aspect-[6/5]' inert>
          <IntelligenceAnimation
            document={previewDocument}
            active={
              pageVisible && props.visible && !props.expanded && !scrolling
            }
          />
        </div>
      )}
      <Dialog
        open={props.expanded}
        onOpenChange={props.onExpandedChange}
        title={
          <span ref={dialogTitle} tabIndex={-1}>
            {t('Generated animation preview')}
          </span>
        }
        initialFocus={dialogTitle}
        description={props.label}
        contentClassName='sm:max-w-[min(64rem,95vw)]'
        bodyClassName='flex justify-center'
        trigger={
          props.variant === 'button' ? (
            <Button type='button' variant='outline' size='sm'>
              <Eye aria-hidden='true' data-icon='inline-start' />
              {t('View result')}
            </Button>
          ) : (
            <Button
              variant='ghost'
              aria-label={t('Enlarge preview')}
              className='absolute inset-0 h-full w-full rounded-none p-0 hover:bg-transparent active:translate-y-0'
            >
              <span className='bg-background/80 text-foreground absolute right-2 bottom-2 rounded-md border p-1.5'>
                <Maximize2 aria-hidden='true' className='size-3.5' />
              </span>
            </Button>
          )
        }
      >
        {props.expanded && (
          <div className='w-full max-w-[min(960px,84vh)]'>
            {feedback || (
              <IntelligenceAnimation
                document={previewDocument}
                active={pageVisible}
              />
            )}
          </div>
        )}
      </Dialog>
    </div>
  )
}

function findIntelligencePreview(
  task: IntelligenceTask | undefined,
  props: IntelligencePreviewProps
) {
  return task?.result?.channels.find(
    (channel) =>
      channel.channel_id === props.channelId &&
      channel.group === props.group &&
      channel.model === props.model &&
      channel.question_index === props.questionIndex
  )
}

function IntelligenceAnimation(props: { document: string; active: boolean }) {
  const { t } = useTranslation()
  const viewport = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [scale, setScale] = useState(0)
  const [mounted, setMounted] = useState(props.active)
  useEffect(() => {
    if (props.active) setMounted(true)
  }, [props.active])
  const updatePlayback = useCallback(() => {
    // Opaque-origin sandboxed frames require '*'. Send only playback state;
    // the injected receiver accepts commands exclusively from its parent.
    frame.current?.contentWindow?.postMessage(
      { type: 'new-api:intelligence-playback', active: props.active },
      '*'
    )
  }, [props.active])
  useEffect(updatePlayback, [updatePlayback])
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    // Keep the generated page at a consistent desktop viewport, then fit the
    // whole scene into the card instead of cropping a full-width document.
    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / 960)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={viewport}
      data-preview-viewport
      className='bg-muted relative aspect-[6/5] overflow-hidden [contain:layout_paint]'
    >
      <WebPreview
        className='absolute top-0 left-0 h-[800px] w-[960px] origin-top-left rounded-none border-0'
        style={{ transform: `scale(${scale})` }}
      >
        {mounted && (
          <WebPreviewBody
            ref={frame}
            onLoad={updatePlayback}
            srcDoc={props.document}
            sandbox='allow-scripts'
            referrerPolicy='no-referrer'
            title={t('Generated animation preview')}
          />
        )}
      </WebPreview>
    </div>
  )
}
