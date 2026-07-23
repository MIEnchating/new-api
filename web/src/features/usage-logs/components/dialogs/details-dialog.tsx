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
import type { TFunction } from 'i18next'
import {
  Copy,
  Check,
  ChevronRight,
  Route,
  Settings2,
  AlertTriangle,
  Headphones,
  Monitor,
  Cloud,
  Globe,
  ShieldCheck,
  UserCog,
  Info,
  LogIn,
  LoaderCircle,
  Activity,
  CheckCircle2,
  CircleDot,
  GitBranch,
  RefreshCcw,
  SkipForward,
  Snowflake,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import {
  StatusBadge,
  textColorMap,
  type StatusBadgeProps,
} from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Label } from '@/components/ui/label'
import { getChannelExecutionTrace } from '@/features/channels/api'
import { DynamicPricingBreakdown } from '@/features/pricing/components/dynamic-pricing-breakdown'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import {
  formatLogQuota,
  formatTimestampToDate,
  formatTokens,
  formatUseTime,
} from '@/lib/format'
import { getRoleLabelKey } from '@/lib/roles'
import { cn } from '@/lib/utils'

import type { UsageLog } from '../../data/schema'
import {
  buildChannelExecutionTimeline,
  getStandbyChannelIds,
} from '../../lib/channel-execution-timeline'
import { mergeExecutionTrace } from '../../lib/execution-trace'
import {
  parseLogOther,
  getParamOverrideActionLabel,
  parseAuditLine,
  decodeBillingExprB64,
  getTieredBillingSummary,
  hasAnyCacheTokens,
  isViolationFeeLog,
  getFirstResponseTimeColor,
  getResponseTimeColor,
  renderAuditContent,
  getAuditAuthMethodLabel,
  getAuditParamEntries,
  getLoginMethodLabel,
  getSecondFactorMethodLabel,
  getUpstreamRequestIds,
  isDuplicateLogDiagnosticMessage,
  uniqueLogDiagnosticMessages,
} from '../../lib/format'
import {
  getLogTypeConfig,
  isPerCallBilling,
  isTimingLogType,
} from '../../lib/utils'
import {
  USAGE_BILLING_PATH,
  type ChannelExecutionTraceInfo,
  type LogOtherData,
} from '../../types'

function timingTextColorClass(
  variant: 'success' | 'warning' | 'danger'
): string {
  if (variant === 'success') return 'text-emerald-600'
  if (variant === 'warning') return 'text-amber-600'
  return 'text-rose-600'
}

function formatExecutionDuration(
  startedAt: number | undefined,
  endedAt: number | undefined
) {
  if (!startedAt) return '--'
  const durationMs = Math.max(0, (endedAt ?? Date.now()) - startedAt)
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  return formatUseTime(durationMs / 1000)
}

function DetailRow(props: {
  label: React.ReactNode
  value: React.ReactNode
  mono?: boolean
  muted?: boolean
}) {
  return (
    <div className='grid min-w-0 grid-cols-[5.25rem_minmax(0,1fr)] gap-2 text-sm sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3'>
      <span className='text-muted-foreground min-w-0 text-xs'>
        {props.label}
      </span>
      <span
        className={cn(
          'max-w-full min-w-0 text-xs break-all sm:wrap-break-word',
          props.mono && 'font-mono',
          props.muted && 'text-muted-foreground'
        )}
      >
        {props.value}
      </span>
    </div>
  )
}

function DetailSection(props: {
  icon?: React.ReactNode
  iconTone?: IconBadgeTone
  label: string
  variant?: 'default' | 'danger'
  children: React.ReactNode
}) {
  const isDanger = props.variant === 'danger'
  const iconTone = isDanger ? 'destructive' : props.iconTone
  return (
    <div className='min-w-0 space-y-1.5'>
      <Label
        className={cn(
          'flex items-center gap-1.5 text-xs font-semibold',
          isDanger && 'text-red-500'
        )}
      >
        {props.icon && (
          <IconBadge tone={iconTone} size='xs'>
            {props.icon}
          </IconBadge>
        )}
        {props.label}
      </Label>
      <div
        className={cn(
          'min-w-0 space-y-1 overflow-hidden rounded-md border p-2.5 max-sm:p-2',
          isDanger
            ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20'
            : 'bg-muted/30'
        )}
      >
        {props.children}
      </div>
    </div>
  )
}

function executionEventIcon(state?: string) {
  switch (state) {
    case 'active':
      return CircleDot
    case 'success':
      return CheckCircle2
    case 'affinity_hit':
      return GitBranch
    case 'failed':
      return XCircle
    case 'cooling':
      return Snowflake
    case 'same_channel_retry':
      return RefreshCcw
    case 'skipped':
      return SkipForward
    default:
      return Activity
  }
}

function executionEventVariant(state?: string): StatusBadgeProps['variant'] {
  switch (state) {
    case 'success':
      return 'success'
    case 'failed':
      return 'danger'
    case 'active':
      return 'info'
    case 'cooling':
    case 'same_channel_retry':
      return 'warning'
    case 'affinity_hit':
      return 'purple'
    default:
      return 'neutral'
  }
}

function executionEventLabel(state?: string, isGroupEvent = false) {
  if (isGroupEvent) {
    switch (state) {
      case 'affinity_hit':
        return 'Reused affinity group'
      case 'cooling':
        return 'Group entered cooldown'
      case 'skipped':
        return 'Candidate group skipped'
    }
  }
  switch (state) {
    case 'active':
      return 'Channel request started'
    case 'affinity_hit':
      return 'Reused affinity channel'
    case 'same_channel_retry':
      return 'Same-channel retry'
    case 'success':
      return 'Channel request succeeded'
    case 'failed':
      return 'Failed'
    case 'cooling':
      return 'Cooling'
    case 'skipped':
      return 'Skipped'
    case 'finished':
      return 'Finished'
    default:
      return 'Unknown'
  }
}

function executionEventDescription(state?: string, isGroupEvent = false) {
  if (isGroupEvent) {
    return 'This is a group-routing decision, not an upstream channel request'
  }
  switch (state) {
    case 'active':
      return 'The upstream request has been sent to this channel'
    case 'affinity_hit':
      return 'The last successful channel was selected from the same matching context; no upstream request has been sent at this stage'
    case 'success':
      return 'This channel returned a successful response'
    default:
      return ''
  }
}

function executionEventReasonLabel(reason?: string) {
  switch (reason) {
    case 'route_affinity':
      return 'Route affinity'
    case 'channel_affinity':
      return 'Channel affinity'
    case 'affinity_cooling':
      return 'Affinity target is cooling'
    case 'cooling':
      return 'Channel is cooling'
    case 'group_route_failure':
      return 'Group route failed'
    case 'group_affinity':
      return 'Group affinity'
    case 'group_cooling':
      return 'Group is cooling'
    case 'group_unsupported':
      return 'Group does not support this request'
    default:
      return reason || ''
  }
}

function executionTraceStatusLabel(status?: string) {
  switch (status) {
    case 'running':
      return 'Running'
    case 'success':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Unknown'
  }
}

type ChannelExecutionStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'cooling'
  | 'skipped'

function channelExecutionStatusFromEvent(
  state?: string
): ChannelExecutionStatus | undefined {
  switch (state) {
    case 'active':
    case 'affinity_hit':
    case 'same_channel_retry':
      return 'running'
    case 'success':
      return 'success'
    case 'failed':
      return 'failed'
    case 'cooling':
      return 'cooling'
    case 'skipped':
      return 'skipped'
    default:
      return undefined
  }
}

