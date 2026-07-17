import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  CircleDashed,
  Clock3,
  ExternalLink,
  Radio,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
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
  formatOfficialTime,
  getActiveOfficialIncidents,
  getEffectiveOfficialIndicator,
  isOfficialProviderAffected,
} from './official-provider-status-utils'
import type {
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

function ProviderCard({ provider }: { provider: OfficialProviderStatus }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const activeIncidents = getActiveOfficialIncidents(provider)
  const effectiveIndicator = getEffectiveOfficialIndicator(provider)
  const meta = provider.available
    ? (INDICATOR_META[effectiveIndicator] ?? UNAVAILABLE_META)
    : UNAVAILABLE_META
  const StatusIcon = meta.icon

  return (
    <article className='bg-card min-w-0 self-start overflow-hidden rounded-lg border'>
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

      {activeIncidents.length > 0 ? (
        <div className='divide-y border-t'>
          {activeIncidents.map((incident) => (
            <div
              key={`${incident.name}-${incident.updated_at}`}
              className='bg-muted/10 px-3.5 py-3.5 sm:px-4'
            >
              <div className='flex min-w-0 items-start justify-between gap-3'>
                <div className='min-w-0 text-sm leading-5 font-medium [overflow-wrap:anywhere] break-words'>
                  {incident.name}
                </div>
                <StatusBadge
                  variant={getIncidentVariant(incident.status, incident.impact)}
                  copyable={false}
                  type='text'
                  showDot
                  className='shrink-0 text-xs'
                >
                  {formatIncidentStatus(incident.status || incident.impact, t)}
                </StatusBadge>
              </div>
              {incident.message ? (
                <p className='text-muted-foreground mt-1.5 text-sm leading-5 [overflow-wrap:anywhere] break-words whitespace-pre-line'>
                  {incident.message}
                </p>
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
                      <a href={incident.url} target='_blank' rel='noreferrer' />
                    }
                  >
                    {t('View incident')}
                    <ExternalLink data-icon='inline-end' />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
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
    </article>
  )
}

export function OfficialProviderStatuses(props: {
  response: OfficialProviderStatusResponse | null
  loading: boolean
  failed: boolean
}) {
  const { t } = useTranslation()
  const providers = props.response?.data.providers ?? []
  const affectedProviders = providers.filter(isOfficialProviderAffected).length
  const activeIncidents = providers.reduce(
    (count, provider) => count + getActiveOfficialIncidents(provider).length,
    0
  )
  let content = (
    <div className='grid min-w-0 items-start gap-3 lg:grid-cols-2'>
      {providers.map((provider) => (
        <ProviderCard key={provider.provider} provider={provider} />
      ))}
    </div>
  )

  if (props.loading) {
    content = (
      <div className='grid items-start gap-3 lg:grid-cols-2'>
        <Skeleton className='h-48 w-full' />
        <Skeleton className='h-48 w-full' />
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
      <section className='min-w-0 space-y-4 border-y py-4 sm:space-y-5 sm:py-5'>
        <div className='flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex min-w-0 items-center gap-3'>
            <span className='bg-info/10 text-info flex size-10 shrink-0 items-center justify-center rounded-md'>
              <Radio className='size-4.5' />
            </span>
            <div className='min-w-0'>
              <h2 className='text-sm font-semibold sm:text-base'>
                {t('Official provider status')}
              </h2>
              <p className='text-muted-foreground mt-0.5 text-xs sm:text-sm'>
                {t('Live incident messages from official status pages')}
              </p>
            </div>
          </div>

          {!props.loading && providers.length > 0 ? (
            <div className='flex min-w-0 divide-x self-start sm:self-auto'>
              <div className='pr-3'>
                <div className='text-sm font-semibold tabular-nums'>
                  {providers.length}
                </div>
                <div className='text-muted-foreground text-xs'>
                  {t('Providers')}
                </div>
              </div>
              <div className='px-3'>
                <div
                  className={cn(
                    'text-sm font-semibold tabular-nums',
                    affectedProviders > 0 && 'text-status-warning'
                  )}
                >
                  {affectedProviders}
                </div>
                <div className='text-muted-foreground text-xs'>
                  {t('Affected providers')}
                </div>
              </div>
              <div className='pl-3'>
                <div
                  className={cn(
                    'text-sm font-semibold tabular-nums',
                    activeIncidents > 0 && 'text-status-warning'
                  )}
                >
                  {activeIncidents}
                </div>
                <div className='text-muted-foreground text-xs'>
                  {t('Active incidents')}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {content}
      </section>
    </TooltipProvider>
  )
}
