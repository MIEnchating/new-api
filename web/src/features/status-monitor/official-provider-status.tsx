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
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock3,
  ExternalLink,
  Radio,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

import {
  formatIncidentStatus,
  formatComponentStatus,
  formatOfficialTime,
  getActiveOfficialIncidents,
  getAffectedOfficialComponents,
  getEffectiveOfficialIndicator,
  isOfficialProviderAffected,
} from './official-provider-status-utils'
import type {
  OfficialProviderComponent,
  OfficialProviderStatus,
  OfficialProviderStatusResponse,
} from './types'

const INDICATOR_META: Record<
  string,
  {
    label: string
    variant: StatusVariant
    icon: LucideIcon
    iconClassName: string
    iconSurfaceClassName: string
  }
> = {
  none: {
    label: 'Operational',
    variant: 'success',
    icon: CheckCircle2,
    iconClassName: 'text-status-success',
    iconSurfaceClassName: 'bg-success/10',
  },
  minor: {
    label: 'Minor outage',
    variant: 'warning',
    icon: AlertTriangle,
    iconClassName: 'text-status-warning',
    iconSurfaceClassName: 'bg-warning/10',
  },
  major: {
    label: 'Major outage',
    variant: 'danger',
    icon: AlertTriangle,
    iconClassName: 'text-destructive',
    iconSurfaceClassName: 'bg-destructive/10',
  },
  critical: {
    label: 'Critical outage',
    variant: 'danger',
    icon: AlertTriangle,
    iconClassName: 'text-destructive',
    iconSurfaceClassName: 'bg-destructive/10',
  },
  maintenance: {
    label: 'Maintenance',
    variant: 'info',
    icon: Wrench,
    iconClassName: 'text-info',
    iconSurfaceClassName: 'bg-info/10',
  },
}

const UNAVAILABLE_META = {
  label: 'Official status unavailable',
  variant: 'neutral' as const,
  icon: CircleDashed,
  iconClassName: 'text-muted-foreground',
  iconSurfaceClassName: 'bg-muted',
}

const UNKNOWN_META = {
  label: 'Unknown status',
  variant: 'neutral' as const,
  icon: CircleDashed,
  iconClassName: 'text-muted-foreground',
  iconSurfaceClassName: 'bg-muted',
}

function getIncidentVariant(status: string, impact: string): StatusVariant {
  const normalizedStatus = status.toLowerCase()
  const normalizedImpact = impact.toLowerCase()

  if (normalizedStatus === 'resolved' || normalizedStatus === 'completed') {
    return 'success'
  }
  if (normalizedStatus === 'monitoring') return 'info'
  if (normalizedStatus === 'scheduled' || normalizedStatus === 'in_progress') {
    return 'info'
  }
  if (normalizedImpact === 'major' || normalizedImpact === 'critical') {
    return 'danger'
  }
  return 'warning'
}

function getComponentVariant(status: string): StatusVariant {
  switch (
    status
      .trim()
      .toLowerCase()
      .replaceAll(/[-\s]+/g, '_')
  ) {
    case 'operational':
      return 'success'
    case 'under_maintenance':
      return 'info'
    case 'major_outage':
      return 'danger'
    default:
      return 'warning'
  }
}

function getComponentDotClass(status: string) {
  switch (getComponentVariant(status)) {
    case 'success':
      return 'bg-status-success'
    case 'info':
      return 'bg-info'
    case 'danger':
      return 'bg-destructive'
    default:
      return 'bg-status-warning'
  }
}