function channelExecutionStatusLabel(status?: ChannelExecutionStatus) {
  switch (status) {
    case 'running':
      return 'Running'
    case 'success':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    case 'cooling':
      return 'Cooling'
    case 'skipped':
      return 'Skipped'
    default:
      return 'Unknown'
  }
}

function channelExecutionStatusVariant(
  status?: ChannelExecutionStatus
): StatusBadgeProps['variant'] {
  switch (status) {
    case 'running':
      return 'info'
    case 'success':
      return 'success'
    case 'failed':
      return 'danger'
    case 'cooling':
      return 'warning'
    default:
      return 'neutral'
  }
}

function routeGroupStatusLabel(status?: string) {
  switch (status) {
    case 'active':
      return 'Active'
    case 'cooling':
      return 'Cooling'
    case 'skipped':
      return 'Skipped'
    case 'success':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    default:
      return 'Pending'
  }
}

function routeGroupStatusVariant(status?: string): StatusBadgeProps['variant'] {
  switch (status) {
    case 'active':
      return 'info'
    case 'cooling':
      return 'warning'
    case 'success':
      return 'success'
    case 'failed':
      return 'danger'
    default:
      return 'neutral'
  }
}

type RouteGroupStatus = NonNullable<
  ChannelExecutionTraceInfo['route_group_statuses']
>[number]

function RouteGroupChain(props: {
  groups: string[]
  statuses?: RouteGroupStatus[]
  actualGroup?: string
  traceStatus?: ChannelExecutionTraceInfo['status']
  t: TFunction
}) {
  const statusByGroup = new Map(
    props.statuses?.map((item) => [item.group, item.status]) ?? []
  )

  return (
    <span className='flex min-w-0 flex-wrap items-center gap-1.5'>
      {props.groups.map((group, index) => {
        let status = statusByGroup.get(group)
        if (!status && group === props.actualGroup) {
          status = props.traceStatus === 'success' ? 'success' : 'active'
        }
        return (
          <span key={group} className='contents'>
            {index > 0 ? (
              <ChevronRight
                className='text-muted-foreground size-3 shrink-0'
                aria-hidden='true'
              />
            ) : null}
            <span className='inline-flex min-w-0 items-center gap-1'>
              <span className='font-mono text-xs font-medium break-all'>
                {group}
              </span>
              <StatusBadge
                variant={routeGroupStatusVariant(status)}
                size='sm'
                copyable={false}
              >
                {props.t(routeGroupStatusLabel(status))}
              </StatusBadge>
            </span>
          </span>
        )
      })}
    </span>
  )
}

function executionTraceVariant(status?: string): StatusBadgeProps['variant'] {
  if (status === 'success') return 'success'
  if (status === 'running') return 'info'
  return 'danger'
}

function formatRatio(ratio: number | undefined): string {
  if (ratio == null) return '-'
  return ratio.toFixed(4)
}

function getUsageBillingPathLabel(
  t: TFunction,
  adminInfo: LogOtherData['admin_info']
): string {
  switch (adminInfo?.usage_billing_path) {
    case USAGE_BILLING_PATH.LOCAL:
      return t('Local Billing')
    case USAGE_BILLING_PATH.OPENAI:
      return t('Upstream Response (billing-usage-openai)')
    case USAGE_BILLING_PATH.OPENAI_ESTIMATED:
      return t('Upstream Response (billing-usage-openai-estimated)')
    case USAGE_BILLING_PATH.ANTHROPIC:
      return t('Upstream Response (billing-usage-anthropic)')
    case USAGE_BILLING_PATH.ANTHROPIC_ESTIMATED:
      return t('Upstream Response (billing-usage-anthropic-estimated)')
    case USAGE_BILLING_PATH.GEMINI:
      return t('Upstream Response (billing-usage-gemini)')
    case USAGE_BILLING_PATH.GEMINI_ESTIMATED:
      return t('Upstream Response (billing-usage-gemini-estimated)')
    case USAGE_BILLING_PATH.UPSTREAM:
      return t('Upstream Response')
    default:
      return adminInfo?.local_count_tokens
        ? t('Local Billing')
        : t('Upstream Response')
  }
}

function isUsageBillingPathLocal(
  adminInfo: LogOtherData['admin_info']
): boolean {
  if (adminInfo?.usage_billing_path) {
    return adminInfo.usage_billing_path === USAGE_BILLING_PATH.LOCAL
  }
  return adminInfo?.local_count_tokens === true
}

function quotaSaturationKindLabel(
  kind: 'overflow' | 'underflow' | 'nan',
  t: (key: string) => string
): string {
  if (kind === 'overflow') return t('Overflow')
  if (kind === 'underflow') return t('Underflow')
  return t('Invalid (NaN)')
}

function BillingBreakdown(props: {
  log: UsageLog
  other: LogOtherData
  isAdmin: boolean
}) {
  const { t } = useTranslation()
  const { log, other, isAdmin } = props
  const isPerCall = isPerCallBilling(other.model_price)
  const isClaude = other.claude === true
  const isTieredExpr = other.billing_mode === 'tiered_expr'
  const tieredSummary = getTieredBillingSummary(other)

  const rows: Array<{ label: string; value: string }> = []
  const priceOpts = { digitsLarge: 4, digitsSmall: 6, abbreviate: false }
  const fmtPrice = (usd: number) => formatBillingCurrencyFromUSD(usd, priceOpts)
  const baseInputUSD = other.model_ratio != null ? other.model_ratio * 2.0 : 0

  if (isTieredExpr) {
    rows.push({
      label: t('Billing Mode'),
      value: t('Dynamic Pricing'),
    })
    if (tieredSummary) {
      if (tieredSummary.tier.label) {
        rows.push({
          label: t('Matched Tier'),
          value: tieredSummary.tier.label,
        })
      }
      for (const entry of tieredSummary.priceEntries) {
        rows.push({
          label: t(entry.shortLabel),
          value: `${fmtPrice(entry.price)}/M`,
        })
      }
    } else {
      rows.push({
        label: t('Matched Tier'),
        value: t('No matching results'),
      })
    }
  } else if (isPerCall) {
    rows.push({ label: t('Billing Mode'), value: t('Per-call') })
    if (other.model_price != null) {
      rows.push({
        label: t('Model Price'),
        value: fmtPrice(other.model_price),
      })
    }
  } else {
    rows.push({ label: t('Billing Mode'), value: t('Per-token') })
    if (other.model_ratio != null) {
      rows.push({
        label: t('Input'),
        value: `${fmtPrice(baseInputUSD)}/M`,
      })
    }
    if (other.completion_ratio != null && other.model_ratio != null) {
      rows.push({
        label: t('Output'),
        value: `${fmtPrice(baseInputUSD * other.completion_ratio)}/M`,
      })
    }
  }

  const userGR = other.user_group_ratio
  const isUserGR = userGR != null && Number.isFinite(userGR) && userGR !== -1
  const effectiveGR = isUserGR ? userGR : other.group_ratio
  if (effectiveGR != null && Number.isFinite(effectiveGR)) {
    rows.push({
      label: isUserGR ? t('User Exclusive Ratio') : t('Group Ratio'),
      value: `${formatRatio(effectiveGR)}x`,
    })
  }

  if (!isTieredExpr && isClaude && hasAnyCacheTokens(other)) {
    if (other.cache_ratio != null && other.cache_ratio !== 1) {
      rows.push({
        label: t('Cache Read'),
        value: `${fmtPrice(baseInputUSD * other.cache_ratio)}/M`,
      })
    }
    if (
      other.cache_creation_ratio != null &&
      other.cache_creation_ratio !== 1
    ) {
      rows.push({
        label: t('Cache Creation'),
        value: `${fmtPrice(baseInputUSD * other.cache_creation_ratio)}/M`,
      })
    }
    if (
      other.cache_creation_ratio_5m != null &&
      other.cache_creation_ratio_5m !== 0
    ) {
      rows.push({
        label: t('Cache Creation (5m)'),
        value: `${fmtPrice(baseInputUSD * other.cache_creation_ratio_5m)}/M`,
      })
    }
    if (
      other.cache_creation_ratio_1h != null &&
      other.cache_creation_ratio_1h !== 0
    ) {
      rows.push({
        label: t('Cache Creation (1h)'),
        value: `${fmtPrice(baseInputUSD * other.cache_creation_ratio_1h)}/M`,
      })
    }
  }

  if (!isTieredExpr) {
    if (other.audio_ratio != null && other.audio_ratio !== 1) {
      rows.push({
        label: t('Audio input'),
        value: `${fmtPrice(baseInputUSD * other.audio_ratio)}/M`,
      })
    }

    if (
      other.audio_completion_ratio != null &&
      other.audio_completion_ratio !== 1
    ) {
      rows.push({
        label: t('Audio output'),
        value: `${fmtPrice(baseInputUSD * other.audio_completion_ratio)}/M`,
      })
    }

    if (other.image_ratio != null && other.image_ratio !== 1) {
      rows.push({
        label: t('Image input'),
        value: `${fmtPrice(baseInputUSD * other.image_ratio)}/M`,
      })
    }
  }

  if (other.web_search && other.web_search_call_count) {
    rows.push({
      label: t('Web Search'),
      value: `${other.web_search_call_count}x${other.web_search_price ? ` (${fmtPrice(other.web_search_price)})` : ''}`,
    })
  }

  if (other.file_search && other.file_search_call_count) {
    rows.push({
      label: t('File Search'),
      value: `${other.file_search_call_count}x${other.file_search_price ? ` (${fmtPrice(other.file_search_price)})` : ''}`,
    })
  }

  if (other.image_generation_call && other.image_generation_call_price) {
    rows.push({
      label: t('Image Generation'),
      value: fmtPrice(other.image_generation_call_price),
    })
  }

  if (other.audio_input_seperate_price && other.audio_input_price) {
    rows.push({
      label: t('Audio Input Price'),
      value: fmtPrice(other.audio_input_price),
    })
  }

  if (isAdmin && other.admin_info) {
    rows.push({
      label: t('Billing Path'),
      value: getUsageBillingPathLabel(t, other.admin_info),
    })
  }

  rows.push({
    label: t('Total Cost'),
    value: formatLogQuota(log.quota),
  })

  if (rows.length === 0) return null

  return (
    <DetailSection label={t('Billing Details')}>
      {rows.map((row) => (
        <DetailRow key={row.label} label={row.label} value={row.value} mono />
      ))}
    </DetailSection>
  )
}

