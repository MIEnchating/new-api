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
import { Link } from '@tanstack/react-router'
import { RefreshCw, Route, Settings2, TimerOff, TimerReset } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getChannelOps } from './api'
import { ChannelsDialogs } from './components/channels-dialogs'
import { ChannelsPrimaryButtons } from './components/channels-primary-buttons'
import { ChannelsProvider } from './components/channels-provider'
import { ChannelsTable } from './components/channels-table'

export function Channels() {
  const { t } = useTranslation()
  const isRoot = useAuthStore(
    (state) => state.auth.user?.role === ROLE.SUPER_ADMIN
  )
  const channelOpsQuery = useQuery({
    queryKey: ['channel-ops'],
    queryFn: getChannelOps,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
  const channelOps = channelOpsQuery.data?.data
  const channelRouteEnabled = channelOps?.channel_route_enabled === true
  const channelRouteCooldownSeconds = channelOps?.channel_route_cooldown_seconds
  const channelRouteSameChannelRetries =
    channelOps?.channel_route_same_channel_retries
  const retryTimes = channelOpsQuery.data?.data?.retry_times
  const summaryAriaLabel = channelRouteEnabled
    ? t('Channel routing')
    : t('Retry Settings')
  let opsBadge = null
  if (channelRouteEnabled || typeof retryTimes === 'number') {
    const cooldownDisabled =
      typeof channelRouteCooldownSeconds === 'number' &&
      channelRouteCooldownSeconds === 0
    const sameChannelRetries = channelRouteSameChannelRetries ?? 0
    const summaryContent = (
      <span className='border-border bg-muted/20 inline-flex h-7 max-w-full items-center overflow-hidden rounded-md border text-xs font-medium'>
        {channelRouteEnabled ? (
          <>
            <span className='text-success flex h-full shrink-0 items-center gap-1.5 px-2'>
              <Route className='size-3.5' />
              <span>{t('Channel routing')}</span>
            </span>
            <span className='border-border text-muted-foreground flex h-full shrink-0 items-center gap-1.5 border-l px-2'>
              {cooldownDisabled ? (
                <TimerOff className='size-3.5' />
              ) : (
                <TimerReset className='size-3.5' />
              )}
              <span>
                {t('Cooldown')}:{' '}
                {cooldownDisabled
                  ? t('Disabled')
                  : typeof channelRouteCooldownSeconds === 'number'
                    ? `${channelRouteCooldownSeconds}s`
                    : '-'}
              </span>
            </span>
            <span className='border-border flex h-full shrink-0 items-center gap-1.5 border-l px-2'>
              <RefreshCw className='text-muted-foreground size-3.5' />
              <span>
                {t('Retry')}: {sameChannelRetries}
              </span>
            </span>
          </>
        ) : (
          <span className='flex h-full shrink-0 items-center gap-1.5 px-2'>
            <RefreshCw className='text-muted-foreground size-3.5' />
            <span>
              {t('Max Retries')}: {retryTimes}
            </span>
          </span>
        )}
        {isRoot ? (
          <span className='border-border text-muted-foreground group-hover:text-foreground flex h-full w-7 shrink-0 items-center justify-center border-l transition-colors'>
            <Settings2 className='size-3.5' />
          </span>
        ) : null}
      </span>
    )
    const tooltipContent = channelRouteEnabled ? (
      <div className='space-y-1'>
        <p className='font-medium'>{t('Channel routing')}</p>
        <p>
          {t('Channel route cooldown')}:{' '}
          {cooldownDisabled
            ? t('Disabled')
            : typeof channelRouteCooldownSeconds === 'number'
              ? `${channelRouteCooldownSeconds}s`
              : '-'}
        </p>
        <p>
          {t('Same-channel retries')}:{' '}
          {typeof channelRouteSameChannelRetries === 'number'
            ? channelRouteSameChannelRetries
            : 0}
        </p>
      </div>
    ) : (
      <p>{t('Retry Settings')}</p>
    )

    opsBadge = isRoot ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              className='group focus-visible:ring-ring shrink-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-2'
              aria-label={summaryAriaLabel}
              to='/system-settings/models/$section'
              params={{ section: 'routing-reliability' }}
            />
          }
        >
          {summaryContent}
        </TooltipTrigger>
        <TooltipContent>{tooltipContent}</TooltipContent>
      </Tooltip>
    ) : (
      summaryContent
    )
  }

  return (
    <ChannelsProvider>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          <span className='flex min-w-0 items-center gap-2.5'>
            <span className='truncate'>{t('Channels')}</span>
            {opsBadge}
          </span>
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <ChannelsPrimaryButtons />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <ChannelsTable />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ChannelsDialogs />
    </ChannelsProvider>
  )
}
