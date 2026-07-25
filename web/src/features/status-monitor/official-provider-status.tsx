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
  isOfficialComponentAffected,
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
  const affected = isOfficialComponentAffected(props.component)
  const variant = getComponentVariant(props.component.status)
  const content = (
    <div
      className={cn(
        'flex min-w-0 items-center justify-between gap-3 px-3.5 py-2.5 sm:px-4',
        affected && 'bg-warning/5'
      )}
    >
      <div className='flex min-w-0 items-center gap-2.5'>
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            getComponentDotClass(props.component.status)
          )}
        />
        <span className='truncate text-sm font-medium'>
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
      render={<a href={props.href} target='_blank' rel='noreferrer' />}
    >
      <Icon />
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
  const [componentsOpen, setComponentsOpen] = useState(
    affectedComponents.length > 0
  )
  const meta = provider.available
    ? (INDICATOR_META[effectiveIndicator] ?? UNKNOWN_META)
    : UNAVAILABLE_META
  const StatusIcon = meta.icon
  const componentGroups = provider.components.filter(
    (component) => component.group
  )
  const componentGroupIds = new Set(
    componentGroups.map((component) => component.id).filter(Boolean)
  )
  const serviceComponents = provider.components.filter(
    (component) => !component.group
  )
  const standaloneComponents = provider.components.filter(
    (component) =>
      !component.group &&
      (!component.group_id || !componentGroupIds.has(component.group_id))
  )
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
    <article className='bg-card min-w-0 overflow-hidden rounded-lg border'>
      <header className='flex min-w-0 items-start justify-between gap-3 p-3.5 sm:p-4'>
        <div className='flex min-w-0 items-center gap-3'>
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-md',
              meta.iconSurfaceClassName
            )}
          >
            <StatusIcon className={cn('size-4.5', meta.iconClassName)} />
          </span>
          <div className='min-w-0'>
            <h3 className='truncate text-sm font-semibold sm:text-base'>
              {provider.provider}
            </h3>
            <div className='mt-1 flex min-w-0 items-center gap-2'>
              <StatusBadge
                variant={meta.variant}
                copyable={false}
                type='text'
                showDot
              >
                {t(meta.label)}
              </StatusBadge>
              {activeIncidents.length > 0 ? (
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {activeIncidents.length} {t('Active incidents')}
                </span>
              ) : null}
            </div>
            <p className='text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs tabular-nums'>
              <Clock3 className='size-3.5 shrink-0' />
              <span className='truncate'>
                {t('Official check time')}:{' '}
                {formatOfficialTime(provider.checked_at, locale)}
              </span>
            </p>
            {provider.available &&
            effectiveIndicator !== 'none' &&
            provider.description ? (
              <p className='text-muted-foreground mt-1.5 text-xs leading-4 [overflow-wrap:anywhere]'>
                {provider.description}
              </p>
            ) : null}
          </div>
        </div>

        <div className='flex shrink-0 items-center gap-0.5'>
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
      </header>

      {!provider.available ? (
        <div className='border-destructive/25 bg-destructive/5 border-t px-3.5 py-3 sm:px-4'>
          <div className='text-destructive flex items-start gap-2 text-sm'>
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
        <div className='divide-y border-t'>
          {activeIncidents.map((incident) => {
            const incidentComponents = incident.components

            return (
              <div
                key={`${incident.name}-${incident.updated_at}`}
                className='bg-muted/10 px-3.5 py-3.5 sm:px-4'
              >
                <div className='flex min-w-0 items-start justify-between gap-3'>
                  <div className='min-w-0 text-sm leading-5 font-medium [overflow-wrap:anywhere] break-words'>
                    {incident.name}
                  </div>
                  <StatusBadge
                    variant={getIncidentVariant(
                      incident.status,
                      incident.impact
                    )}
                    copyable={false}
                    type='text'
                    showDot
                    className='shrink-0 text-xs'
                  >
                    {formatIncidentStatus(
                      incident.status || incident.impact,
                      t
                    )}
                  </StatusBadge>
                </div>
                {incident.message ? (
                  <p className='text-muted-foreground mt-1.5 text-sm leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-line'>
                    {incident.message}
                  </p>
                ) : null}
                {incidentComponents.length > 0 ? (
                  <div className='mt-2.5 flex min-w-0 flex-wrap items-center gap-1.5'>
                    <span className='text-muted-foreground mr-0.5 text-xs'>
                      {t('Affected components')}:
                    </span>
                    {incidentComponents.map((component) => (
                      <StatusBadge
                        key={component.id || component.name}
                        variant={getComponentVariant(component.status)}
                        copyable={false}
                        type='text'
                        className='max-w-full text-xs'
                      >
                        <span className='truncate'>{component.name}</span>
                      </StatusBadge>
                    ))}
                  </div>
                ) : null}
                <div className='mt-2.5 flex flex-wrap items-center justify-between gap-2'>
                  <span className='text-muted-foreground flex items-center gap-1.5 text-xs tabular-nums'>
                    <Clock3 className='size-3.5' />
                    {formatOfficialTime(incident.updated_at, locale)}
                  </span>
                  {incident.url ? (
                    <Button
                      variant='link'
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
              </div>
            )
          })}
        </div>
      ) : (
        <div className='text-muted-foreground flex items-center gap-2 border-t px-3.5 py-4 text-sm sm:px-4'>
          {provider.available ? (
            <CheckCircle2 className='text-status-success size-4' />
          ) : (
            <CircleDashed className='size-4' />
          )}
          <span>
            {provider.available
              ? t('No active incidents')
              : t('Official status unavailable')}
          </span>
        </div>
      )}

      {provider.available && provider.components.length > 0 ? (
        <Collapsible
          open={componentsOpen}
          onOpenChange={setComponentsOpen}
          className='border-t'
        >
          <CollapsibleTrigger
            data-press-animation='none'
            className='hover:bg-muted/30 focus-visible:ring-ring flex w-full min-w-0 items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset sm:px-4'
          >
            <div className='min-w-0'>
              <h4 className='text-sm font-semibold'>
                {t('Service components')}
              </h4>
              <p className='text-muted-foreground mt-0.5 text-xs'>
                {affectedComponents.length > 0
                  ? t('{{count}} affected components', {
                      count: affectedComponents.length,
                    })
                  : t('All components operational')}
              </p>
            </div>
            <div className='flex shrink-0 items-center gap-2'>
              <span className='text-muted-foreground text-xs tabular-nums'>
                {serviceComponents.length} {t('components')}
              </span>
              <ChevronDown
                className={cn(
                  'text-muted-foreground size-4 transition-transform duration-200',
                  componentsOpen && 'rotate-180'
                )}
              />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className='border-t'>
            <div className='divide-y'>
              {componentGroups.map((group) => {
                const children = provider.components.filter(
                  (component) =>
                    !component.group && component.group_id === group.id
                )
                return (
                  <div key={group.id || group.name}>
                    <ProviderComponentRow component={group} locale={locale} />
                    {children.length > 0 ? (
                      <div className='bg-muted/10 divide-y border-t pl-5'>
                        {children.map((component) => (
                          <ProviderComponentRow
                            key={component.id || component.name}
                            component={component}
                            locale={locale}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {standaloneComponents.map((component) => (
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
    </article>
  )
}

export function OfficialProviderStatuses(props: {
  response: OfficialProviderStatusResponse | null
  loading: boolean
  failed: boolean
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
    <div className='grid min-w-0 items-start gap-3 lg:grid-cols-2'>
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
      <div className='grid items-start gap-3 lg:grid-cols-2'>
        <Skeleton className='h-64 w-full' />
        <Skeleton className='h-64 w-full' />
      </div>
    )
  } else if (props.failed || providers.length === 0) {
    content = (
      <div className='text-muted-foreground border-y border-dashed py-10 text-center text-sm'>
        {t('Official status unavailable')}
      </div>
    )
  }

  return (
    <TooltipProvider delay={0}>
      <section className='min-w-0 space-y-4'>
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
                <Clock3 className='size-3.5' />
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

        {content}
      </section>
    </TooltipProvider>
  )
}