function TokenBreakdown(props: { log: UsageLog; other: LogOtherData }) {
  const { t } = useTranslation()
  const { log, other } = props

  const promptTokens = log.prompt_tokens || 0
  const completionTokens = log.completion_tokens || 0
  const cacheRead = other.cache_tokens || 0
  const cacheWrite = other.cache_creation_tokens || 0
  const cacheWrite5m = other.cache_creation_tokens_5m || 0
  const cacheWrite1h = other.cache_creation_tokens_1h || 0
  const hasTokens = promptTokens > 0 || completionTokens > 0

  if (!hasTokens) return null

  const rows: Array<{ label: string; value: string }> = []

  rows.push({ label: t('Input Tokens'), value: promptTokens.toLocaleString() })
  rows.push({
    label: t('Output Tokens'),
    value: completionTokens.toLocaleString(),
  })

  if (cacheRead > 0) {
    rows.push({
      label: t('Cache Read'),
      value: cacheRead.toLocaleString(),
    })
  }

  if (cacheWrite > 0 && cacheWrite5m === 0 && cacheWrite1h === 0) {
    rows.push({
      label: t('Cache Write'),
      value: cacheWrite.toLocaleString(),
    })
  }

  if (cacheWrite5m > 0) {
    rows.push({
      label: t('Cache Write (5m)'),
      value: cacheWrite5m.toLocaleString(),
    })
  }

  if (cacheWrite1h > 0) {
    rows.push({
      label: t('Cache Write (1h)'),
      value: cacheWrite1h.toLocaleString(),
    })
  }

  if (other.image && other.image_output) {
    rows.push({
      label: t('Image Tokens'),
      value: other.image_output.toLocaleString(),
    })
  }

  return (
    <DetailSection label={t('Token Breakdown')}>
      {rows.map((row) => (
        <DetailRow key={row.label} label={row.label} value={row.value} mono />
      ))}
    </DetailSection>
  )
}