function ProviderComponentRow(props: {
  component: OfficialProviderComponent
  locale?: string
}) {
  const { t } = useTranslation()
  const variant = getComponentVariant(props.component.status)
  const content = (
    <div className='bg-muted/20 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-2.5'>
      <div className='flex min-w-0 flex-1 items-start gap-2.5'>
        <span
          className={cn(
            'mt-1.5 size-1.5 shrink-0 rounded-full',
            getComponentDotClass(props.component.status)
          )}
        />
        <span className='text-sm leading-5 [overflow-wrap:anywhere]'>
          {props.component.name}
        </span>
      </div>
      <StatusBadge
        variant={variant}
        copyable={false}
        type='text'
        className='shrink-0 text-xs'
      >
        {formatComponentStatus(props.component.status, t)}
      </StatusBadge>
    </div>
  )

  if (!props.component.updated_at) return content

  return (
    <Tooltip>
      <TooltipTrigger render={content} />
      <TooltipContent>
        {t('Official update time')}:{' '}
        {formatOfficialTime(props.component.updated_at, props.locale)}
      </TooltipContent>
    </Tooltip>
  )
}

function ProviderAction(props: {
  href: string
  label: string
  icon: LucideIcon
}) {
  if (!props.href) return null

  const Icon = props.icon
  const button = (
    <Button
      variant='ghost'
      size='icon-sm'
      aria-label={props.label}
      role='link'
      className='text-muted-foreground hover:text-foreground rounded-lg'
      render={<a href={props.href} target='_blank' rel='noreferrer' />}
    >
      <Icon aria-hidden='true' />
    </Button>
  )

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

function OfficialSummaryMetric(props: {
  label: string
  value: string
  icon: LucideIcon
  tone?: 'default' | 'success' | 'warning' | 'danger'
  className?: string
}) {
  const Icon = props.icon
  return (
    <div
      className={cn(
        'bg-muted/35 flex min-w-0 items-center gap-3 rounded-md px-3 py-3 sm:px-4',
        props.className
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          props.tone === 'success' && 'bg-success/10 text-status-success',
          props.tone === 'warning' && 'bg-warning/10 text-status-warning',
          props.tone === 'danger' && 'bg-destructive/10 text-destructive',
          (!props.tone || props.tone === 'default') &&
            'bg-muted text-muted-foreground'
        )}
      >
        <Icon className='size-4' />
      </span>
      <div className='min-w-0'>
        <div className='truncate text-lg font-semibold tabular-nums'>
          {props.value}
        </div>
        <div className='text-muted-foreground truncate text-xs'>
          {props.label}
        </div>
      </div>
    </div>
  )
}

function ProviderCard({ provider }: { provider: OfficialProviderStatus }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const activeIncidents = getActiveOfficialIncidents(provider)
  const affectedComponents = getAffectedOfficialComponents(provider).filter(
    (component) => !component.group
  )
  const effectiveIndicator = getEffectiveOfficialIndicator(provider)
  const affectedComponentKeys = new Set(
    affectedComponents.map((component) => component.id || component.name)
  )
  const serviceComponents = [
    ...affectedComponents,
    ...provider.components.filter(
      (component) =>
        !component.group &&
        !affectedComponentKeys.has(component.id || component.name)
    ),
  ]
  const [componentsOpen, setComponentsOpen] = useState(true)
  const meta = provider.available
    ? (INDICATOR_META[effectiveIndicator] ?? UNKNOWN_META)
    : UNAVAILABLE_META
  const StatusIcon = meta.icon
  let errorLabel = t('Official status fetch failed')
  switch (provider.error_code) {
    case 'timeout':
      errorLabel = t('Official status request timed out')
      break
    case 'http_status':
      errorLabel = t('Official status service returned an HTTP error')
      break
    case 'invalid_json':
      errorLabel = t('Official status response was invalid')
      break
    case 'network_error':
      errorLabel = t('Unable to reach official status service')
      break
  }
  const errorHttpStatus =
    provider.error_code === 'http_status'
      ? provider.error_message?.match(/HTTP\s+\d{3}/i)?.[0]
      : null

  return (
    <article className='bg-card hover:border-foreground/20 min-w-0 overflow-hidden rounded-xl border shadow-xs transition-[box-shadow,border-color] duration-200 hover:shadow-md'>
      <header className='space-y-2.5 p-4'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-3'>
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg',
                meta.iconSurfaceClassName
              )}
            >
              <StatusIcon
                aria-hidden='true'
                className={cn('size-5', meta.iconClassName)}
              />
            </span>
            <h3 className='min-w-0 text-base leading-6 font-semibold [overflow-wrap:anywhere]'>
              {provider.provider}
            </h3>
          </div>
          <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
            <StatusBadge
              variant={meta.variant}
              copyable={false}
              type='text'
              showDot
              className='gap-2 text-xs leading-5 whitespace-normal'
            >
              {t(meta.label)}
            </StatusBadge>
            {activeIncidents.length > 0 ? (
              <span className='text-muted-foreground text-xs tabular-nums'>
                {t('Active incidents')}
                <span className='bg-muted text-foreground ml-2 inline-flex min-w-5 items-center justify-center rounded-md px-1.5 py-0.5 font-medium'>
                  {activeIncidents.length}
                </span>
              </span>
            ) : null}
          </div>
        </div>
        {provider.available &&
        effectiveIndicator !== 'none' &&
        provider.description ? (
          <p className='text-muted-foreground text-xs leading-5 [overflow-wrap:anywhere]'>
            {provider.description}
          </p>
        ) : null}
      </header>

      {!provider.available ? (
        <div className='bg-muted/30 mx-4 mb-3 rounded-lg border p-3'>
          <div className='text-muted-foreground flex items-start gap-2.5 text-sm leading-5'>
            <AlertTriangle className='mt-0.5 size-4 shrink-0' />
            <div className='min-w-0'>
              <p className='font-medium'>{errorLabel}</p>
              {errorHttpStatus ? (
                <p className='mt-0.5 text-xs [overflow-wrap:anywhere] opacity-80'>
                  {errorHttpStatus.toUpperCase()}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeIncidents.length > 0 ? (
        <div className='space-y-2 px-4 pb-3'>
          {activeIncidents.map((incident) => {
            const incidentComponents = incident.components
            const hasDetails =
              Boolean(incident.message) || incidentComponents.length > 0

            return (
              <Collapsible
                key={`${incident.name}-${incident.updated_at}`}
                className='bg-muted/20 min-w-0 space-y-2.5 rounded-lg border p-3'
              >
                <div className='space-y-2.5'>
                  <h4 className='text-sm leading-6 font-semibold [overflow-wrap:anywhere]'>
                    {hasDetails ? (
                      <CollapsibleTrigger className='group focus-visible:ring-ring hover:text-primary flex w-full min-w-0 items-start justify-between gap-3 rounded-sm text-left outline-none focus-visible:ring-2'>
                        <span className='min-w-0 [overflow-wrap:anywhere]'>
                          {incident.name}
                        </span>
                        <ChevronDown
                          aria-hidden='true'
                          className='text-muted-foreground mt-1 size-4 shrink-0 transition-transform group-aria-expanded:rotate-180'
                        />
                      </CollapsibleTrigger>
                    ) : (
                      incident.name
                    )}
                  </h4>
                  <StatusBadge
                    variant={getIncidentVariant(
                      incident.status,
                      incident.impact
                    )}
                    copyable={false}
                    type='text'
                    showDot
                    className='text-xs leading-5 whitespace-normal'
                  >
                    {formatIncidentStatus(
                      incident.status || incident.impact,
                      t
                    )}
                  </StatusBadge>
                </div>
                <CollapsibleContent className='space-y-3'>
                  {incident.message ? (
                    <p className='text-muted-foreground text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-line'>
                      {incident.message}
                    </p>
                  ) : null}
                  {incidentComponents.length > 0 ? (
                    <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
                      <span className='text-muted-foreground mr-0.5 text-xs'>
                        {t('Affected components')}:
                      </span>
                      {incidentComponents.map((component) => (
                        <StatusBadge
                          key={component.id || component.name}
                          variant={getComponentVariant(component.status)}
                          copyable={false}
                          type='text'
                          className='bg-background max-w-full rounded-md border px-2 py-1 text-xs leading-4 whitespace-normal'
                        >
                          <span className='min-w-0 [overflow-wrap:anywhere]'>
                            {component.name}
                          </span>
                        </StatusBadge>
                      ))}
                    </div>
                  ) : null}
                </CollapsibleContent>
                <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3'>
                  <span className='text-muted-foreground flex items-center gap-1.5 text-xs tabular-nums'>
                    <Clock3 aria-hidden='true' className='size-3.5 shrink-0' />
                    {formatOfficialTime(incident.updated_at, locale)}
                  </span>
                  {incident.url ? (
                    <Button
                      variant='link'
                      role='link'
                      size='xs'
                      render={
                        <a
                          href={incident.url}
                          target='_blank'
                          rel='noreferrer'
                        />
                      }
                    >
                      {t('View incident')}
                      <ExternalLink data-icon='inline-end' />
                    </Button>
                  ) : null}
                </div>
              </Collapsible>
            )
          })}
        </div>
      ) : null}

      {activeIncidents.length === 0 &&
      serviceComponents.length === 0 &&
      provider.available ? (
        <div className='text-muted-foreground bg-muted/20 mx-4 mb-3 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm'>
          <CheckCircle2
            aria-hidden='true'
            className='text-status-success size-4 shrink-0'
          />
          <span>{t('No active incidents')}</span>
        </div>
      ) : null}

      {provider.available && serviceComponents.length > 0 ? (
        <Collapsible
          open={componentsOpen}
          onOpenChange={setComponentsOpen}
          className='@container mx-4 border-t'
        >
          <CollapsibleTrigger
            data-press-animation='none'
            className='hover:text-foreground text-muted-foreground focus-visible:ring-ring flex w-full min-w-0 items-center justify-between gap-3 rounded-md py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset'
          >
            <span className='text-sm font-medium'>
              {t('Service components')}
            </span>
            <div className='flex shrink-0 items-center gap-2'>
              <span className='bg-muted text-muted-foreground min-w-5 rounded-md px-1.5 py-0.5 text-center text-xs tabular-nums'>
                {serviceComponents.length}
              </span>
              <ChevronDown
                className={cn(
                  'text-muted-foreground size-4 transition-transform duration-200',
                  componentsOpen && 'rotate-180'
                )}
              />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className='pb-4'>
            <div className='grid min-w-0 gap-2 @min-[28rem]:grid-cols-2'>
              {serviceComponents.map((component) => (
                <ProviderComponentRow
                  key={component.id || component.name}
                  component={component}
                  locale={locale}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <footer className='bg-muted/10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t px-4 py-2'>
        <div className='text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
          <p>{t('Official check time')}</p>
          <p className='flex items-center gap-1.5 leading-5 tabular-nums'>
            <Clock3 aria-hidden='true' className='size-3.5 shrink-0' />
            <span className='[overflow-wrap:anywhere]'>
              {formatOfficialTime(provider.checked_at, locale)}
            </span>
          </p>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          <ProviderAction
            href={provider.status_url}
            label={t('Open official status page')}
            icon={ExternalLink}
          />
          <ProviderAction
            href={provider.subscribe_url}
            label={t('Subscribe to official updates')}
            icon={BellRing}
          />
        </div>
      </footer>
    </article>
  )
}

export function OfficialProviderStatuses(props: {
  response: OfficialProviderStatusResponse | null
  loading: boolean
  failed: boolean
  compact?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const providers = props.response?.data.providers ?? []
  const affectedProviders = providers.filter(isOfficialProviderAffected).length
  const operationalProviders = providers.filter(
    (provider) =>
      provider.available && getEffectiveOfficialIndicator(provider) === 'none'
  ).length
  const unavailableProviders = providers.filter(
    (provider) => !provider.available
  ).length
  const activeIncidents = providers.reduce(
    (count, provider) => count + getActiveOfficialIncidents(provider).length,
    0
  )
  const latestCheckedAt = providers
    .map((provider) => provider.checked_at)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]
  let content = (
    <div
      className={cn(
        'grid min-w-0 items-start gap-4',
        providers.length > 1 && 'md:grid-cols-2',
        props.compact && providers.length > 2 && 'xl:grid-cols-3'
      )}
    >
      {providers.map((provider) => (
        <ProviderCard
          key={`${provider.provider}-${provider.available}-${getEffectiveOfficialIndicator(provider)}`}
          provider={provider}
        />
      ))}
    </div>
  )

  if (props.loading) {
    content = (
      <div
        className={cn(
          'grid min-w-0 items-start gap-4 overflow-clip md:grid-cols-2',
          props.compact && 'xl:grid-cols-3'
        )}
      >
        {Array.from({ length: props.compact ? 3 : 2 }, (_, index) => (
          <div
            key={index}
            aria-hidden='true'
            className='bg-card min-w-0 overflow-hidden rounded-xl border'
          >
            <div className='space-y-3 p-4'>
              <div className='flex items-center gap-3'>
                <Skeleton className='size-9 shrink-0 rounded-lg' />
                <Skeleton className='h-5 w-28' />
              </div>
              <div className='grid grid-cols-2 gap-2'>
                {Array.from({ length: 6 }, (_, componentIndex) => (
                  <Skeleton key={componentIndex} className='h-10 rounded-lg' />
                ))}
              </div>
            </div>
            <div className='flex items-center justify-between border-t px-4 py-3'>
              <div className='space-y-2'>
                <Skeleton className='h-3 w-20' />
                <Skeleton className='h-3 w-36' />
              </div>
              <Skeleton className='size-8 rounded-lg' />
            </div>
          </div>
        ))}
      </div>
    )
  } else if (props.failed || providers.length === 0) {
    content = (
      <EmptyState
        icon={CircleDashed}
        title={t('Official status unavailable')}
      />
    )
  }

  return (
    <TooltipProvider delay={0}>
      <section className='min-w-0 space-y-4'>
        {!props.compact && (
          <div className='space-y-3'>
            <div className='flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div className='flex min-w-0 items-center gap-3'>
                <span className='bg-info/10 text-info flex size-9 shrink-0 items-center justify-center rounded-md'>
                  <Radio className='size-4' />
                </span>
                <div className='min-w-0'>
                  <h2 className='text-sm font-semibold'>
                    {t('Official provider status')}
                  </h2>
                  <p className='text-muted-foreground mt-0.5 text-xs'>
                    {t('Live incident messages from official status pages')}
                  </p>
                </div>
              </div>
              {latestCheckedAt ? (
                <span className='text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs tabular-nums'>
                  <Clock3 aria-hidden='true' className='size-3.5 shrink-0' />
                  {formatOfficialTime(latestCheckedAt, locale)}
                </span>
              ) : null}
            </div>

            {!props.loading && providers.length > 0 ? (
              <div className='grid grid-cols-2 gap-2 lg:grid-cols-4'>
                <OfficialSummaryMetric
                  label={t('Operational')}
                  value={`${operationalProviders} / ${providers.length}`}
                  icon={CheckCircle2}
                  tone='success'
                />
                <OfficialSummaryMetric
                  label={t('Affected providers')}
                  value={String(affectedProviders)}
                  icon={AlertTriangle}
                  tone={affectedProviders > 0 ? 'warning' : 'default'}
                />
                <OfficialSummaryMetric
                  label={t('Active incidents')}
                  value={String(activeIncidents)}
                  icon={BellRing}
                  tone={activeIncidents > 0 ? 'warning' : 'default'}
                />
                <OfficialSummaryMetric
                  label={t('Official status unavailable')}
                  value={String(unavailableProviders)}
                  icon={CircleDashed}
                  tone={unavailableProviders > 0 ? 'danger' : 'default'}
                />
              </div>
            ) : null}
          </div>
        )}

        {content}
      </section>
    </TooltipProvider>
  )
}
