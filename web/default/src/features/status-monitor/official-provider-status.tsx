import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ExternalLink,
  Radio,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import type {
  OfficialProviderStatus,
  OfficialProviderStatusResponse,
} from './types'

const INDICATOR_META: Record<
  string,
  { label: string; variant: StatusVariant }
> = {
  none: { label: 'Operational', variant: 'success' },
  minor: { label: 'Minor outage', variant: 'warning' },
  major: { label: 'Major outage', variant: 'danger' },
  critical: { label: 'Critical outage', variant: 'danger' },
  maintenance: { label: 'Maintenance', variant: 'info' },
}

function formatOfficialTime(value: string) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { hourCycle: 'h23' })
}

function ProviderCard({ provider }: { provider: OfficialProviderStatus }) {
  const { t } = useTranslation()
  const meta = provider.available
    ? (INDICATOR_META[provider.indicator] ?? {
        label: 'Unknown',
        variant: 'neutral' as const,
      })
    : { label: 'Official status unavailable', variant: 'neutral' as const }

  return (
    <article className='min-w-0 rounded-lg border p-3 sm:p-4'>
      <div className='flex min-w-0 flex-wrap items-start justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-3'>
          <span className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-md'>
            {provider.available ? (
              <CheckCircle2 className='text-success size-4' />
            ) : (
              <AlertTriangle className='text-muted-foreground size-4' />
            )}
          </span>
          <div className='min-w-0'>
            <h3 className='text-sm font-semibold'>{provider.provider}</h3>
            <StatusBadge
              variant={meta.variant}
              copyable={false}
              className='mt-1'
            >
              {t(meta.label)}
            </StatusBadge>
          </div>
        </div>

        <Button
          variant='outline'
          size='sm'
          render={
            <a href={provider.subscribe_url} target='_blank' rel='noreferrer' />
          }
        >
          <BellRing />
          {t('Subscribe to official updates')}
          <ExternalLink data-icon='inline-end' />
        </Button>
      </div>

      {provider.incidents.length > 0 ? (
        <div className='mt-4 divide-y border-t'>
          {provider.incidents.map((incident) => (
            <div
              key={`${incident.name}-${incident.updated_at}`}
              className='py-3'
            >
              <div className='flex min-w-0 flex-wrap items-start justify-between gap-2'>
                <div className='min-w-0 text-sm font-medium [overflow-wrap:anywhere] break-words'>
                  {incident.name}
                </div>
                <StatusBadge
                  variant={incident.impact === 'none' ? 'neutral' : 'warning'}
                  copyable={false}
                >
                  {incident.status || incident.impact}
                </StatusBadge>
              </div>
              {incident.message ? (
                <p className='text-muted-foreground mt-1.5 text-sm [overflow-wrap:anywhere] break-words whitespace-pre-line'>
                  {incident.message}
                </p>
              ) : null}
              <div className='mt-2 flex flex-wrap items-center justify-between gap-2'>
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {formatOfficialTime(incident.updated_at)}
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
        <div className='text-muted-foreground mt-4 border-t pt-3 text-sm'>
          {provider.available
            ? t('No active incidents')
            : t('Official status unavailable')}
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

  return (
    <section className='min-w-0 border-y py-4 sm:py-5'>
      <div className='flex items-center gap-3'>
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

      {props.loading ? (
        <div className='mt-4 grid gap-3 lg:grid-cols-2'>
          <Skeleton className='h-36 w-full' />
          <Skeleton className='h-36 w-full' />
        </div>
      ) : props.failed || !props.response?.data.providers.length ? (
        <div className='text-muted-foreground mt-4 border-y border-dashed py-10 text-center text-sm'>
          {t('Official status unavailable')}
        </div>
      ) : (
        <div className='mt-4 grid min-w-0 gap-3 lg:grid-cols-2'>
          {props.response.data.providers.map((provider) => (
            <ProviderCard key={provider.provider} provider={provider} />
          ))}
        </div>
      )}
    </section>
  )
}