interface DetailsDialogProps {
  log: UsageLog
  isAdmin: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DetailsDialog(props: DetailsDialogProps) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })
  const details = props.log.content ?? ''
  const other = parseLogOther(props.log.other)
  const typeConfig = getLogTypeConfig(props.log.type)

  const isViolation = isViolationFeeLog(other)
  const isRefund = props.log.type === 6
  const isConsume = props.log.type === 2
  const isTopup = props.log.type === 1
  const isManage = props.log.type === 3
  const isLogin = props.log.type === 7
  const isSubscription = other?.billing_source === 'subscription'
  const isTieredBilling =
    isConsume &&
    !isViolation &&
    other?.billing_mode === 'tiered_expr' &&
    !!other?.expr_b64
  const hasAudioTokens = other?.ws || other?.audio
  const showTiming = isTimingLogType(props.log.type)
  const showAdminIp =
    !!props.log.ip && (showTiming || isManage || (props.isAdmin && isTopup))
  const adminInfo = other?.admin_info
  const storedExecutionTrace = adminInfo?.channel_execution_trace
  const fullExecutionTraceQuery = useQuery({
    queryKey: ['channel-execution-trace', props.log.request_id],
    queryFn: () => getChannelExecutionTrace(props.log.request_id),
    enabled:
      props.open &&
      props.isAdmin &&
      Boolean(storedExecutionTrace) &&
      Boolean(props.log.request_id),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: (query) =>
      props.open && query.state.data?.data?.status === 'running'
        ? 1_000
        : false,
    retry: false,
  })
  const fetchedExecutionTrace = fullExecutionTraceQuery.data?.success
    ? fullExecutionTraceQuery.data.data
    : undefined
  const executionTrace = mergeExecutionTrace(
    storedExecutionTrace,
    fetchedExecutionTrace
  )
  const executionEvents = executionTrace?.events ?? []
  const executionTimeline = buildChannelExecutionTimeline(executionEvents)
  const standbyChannelIds = getStandbyChannelIds(executionTimeline)
  const lastFailedAttemptIndex = executionTimeline.reduce(
    (lastIndex, item, index) =>
      item.kind === 'attempt' && item.state === 'failed' ? index : lastIndex,
    -1
  )
  let executionTraceStatus = executionTrace?.status
  if (executionTraceStatus === 'running') {
    // A persisted consume log is created only after the upstream response is
    // complete. Use that terminal log type when the Redis trace is stale.
    if (props.log.type === 2) {
      executionTraceStatus = 'success'
    } else if (props.log.type === 5) {
      executionTraceStatus = 'failed'
    }
  }
  const showExecutionSummary = executionTrace?.compact === true
  const executionSummaryChannelIDs =
    executionTrace?.channel_ids ??
    executionEvents
      .filter((event) => event.state === 'active' && event.channel_id)
      .map((event) => event.channel_id as number)
  const channelStatusByID = new Map<number, ChannelExecutionStatus>()
  const channelStatusEventIndexByID = new Map<number, number>()
  const channelSelectionEventIndexByID = new Map<number, number>()
  executionEvents.forEach((event, index) => {
    if (!event.channel_id) return
    const status = channelExecutionStatusFromEvent(event.state)
    if (!status) return
    channelStatusByID.set(event.channel_id, status)
    // Attach the status badge to the latest state event, including terminal
    // success/failed events rather than the preceding request-start event.
    channelStatusEventIndexByID.set(event.channel_id, index)
    if (
      event.state === 'active' ||
      event.state === 'affinity_hit' ||
      event.state === 'same_channel_retry'
    ) {
      channelSelectionEventIndexByID.set(event.channel_id, index)
    }
  })

  if (executionEvents.length === 0) {
    const summaryChannelIDs = [...new Set(executionSummaryChannelIDs ?? [])]
    summaryChannelIDs.forEach((channelID, index) => {
      const isLastChannel = index === summaryChannelIDs.length - 1
      let status: ChannelExecutionStatus = 'failed'
      if (isLastChannel && executionTraceStatus === 'success') {
        status = 'success'
      } else if (executionTraceStatus === 'running') {
        status = 'running'
      }
      channelStatusByID.set(channelID, status)
    })
  } else if (executionTraceStatus === 'success') {
    // A compact SQL summary can already be terminal while the cached event
    // list is one update behind. Treat the latest selected channel as the
    // successful one and earlier still-active selections as failed attempts.
    const latestSelectionIndex = Math.max(
      ...channelSelectionEventIndexByID.values(),
      -1
    )
    for (const [channelID, status] of channelStatusByID) {
      if (status !== 'running') continue
      channelStatusByID.set(
        channelID,
        channelSelectionEventIndexByID.get(channelID) === latestSelectionIndex
          ? 'success'
          : 'failed'
      )
    }
  } else if (
    executionTraceStatus === 'failed' ||
    executionTraceStatus === 'cancelled'
  ) {
    // A failed/cancelled request can end before a separate terminal event is
    // published. Mark any still-active channel as failed in that case.
    for (const [channelID, status] of channelStatusByID) {
      if (status === 'running') channelStatusByID.set(channelID, 'failed')
    }
  }
  const executionRouteGroups = executionTrace?.route_groups ?? []
  const actualExecutionGroup =
    executionTrace?.group || props.log.group || other?.group || ''
  let groupDetails: React.ReactNode = null
  if (executionRouteGroups.length > 0) {
    groupDetails = (
      <>
        <DetailRow
          label={t('Group route chain')}
          value={
            <RouteGroupChain
              groups={executionRouteGroups}
              statuses={executionTrace?.route_group_statuses}
              actualGroup={actualExecutionGroup}
              traceStatus={executionTraceStatus}
              t={t}
            />
          }
        />
        {actualExecutionGroup ? (
          <DetailRow
            label={t('Actual execution group')}
            value={actualExecutionGroup}
            mono
          />
        ) : null}
      </>
    )
  } else if (props.log.group || other?.group) {
    groupDetails = (
      <DetailRow
        label={t('Group')}
        value={props.log.group || other?.group || ''}
        mono
      />
    )
  }
  const hasUsageBillingPath =
    adminInfo?.usage_billing_path != null ||
    adminInfo?.local_count_tokens != null
  const topupAuditFields =
    isTopup && props.isAdmin && adminInfo
      ? ([
          adminInfo.payment_method && {
            label: t('Order Payment Method'),
            value: adminInfo.payment_method,
          },
          adminInfo.callback_payment_method && {
            label: t('Callback Payment Method'),
            value: adminInfo.callback_payment_method,
          },
          adminInfo.caller_ip && {
            label: t('Callback Caller IP'),
            value: adminInfo.caller_ip,
          },
          adminInfo.server_ip && {
            label: t('Server IP'),
            value: adminInfo.server_ip,
          },
          adminInfo.node_name && {
            label: t('Node Name'),
            value: adminInfo.node_name,
          },
          adminInfo.version && {
            label: t('System Version'),
            value: adminInfo.version,
          },
        ].filter(Boolean) as Array<{ label: string; value: string }>)
      : []
  const showLegacyTopupWarning = isTopup && props.isAdmin && !adminInfo
  const showTopupAuditSection =
    isTopup &&
    props.isAdmin &&
    (topupAuditFields.length > 0 || showLegacyTopupWarning)
  const manageOperator = (() => {
    if (!isManage || !adminInfo) return null
    const username = adminInfo.admin_username
    const id = adminInfo.admin_id
    const hasUsername = username != null && String(username).trim() !== ''
    const hasId = id != null && String(id).trim() !== ''
    if (!hasUsername && !hasId) return null
    if (hasUsername && hasId) return `${username} (ID: ${id})`
    if (hasUsername) return String(username)
    return `ID: ${id}`
  })()
  const adminRoleLabel =
    isManage && adminInfo?.admin_role != null
      ? `${t(getRoleLabelKey(adminInfo.admin_role))} (${adminInfo.admin_role})`
      : ''
  const authMethodLabel = isManage
    ? getAuditAuthMethodLabel(adminInfo?.auth_method, t)
    : ''

  // Localized operation text rendered from the language-independent op
  // descriptor (shared by audit type=3 and login type=7).
  const operationText = renderAuditContent(other, t)
  const contentText =
    (isManage || isLogin) && operationText ? operationText : details
  const operationIdentifier = other?.op?.action ?? ''
  const streamEndErrorIsDuplicate = isDuplicateLogDiagnosticMessage(
    other?.stream_status?.end_error,
    details
  )
  const uniqueStreamErrors = uniqueLogDiagnosticMessages(
    other?.stream_status?.errors,
    details
  )
  const auditParamEntries =
    isManage || isLogin ? getAuditParamEntries(other, t) : []
  const auditRoute = isManage ? other?.audit_info : undefined
  const routeParams = Object.entries(auditRoute?.params ?? {})
  const routeParamsText = routeParams
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')
  const auditSuccess =
    auditRoute?.success ??
    (auditRoute?.status != null ? auditRoute.status < 400 : undefined)
  const auditResultText =
    auditSuccess == null
      ? ''
      : `${auditSuccess ? t('Success') : t('Failed')}${
          auditRoute?.status != null ? ` (${auditRoute.status})` : ''
        }`
  const showManageAuditSection =
    isManage &&
    Boolean(
      operationText ||
      operationIdentifier ||
      manageOperator ||
      adminRoleLabel ||
      authMethodLabel ||
      auditParamEntries.length > 0 ||
      auditRoute
    )

  // Login audit (type=7); visible to the log owner, not admin-only.
  const loginAuditFields = isLogin
    ? ([
        other?.login_method && {
          label: t('Login Method'),
          value: getLoginMethodLabel(other.login_method, t),
        },
        other?.second_factor_method && {
          label: t('Second-factor method'),
          value: getSecondFactorMethodLabel(other.second_factor_method, t),
        },
        (other?.request_route || other?.request_path) && {
          label: t('Request'),
          value: [
            other.request_method,
            other.request_route || other.request_path,
          ]
            .filter(Boolean)
            .join(' '),
          mono: true,
        },
        other?.request_path &&
          other.request_route &&
          other.request_path !== other.request_route && {
            label: t('Path'),
            value: other.request_path,
            mono: true,
          },
        {
          label: t('Result'),
          value: t('Success'),
        },
        props.log.ip && {
          label: t('IP Address'),
          value: props.log.ip,
          mono: true,
        },
        other?.user_agent && {
          label: t('User Agent'),
          value: String(other.user_agent),
        },
      ].filter(Boolean) as Array<{
        label: string
        value: string
        mono?: boolean
      }>)
    : []
  const showLoginAuditSection =
    isLogin &&
    Boolean(
      operationText ||
      operationIdentifier ||
      auditParamEntries.length > 0 ||
      loginAuditFields.length > 0
    )

  const conversionChain =
    other && Array.isArray(other.request_conversion)
      ? other.request_conversion.filter(Boolean)
      : []
  const conversionLabel =
    conversionChain.length <= 1
      ? t('Native format')
      : conversionChain.join(' -> ')
  const showConversion =
    props.isAdmin &&
    isDisplayableType(props.log.type) &&
    props.log.type !== 6 &&
    (other?.request_path || conversionChain.length > 0)

  const useChannel = other?.admin_info?.use_channel
  const channelChain =
    useChannel && useChannel.length > 0 ? useChannel.join(' → ') : undefined
  const upstreamRequestIds = getUpstreamRequestIds(
    other?.admin_info?.upstream_request_ids,
    props.log.upstream_request_id
  )
  let reasoningEffortVariant: StatusBadgeProps['variant'] = 'green'
  if (other?.reasoning_effort === 'high') {
    reasoningEffortVariant = 'orange'
  } else if (other?.reasoning_effort === 'medium') {
    reasoningEffortVariant = 'yellow'
  }

  let dialogWidthClass = 'sm:max-w-lg'
  if (isTieredBilling) {
    dialogWidthClass = 'sm:max-w-4xl lg:max-w-5xl'
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open)
      }}
      title={
        <>
          {t('Log Details')}
          <StatusBadge
            label={t(typeConfig.label)}
            variant={typeConfig.color as StatusBadgeProps['variant']}
            size='sm'
            copyable={false}
          />
        </>
      }
      description={t('View the complete details for this log entry')}
      contentClassName={cn(
        'min-w-0 overflow-hidden',
        'max-sm:max-h-[calc(100dvh-1.5rem)] max-sm:w-[calc(100vw-1.5rem)] max-sm:max-w-[calc(100vw-1.5rem)] max-sm:p-4',
        dialogWidthClass
      )}
      headerClassName='max-sm:gap-1'
      titleClassName='flex items-center gap-2 text-base'
      descriptionClassName='sr-only'
      contentHeight='min(72dvh, 720px)'
      bodyClassName='pr-2 sm:pr-4'
    >
      <div className='w-full max-w-full min-w-0 space-y-2.5 overflow-x-hidden py-1 sm:space-y-3'>
        {/* Overview section - key identifiers */}
        <div className='min-w-0 space-y-1'>
          <DetailRow
            label={t('Time')}
            value={formatTimestampToDate(props.log.created_at)}
            mono
          />
          {(!isManage || !manageOperator) &&
            (props.log.username || props.log.user_id > 0) && (
              <DetailRow
                label={t('User')}
                value={
                  props.log.username
                    ? `${props.log.username}${
                        props.log.user_id > 0
                          ? ` (ID: ${props.log.user_id})`
                          : ''
                      }`
                    : `ID: ${props.log.user_id}`
                }
              />
            )}
          {props.log.request_id && (
            <DetailRow
              label={t('Request ID')}
              value={props.log.request_id}
              mono
            />
          )}
          {props.isAdmin && upstreamRequestIds.length === 1 && (
            <DetailRow
              label={t('Upstream Request ID')}
              value={upstreamRequestIds[0]}
              mono
            />
          )}
          {props.isAdmin && upstreamRequestIds.length > 1 && (
            <DetailRow
              label={t('Upstream Request ID Chain')}
              value={
                <span className='flex min-w-0 flex-col gap-1'>
                  {upstreamRequestIds.map((requestId, index) => (
                    <span key={requestId} className='flex min-w-0 gap-2'>
                      <span className='text-muted-foreground shrink-0 tabular-nums'>
                        {index + 1}.
                      </span>
                      <span className='min-w-0 break-all'>{requestId}</span>
                    </span>
                  ))}
                </span>
              }
              mono
            />
          )}
          {manageOperator && (
            <DetailRow
              label={
                <span className='flex items-center gap-1.5'>
                  <UserCog
                    className='text-muted-foreground size-3.5'
                    aria-hidden='true'
                  />
                  {t('Operator Admin')}
                </span>
              }
              value={manageOperator}
              mono
            />
          )}

          {props.isAdmin && props.log.channel > 0 && (
            <DetailRow
              label={t('Channel')}
              value={
                <span>
                  {props.log.channel}
                  {props.log.channel_name && (
                    <span className='text-muted-foreground'>
                      {' '}
                      ({props.log.channel_name})
                    </span>
                  )}
                </span>
              }
              mono
            />
          )}

          {channelChain && props.isAdmin && (
            <DetailRow label={t('Retry Chain')} value={channelChain} mono />
          )}

          {props.log.token_name && (
            <DetailRow label={t('Token')} value={props.log.token_name} mono />
          )}

          {groupDetails}

          {showAdminIp && (
            <DetailRow
              label={t('IP Address')}
              value={
                <span className='flex items-center gap-1'>
                  <Globe className='size-3 text-amber-500' aria-hidden='true' />
                  {props.log.ip}
                </span>
              }
              mono
            />
          )}

          {showTiming && props.log.use_time > 0 && (
            <DetailRow
              label={t('Response Time')}
              value={
                <span
                  className={cn(
                    'font-medium',
                    timingTextColorClass(
                      getResponseTimeColor(
                        props.log.use_time,
                        props.log.completion_tokens
                      )
                    )
                  )}
                >
                  {formatUseTime(props.log.use_time)}
                  {props.log.is_stream &&
                    other?.frt != null &&
                    other.frt > 0 && (
                      <span
                        className={cn(
                          'font-normal',
                          timingTextColorClass(
                            getFirstResponseTimeColor(other.frt / 1000)
                          )
                        )}
                      >
                        {' '}
                        (FRT: {formatUseTime(other.frt / 1000)})
                      </span>
                    )}
                </span>
              }
            />
          )}
        </div>

        {props.isAdmin &&
        executionTrace &&
        (executionTrace.compact || executionEvents.length > 0) ? (
          <DetailSection
            icon={<Activity className='size-3.5' aria-hidden='true' />}
            label={t('Channel execution trace')}
          >
            <div className='mb-2 flex flex-wrap items-center gap-2 border-b pb-2'>
              <StatusBadge
                variant={executionTraceVariant(executionTraceStatus)}
                size='sm'
                copyable={false}
              >
                {t(executionTraceStatusLabel(executionTraceStatus))}
              </StatusBadge>
              <span className='text-muted-foreground text-xs'>
                {t(
                  executionTrace.mode === 'route'
                    ? 'Channel routing'
                    : 'Traditional retry'
                )}
              </span>
              {actualExecutionGroup ? (
                <StatusBadge variant='neutral' size='sm' copyable={false}>
                  {t('Actual execution group')}: {actualExecutionGroup}
                </StatusBadge>
              ) : null}
              {showExecutionSummary ? (
                <StatusBadge variant='neutral' size='sm' copyable={false}>
                  {t('Execution summary')}
                </StatusBadge>
              ) : null}
              {fullExecutionTraceQuery.isFetching ? (
                <span className='text-muted-foreground inline-flex items-center gap-1 text-xs'>
                  <LoaderCircle
                    className='size-3 animate-spin'
                    aria-hidden='true'
                  />
                  {t('Loading')}
                </span>
              ) : null}
            </div>
            <div className='space-y-2'>
              {executionEvents.length === 0 &&
              executionSummaryChannelIDs?.length ? (
                <DetailRow
                  label={t('Status')}
                  value={
                    <span className='flex min-w-0 flex-wrap items-center gap-1.5'>
                      {[...new Set(executionSummaryChannelIDs)].map(
                        (channelID) => {
                          const status = channelStatusByID.get(channelID)
                          return (
                            <StatusBadge
                              key={channelID}
                              variant={channelExecutionStatusVariant(status)}
                              size='sm'
                              copyable={false}
                            >
                              <span className='font-mono'>#{channelID}</span>
                              <span>
                                {t(channelExecutionStatusLabel(status))}
                              </span>
                            </StatusBadge>
                          )
                        }
                      )}
                    </span>
                  }
                />
              ) : null}
              {standbyChannelIds.length > 0 ? (
                <DetailRow
                  label={t('Standby channels')}
                  value={
                    <span className='flex min-w-0 flex-wrap items-center gap-1.5'>
                      {standbyChannelIds.map((channelID) => (
                        <StatusBadge
                          key={channelID}
                          variant='neutral'
                          size='sm'
                          copyable={false}
                        >
                          <span className='font-mono'>#{channelID}</span>
                        </StatusBadge>
                      ))}
                      <span className='text-muted-foreground text-[11px]'>
                        {t(
                          'Not executed; used only if the current channel fails'
                        )}
                      </span>
                    </span>
                  }
                />
              ) : null}
            </div>
            {executionTimeline.length > 0 ? (
              <div className='mt-3 border-t pt-3'>
                {executionTimeline.map((item, index, items) => {
                  if (item.kind === 'attempt') {
                    const AttemptIcon = executionEventIcon(item.state)
                    const attemptStatus: ChannelExecutionStatus =
                      item.state === 'active' ? 'running' : item.state
                    const reasonIsDuplicate =
                      item.state === 'failed' &&
                      index === lastFailedAttemptIndex &&
                      isDuplicateLogDiagnosticMessage(item.reason, details)
                    return (
                      <div
                        key={`attempt-${item.channelId}-${item.startedAt ?? index}`}
                        className='relative grid grid-cols-[24px_minmax(0,1fr)] gap-2.5 pb-3 last:pb-0'
                      >
                        {index < items.length - 1 && (
                          <span className='bg-border absolute top-6 bottom-0 left-[11px] w-px' />
                        )}
                        <span
                          className={cn(
                            'bg-background z-10 flex size-6 items-center justify-center rounded-full border',
                            textColorMap[
                              executionEventVariant(item.state) ?? 'neutral'
                            ]
                          )}
                        >
                          <AttemptIcon className='size-3' />
                        </span>
                        <div className='min-w-0'>
                          <div className='flex flex-wrap items-center gap-1.5'>
                            <StatusBadge
                              variant={channelExecutionStatusVariant(
                                attemptStatus
                              )}
                              size='sm'
                              copyable={false}
                            >
                              {t(channelExecutionStatusLabel(attemptStatus))}
                            </StatusBadge>
                            {item.selectionState === 'affinity_hit' ? (
                              <StatusBadge
                                variant='purple'
                                size='sm'
                                copyable={false}
                              >
                                {t('Affinity hit')}
                              </StatusBadge>
                            ) : null}
                            {item.selectionState === 'same_channel_retry' ? (
                              <StatusBadge
                                variant='warning'
                                size='sm'
                                copyable={false}
                              >
                                {t('Same-channel retry')}
                              </StatusBadge>
                            ) : null}
                            <span className='text-xs font-medium'>
                              #{item.channelId} {item.channelName}
                            </span>
                            {item.startedAt ? (
                              <span className='text-muted-foreground ml-auto font-mono text-[11px] tabular-nums'>
                                {new Date(item.startedAt).toLocaleTimeString()}
                              </span>
                            ) : null}
                          </div>
                          {item.reason && !reasonIsDuplicate ? (
                            <p className='text-muted-foreground mt-1 text-xs break-all'>
                              {item.reason}
                            </p>
                          ) : null}
                          <div className='text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
                            <span>
                              {t('Duration')}:{' '}
                              {formatExecutionDuration(
                                item.startedAt,
                                item.endedAt
                              )}
                            </span>
                            {item.retryIndex != null && item.retryIndex > 0 ? (
                              <span>
                                {t('Retry')}: {item.retryIndex}
                              </span>
                            ) : null}
                            {item.priority != null ? (
                              <span>
                                {t('Priority')}: {item.priority}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )
                  }

                  const event = item.event
                  const EventIcon = executionEventIcon(event.state)
                  const isGroupEvent = Boolean(event.group && !event.channel_id)
                  const eventDescription = executionEventDescription(
                    event.state,
                    isGroupEvent
                  )
                  return (
                    <div
                      key={`${event.sequence ?? index}-${event.timestamp ?? 0}`}
                      className='relative grid grid-cols-[24px_minmax(0,1fr)] gap-2.5 pb-3 last:pb-0'
                    >
                      {index < items.length - 1 && (
                        <span className='bg-border absolute top-6 bottom-0 left-[11px] w-px' />
                      )}
                      <span
                        className={cn(
                          'bg-background z-10 flex size-6 items-center justify-center rounded-full border',
                          textColorMap[
                            executionEventVariant(event.state) ?? 'neutral'
                          ]
                        )}
                      >
                        <EventIcon className='size-3' />
                      </span>
                      <div className='min-w-0'>
                        <div className='flex flex-wrap items-center gap-1.5'>
                          <StatusBadge
                            variant={executionEventVariant(event.state)}
                            size='sm'
                            copyable={false}
                          >
                            {t(executionEventLabel(event.state, isGroupEvent))}
                          </StatusBadge>
                          {event.group &&
                            (isGroupEvent ||
                              event.group !== executionTrace.group) && (
                              <span className='font-mono text-xs'>
                                {isGroupEvent
                                  ? `${t('Candidate group')}: `
                                  : ''}
                                {event.group}
                              </span>
                            )}
                          {event.channel_id ? (
                            <span className='inline-flex min-w-0 items-center gap-1.5'>
                              <span className='text-xs font-medium'>
                                #{event.channel_id} {event.channel_name}
                              </span>
                              {channelStatusEventIndexByID.get(
                                event.channel_id
                              ) === index ? (
                                <StatusBadge
                                  variant={channelExecutionStatusVariant(
                                    channelStatusByID.get(event.channel_id)
                                  )}
                                  size='sm'
                                  copyable={false}
                                >
                                  {t(
                                    channelExecutionStatusLabel(
                                      channelStatusByID.get(event.channel_id)
                                    )
                                  )}
                                </StatusBadge>
                              ) : null}
                            </span>
                          ) : null}
                          {event.timestamp ? (
                            <span className='text-muted-foreground ml-auto font-mono text-[11px] tabular-nums'>
                              {new Date(event.timestamp).toLocaleTimeString()}
                            </span>
                          ) : null}
                        </div>
                        {eventDescription ? (
                          <p className='text-muted-foreground mt-1 text-xs'>
                            {t(eventDescription)}
                          </p>
                        ) : null}
                        {event.reason && event.state !== 'affinity_hit' ? (
                          <p className='text-muted-foreground mt-1 text-xs break-all'>
                            {t(executionEventReasonLabel(event.reason))}
                          </p>
                        ) : null}
                        {event.priority != null ||
                        (event.retry_index != null && event.retry_index > 0) ||
                        event.cooldown_until ? (
                          <div className='text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
                            {event.priority != null ? (
                              <span>
                                {t('Priority')}: {event.priority}
                              </span>
                            ) : null}
                            {event.retry_index != null &&
                            event.retry_index > 0 ? (
                              <span>
                                {t('Retry')}: {event.retry_index}
                              </span>
                            ) : null}
                            {event.cooldown_until ? (
                              <span>
                                {t('Cooldown')}:{' '}
                                {formatTimestampToDate(event.cooldown_until)}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </DetailSection>
        ) : null}

        {/* Request conversion (admin only, not for refund) */}
        {showConversion && (
          <DetailSection label={t('Request Conversion')}>
            <div className='relative min-w-0'>
              <Button
                variant='ghost'
                size='sm'
                className='absolute top-0 right-0 h-5 w-5 p-0'
                onClick={() => copyToClipboard(conversionLabel)}
                title={t('Copy to clipboard')}
                aria-label={t('Copy to clipboard')}
              >
                {copiedText === conversionLabel ? (
                  <Check className='size-3 text-green-600' />
                ) : (
                  <Copy className='size-3' />
                )}
              </Button>
              <div className='min-w-0 space-y-1 pr-6'>
                {other?.request_path && (
                  <DetailRow
                    label={t('Path')}
                    value={other.request_path}
                    mono
                  />
                )}
                <div className='flex min-w-0 items-center gap-1.5 text-xs'>
                  <Route
                    className='text-muted-foreground size-3'
                    aria-hidden='true'
                  />
                  <span className='min-w-0 break-all sm:wrap-break-word'>
                    {conversionLabel}
                  </span>
                </div>
              </div>
            </div>
          </DetailSection>
        )}

        {/* Quota saturation marker (admin only) */}
        {props.isAdmin && other?.admin_info?.quota_saturation && (
          <DetailSection
            icon={<AlertTriangle className='size-3.5' aria-hidden='true' />}
            label={t('Quota clamped')}
            variant='danger'
          >
            <p className='mb-1 text-xs wrap-break-word'>
              {t('Quota saturation protection triggered')}
            </p>
            <DetailRow
              label={t('Kind')}
              value={quotaSaturationKindLabel(
                other.admin_info.quota_saturation.kind,
                t
              )}
            />
            <DetailRow
              label={t('Original value')}
              value={String(other.admin_info.quota_saturation.original)}
              mono
            />
            <DetailRow
              label={t('Clamped to')}
              value={String(other.admin_info.quota_saturation.clamped)}
              mono
            />
            <DetailRow
              label={t('Operation')}
              value={other.admin_info.quota_saturation.op}
              mono
            />
          </DetailSection>
        )}

        {/* Reject reason (admin only) */}
        {props.isAdmin && other?.reject_reason && (
          <DetailSection
            icon={<AlertTriangle className='size-3.5' aria-hidden='true' />}
            label={t('Reject Reason')}
            variant='danger'
          >
            <p className='text-xs wrap-break-word'>{other.reject_reason}</p>
          </DetailSection>
        )}

        {/* Violation fee info */}
        {isViolation && other && (
          <DetailSection
            icon={<AlertTriangle className='size-3.5' aria-hidden='true' />}
            label={t('Violation Fee')}
            variant='danger'
          >
            {other.violation_fee_code && (
              <DetailRow
                label={t('Violation Code')}
                value={other.violation_fee_code}
                mono
              />
            )}
            {other.violation_fee_marker && (
              <DetailRow
                label={t('Violation Marker')}
                value={other.violation_fee_marker}
              />
            )}
            <DetailRow
              label={t('Fee Amount')}
              value={formatLogQuota(other.fee_quota ?? props.log.quota)}
              mono
            />
          </DetailSection>
        )}

        {/* Refund details (type=6) */}
        {isRefund && other && (other.task_id || other.reason) && (
          <DetailSection label={t('Refund Details')}>
            {other.task_id && (
              <DetailRow label={t('Task ID')} value={other.task_id} mono />
            )}
            {other.reason && (
              <DetailRow label={t('Reason')} value={other.reason} />
            )}
          </DetailSection>
        )}

        {/* Top-up audit info (type=1, admin only) */}
        {showTopupAuditSection && (
          <DetailSection
            icon={<ShieldCheck className='size-3.5' aria-hidden='true' />}
            iconTone='success'
            label={t('Top-up Audit Info')}
          >
            {topupAuditFields.map((field) => (
              <DetailRow
                key={field.label}
                label={field.label}
                value={field.value}
                mono
              />
            ))}
            {showLegacyTopupWarning && (
              <div className='flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400'>
                <Info className='mt-0.5 size-3.5 shrink-0' aria-hidden='true' />
                <span>
                  {t(
                    'This historical record predates audit-info tracking and cannot be backfilled. The current instance already records server IP, callback IP, payment method, and system version for new top-ups going forward.'
                  )}
                </span>
              </div>
            )}
          </DetailSection>
        )}

        {/* Operation audit info (type=3) */}
        {showManageAuditSection && (
          <DetailSection
            icon={<ShieldCheck className='size-3.5' aria-hidden='true' />}
            iconTone='info'
            label={t('Operation Audit Info')}
          >
            {operationText != null && (
              <DetailRow label={t('Operation')} value={operationText} />
            )}
            {operationIdentifier && (
              <DetailRow
                label={t('Operation ID')}
                value={operationIdentifier}
                mono
              />
            )}
            {adminRoleLabel && (
              <DetailRow label={t('Admin Role')} value={adminRoleLabel} />
            )}
            {authMethodLabel !== '' && (
              <DetailRow
                label={t('Authentication Method')}
                value={authMethodLabel}
              />
            )}
            {auditParamEntries.map((entry) => (
              <DetailRow
                key={entry.key}
                label={entry.label}
                value={entry.value}
                mono={entry.key.endsWith('_id') || entry.key === 'id'}
              />
            ))}
            {auditRoute?.method && (auditRoute.route || auditRoute.path) && (
              <DetailRow
                label={t('Request')}
                value={`${auditRoute.method} ${auditRoute.route || auditRoute.path}`}
                mono
              />
            )}
            {auditRoute?.path && auditRoute.path !== auditRoute.route && (
              <DetailRow label={t('Path')} value={auditRoute.path} mono />
            )}
            {routeParamsText && (
              <DetailRow
                label={t('Route Parameters')}
                value={routeParamsText}
                mono
              />
            )}
            {auditResultText && (
              <DetailRow label={t('Result')} value={auditResultText} mono />
            )}
          </DetailSection>
        )}

        {/* Login audit info (type=7) */}
        {showLoginAuditSection && (
          <DetailSection
            icon={<LogIn className='size-3.5' aria-hidden='true' />}
            iconTone='info'
            label={t('Login Info')}
          >
            {operationText != null && (
              <DetailRow label={t('Operation')} value={operationText} />
            )}
            {operationIdentifier && (
              <DetailRow
                label={t('Operation ID')}
                value={operationIdentifier}
                mono
              />
            )}
            {loginAuditFields.map((field) => (
              <DetailRow
                key={field.label}
                label={field.label}
                value={field.value}
                mono={field.mono}
              />
            ))}
            {auditParamEntries
              .filter((entry) => entry.key !== 'method')
              .map((entry) => (
                <DetailRow
                  key={entry.key}
                  label={entry.label}
                  value={entry.value}
                  mono={entry.key.endsWith('_id')}
                />
              ))}
          </DetailSection>
        )}

        {/* Audio/WebSocket token breakdown */}
        {hasAudioTokens && other && (
          <DetailSection
            icon={<Headphones className='size-3.5' aria-hidden='true' />}
            iconTone='chart-4'
            label={t('Audio Tokens')}
          >
            {other.audio_input != null && other.audio_input > 0 && (
              <DetailRow
                label={t('Audio Input')}
                value={formatTokens(other.audio_input)}
                mono
              />
            )}
            {other.audio_output != null && other.audio_output > 0 && (
              <DetailRow
                label={t('Audio Output')}
                value={formatTokens(other.audio_output)}
                mono
              />
            )}
            {other.text_input != null && other.text_input > 0 && (
              <DetailRow
                label={t('Text Input')}
                value={formatTokens(other.text_input)}
                mono
              />
            )}
            {other.text_output != null && other.text_output > 0 && (
              <DetailRow
                label={t('Text Output')}
                value={formatTokens(other.text_output)}
                mono
              />
            )}
          </DetailSection>
        )}

        {/* Reasoning effort */}
        {other?.reasoning_effort && (
          <DetailRow
            label={t('Reasoning Effort')}
            value={
              <StatusBadge
                label={other.reasoning_effort}
                variant={reasoningEffortVariant}
                size='sm'
                copyable={false}
              />
            }
          />
        )}

        {/* System prompt override */}
        {other?.is_system_prompt_overwritten && (
          <DetailRow
            label={t('System Prompt')}
            value={
              <StatusBadge
                label={t('Overwritten')}
                variant='orange'
                size='sm'
                copyable={false}
              />
            }
          />
        )}

        {/* Model mapping */}
        {other?.is_model_mapped && other?.upstream_model_name && (
          <DetailSection label={t('Model Mapping')}>
            <DetailRow
              label={t('Request Model')}
              value={props.log.model_name}
              mono
            />
            <DetailRow
              label={t('Actual Model')}
              value={other.upstream_model_name}
              mono
            />
          </DetailSection>
        )}

        {/* Token breakdown (for consume/error types with token data) */}
        {isDisplayableType(props.log.type) && other && (
          <TokenBreakdown log={props.log} other={other} />
        )}

        {/* Billing breakdown (consume type) */}
        {isConsume && other && !isViolation && (
          <BillingBreakdown
            log={props.log}
            other={other}
            isAdmin={props.isAdmin}
          />
        )}

        {/* Tiered pricing breakdown (when billing_mode is tiered_expr) */}
        {isTieredBilling && other?.expr_b64 && (
          <DetailSection label={t('Dynamic Pricing')}>
            <DynamicPricingBreakdown
              compact
              billingExpr={decodeBillingExprB64(other.expr_b64)}
              matchedTierLabel={other.matched_tier}
              hideCacheColumns={!hasAnyCacheTokens(other)}
            />
          </DetailSection>
        )}

        {/* Admin billing mode indicator for non-consume */}
        {props.isAdmin &&
          !isConsume &&
          props.log.type !== 6 &&
          other?.admin_info &&
          hasUsageBillingPath && (
            <DetailRow
              label={t('Billing Path')}
              value={
                <span className='flex items-center gap-1'>
                  {isUsageBillingPathLocal(other.admin_info) ? (
                    <Monitor className='size-3 text-blue-500' />
                  ) : (
                    <Cloud className='size-3 text-emerald-500' />
                  )}
                  <span className='text-xs'>
                    {getUsageBillingPathLabel(t, other.admin_info)}
                  </span>
                </span>
              }
            />
          )}

        {/* Stream status details (admin only) */}
        {props.isAdmin &&
          other?.stream_status &&
          other.stream_status.status !== 'ok' && (
            <DetailSection label={t('Stream Status')}>
              <DetailRow
                label={t('Status')}
                value={
                  <StatusBadge
                    label={other.stream_status.status || t('Error')}
                    variant='red'
                    size='sm'
                    copyable={false}
                  />
                }
              />
              {other.stream_status.end_reason && (
                <DetailRow
                  label={t('End Reason')}
                  value={other.stream_status.end_reason}
                />
              )}
              {(other.stream_status.error_count ?? 0) > 0 && (
                <DetailRow
                  label={t('Soft Errors')}
                  value={String(other.stream_status.error_count)}
                />
              )}
              {other.stream_status.end_error && !streamEndErrorIsDuplicate && (
                <DetailRow
                  label={t('End Error')}
                  value={other.stream_status.end_error}
                />
              )}
              {uniqueStreamErrors.length > 0 && (
                <pre className='bg-background/60 mt-1 max-h-32 overflow-y-auto rounded border p-2 font-mono text-[11px] leading-relaxed wrap-break-word whitespace-pre-wrap'>
                  {uniqueStreamErrors.join('\n')}
                </pre>
              )}
            </DetailSection>
          )}

        {/* Subscription billing details */}
        {isSubscription && other && (
          <DetailSection label={t('Subscription Billing')}>
            {other.subscription_plan_id && (
              <DetailRow
                label={t('Plan')}
                value={`#${other.subscription_plan_id} ${other.subscription_plan_title || ''}`.trim()}
              />
            )}
            {other.subscription_id && (
              <DetailRow
                label={t('Instance')}
                value={`#${other.subscription_id}`}
                mono
              />
            )}
            {other.subscription_pre_consumed != null && (
              <DetailRow
                label={t('Pre-consumed')}
                value={formatLogQuota(other.subscription_pre_consumed)}
                mono
              />
            )}
            {other.subscription_post_delta != null &&
              other.subscription_post_delta !== 0 && (
                <DetailRow
                  label={t('Post Delta')}
                  value={formatLogQuota(other.subscription_post_delta)}
                  mono
                />
              )}
            {other.subscription_consumed != null && (
              <DetailRow
                label={t('Final Consumed')}
                value={formatLogQuota(other.subscription_consumed)}
                mono
              />
            )}
            {other.subscription_remain != null && (
              <DetailRow
                label={t('Remaining')}
                value={`${formatLogQuota(other.subscription_remain)}${other.subscription_total != null ? ` / ${formatLogQuota(other.subscription_total)}` : ''}`}
                mono
              />
            )}
          </DetailSection>
        )}

        {/* Param override */}
        {other?.po && Array.isArray(other.po) && other.po.length > 0 && (
          <DetailSection
            icon={<Settings2 className='size-3.5' aria-hidden='true' />}
            iconTone='chart-3'
            label={`${t('Param Override')} (${other.po.length})`}
          >
            {other.po.filter(Boolean).map((line) => {
              const parsed = parseAuditLine(line)
              if (!parsed) return null
              return (
                <div
                  key={`${parsed.action}-${parsed.content}`}
                  className='bg-background/60 flex min-w-0 flex-col gap-1.5 rounded border p-2 sm:flex-row sm:items-start sm:gap-2'
                >
                  <StatusBadge
                    variant='neutral'
                    label={getParamOverrideActionLabel(parsed.action, t)}
                    className='shrink-0 font-medium'
                    copyable={false}
                  />
                  <span className='min-w-0 font-mono text-[11px] leading-relaxed break-all sm:wrap-break-word'>
                    {parsed.content}
                  </span>
                </div>
              )
            })}
          </DetailSection>
        )}

        {/* Content */}
        {contentText && (
          <div className='space-y-1.5'>
            <Label className='text-xs font-semibold'>{t('Content')}</Label>
            <div className='bg-muted/30 relative min-w-0 overflow-hidden rounded-md border p-2.5'>
              <Button
                variant='ghost'
                size='sm'
                className='absolute top-1.5 right-1.5 h-5 w-5 p-0'
                onClick={() => copyToClipboard(contentText)}
                title={t('Copy to clipboard')}
                aria-label={t('Copy to clipboard')}
              >
                {copiedText === contentText ? (
                  <Check className='size-3 text-green-600' />
                ) : (
                  <Copy className='size-3' />
                )}
              </Button>
              <p className='min-w-0 pr-6 text-xs leading-relaxed break-all whitespace-pre-wrap sm:wrap-break-word'>
                {contentText}
              </p>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

function isDisplayableType(type: number): boolean {
  return [0, 2, 5, 6].includes(type)
}
