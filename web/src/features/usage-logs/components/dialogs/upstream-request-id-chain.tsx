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
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'

import type { UpstreamRequestAttempt, UpstreamRequestNode } from '../../types'

function upstreamRequestIdSourceLabel(
  t: (key: string) => string,
  source?: string,
  node?: UpstreamRequestNode
) {
  if (node?.service === 'sub2api' && node.role === 'client_correlation') {
    return t('Sub2API client correlation ID')
  }
  if (
    node?.service === 'sub2api-upstream' &&
    node.role === 'provider_request'
  ) {
    return t('Sub2API upstream provider request ID')
  }
  if (source === 'x-oneapi-request-id') {
    return t('New API / One API (X-Oneapi-Request-Id)')
  }
  if (source === 'x-client-request-id') {
    return t('Upstream client correlation ID (X-Client-Request-ID)')
  }
  if (source === 'x-request-id') {
    return t('Upstream response request ID (X-Request-ID)')
  }
  return t('Not recorded')
}

const COLLAPSED_REQUEST_ID_CHAIN_LENGTH = 3

export function UpstreamRequestIdChain(props: {
  requestIds: string[]
  sources?: Record<string, string>
  nodes?: UpstreamRequestNode[]
  collapsedPreview?: 'first' | 'ends'
  inline?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  const requestIdsKey = props.requestIds.join('\u001f')

  useEffect(() => {
    setExpanded(false)
  }, [requestIdsKey])

  if (props.requestIds.length === 0) return null

  const entries = props.requestIds.map((requestId, index) => ({
    requestId,
    index,
  }))
  const canCollapse =
    props.collapsedPreview === 'first'
      ? entries.length > 1
      : entries.length > COLLAPSED_REQUEST_ID_CHAIN_LENGTH
  const finalEntry = entries.at(-1)
  let visibleEntries = entries
  if (canCollapse && !expanded) {
    visibleEntries = [entries[0]]
    if (props.collapsedPreview !== 'first' && finalEntry) {
      visibleEntries.push(finalEntry)
    }
  }
  const hiddenCount = entries.length - visibleEntries.length
  const toggleLabel = t(expanded ? 'Collapse' : 'Expand')

  const renderRequestId = (entry: (typeof entries)[number]) => {
    return (
      <li
        key={`${entry.requestId}-${entry.index}`}
        className='flex min-w-0 items-start gap-2'
      >
        {entries.length > 1 && !props.inline ? (
          <span className='text-muted-foreground w-4 shrink-0 pt-0.5 text-right font-mono text-[10px] leading-5 tabular-nums'>
            {entry.index + 1}.
          </span>
        ) : null}
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-start gap-1'>
            <span className='text-foreground min-w-0 font-mono text-xs leading-5 break-all'>
              {entry.requestId}
            </span>
            <CopyButton
              value={entry.requestId}
              size='icon'
              className='text-muted-foreground hover:text-foreground -mt-0.5 size-6'
              aria-label={`${t('Copy to clipboard')}: ${entry.requestId}`}
            />
          </div>
          <div className='text-muted-foreground text-[11px] leading-4 break-words'>
            {upstreamRequestIdSourceLabel(
              t,
              props.nodes?.[entry.index]?.source ??
                props.sources?.[entry.requestId],
              props.nodes?.[entry.index]
            )}
          </div>
        </div>
      </li>
    )
  }

  return (
    <div className='flex min-w-0 flex-col gap-2'>
      {!props.inline ? (
        <h3 className='text-muted-foreground text-xs font-medium'>
          {t(
            props.requestIds.length === 1
              ? 'Upstream Request ID'
              : 'Upstream Request ID Chain'
          )}
        </h3>
      ) : null}
      <ol id={contentId} className='flex min-w-0 flex-col gap-2'>
        {canCollapse && !expanded ? (
          <>
            {renderRequestId(visibleEntries[0])}
            {visibleEntries[1] ? renderRequestId(visibleEntries[1]) : null}
          </>
        ) : (
          visibleEntries.map((entry) => renderRequestId(entry))
        )}
      </ol>
      {canCollapse ? (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='text-muted-foreground hover:text-foreground h-6 gap-1 self-start px-1 text-[11px]'
          data-press-animation='none'
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={toggleLabel}
        >
          {expanded ? (
            <ChevronUp aria-hidden='true' />
          ) : (
            <ChevronDown aria-hidden='true' />
          )}
          {expanded
            ? toggleLabel
            : t('+{{count}} more', { count: hiddenCount })}
        </Button>
      ) : null}
    </div>
  )
}

// Keep attempt boundaries even when separate responses return the same ID.
export function UpstreamRequestChain(props: {
  attempts?: UpstreamRequestAttempt[]
  requestIds: string[]
  sources?: Record<string, string>
  collapsedPreview?: 'first' | 'ends'
  inline?: boolean
}) {
  const { t } = useTranslation()
  if (!props.attempts?.length) {
    return (
      <UpstreamRequestIdChain
        requestIds={props.requestIds}
        sources={props.sources}
        collapsedPreview={props.collapsedPreview}
        inline={props.inline}
      />
    )
  }
  return (
    <div className='flex min-w-0 flex-col gap-3'>
      {!props.inline && (
        <h3 className='text-muted-foreground text-xs font-medium'>
          {t('Upstream Request ID Chain')}
        </h3>
      )}
      {props.attempts.map((attempt) => {
        const label = t('Attempt {{attempt}} · Channel {{channel}}', {
          attempt: attempt.attempt,
          channel: attempt.channel_id,
        })
        return (
          <section
            key={attempt.attempt}
            role='group'
            aria-label={label}
            className='min-w-0 space-y-2'
          >
            <h4 className='text-muted-foreground text-[11px] font-medium'>
              {label}
            </h4>
            <div className='border-border min-w-0 border-l pl-3'>
              {attempt.nodes.length > 0 ? (
                <UpstreamRequestIdChain
                  requestIds={attempt.nodes.map((node) => node.id)}
                  nodes={attempt.nodes}
                  inline
                />
              ) : (
                <p className='text-muted-foreground text-xs'>
                  {t('No upstream request ID recorded')}
                </p>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
