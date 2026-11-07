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
import { Link } from '@tanstack/react-router'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Layers3,
  Palette,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'
import { resolveCustomMenuPageUrl } from '@/lib/custom-menu-pages'
import { cn } from '@/lib/utils'

import { MEDIA_WORKSPACE_URL } from '../../constants'
import { GatewayOverview } from '../gateway-overview'

interface HeroProps {
  className?: string
  isAuthenticated?: boolean
}

export function Hero(props: HeroProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const docsUrl =
    (status?.docs_link as string | undefined) || 'https://docs.newapi.pro'
  const entries = [
    {
      icon: Braces,
      title: props.isAuthenticated ? t('Go to Dashboard') : t('Get Started'),
      description: t('API access and key management'),
      render: <Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />,
    },
    {
      icon: Layers3,
      title: t('Explore models'),
      description: t('Compare models and pricing'),
      render: <Link to='/pricing' />,
    },
    {
      icon: Palette,
      title: t('Media workspace'),
      description: t('Create in your workspace'),
      render: <a href={resolveCustomMenuPageUrl(MEDIA_WORKSPACE_URL)} />,
    },
    {
      icon: Activity,
      title: t('Site status'),
      description: t('Check service availability'),
      render: <Link to='/site-status' />,
    },
  ]
  return (
    <section
      className={cn(
        'home-hero relative isolate overflow-hidden px-6 pt-24 pb-12 sm:px-8 lg:pt-28 lg:pb-16',
        props.className
      )}
      aria-labelledby='home-title'
    >
      <div className='relative z-10 mx-auto grid max-w-6xl items-center gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-10'>
        <div className='home-hero-copy min-w-0'>
          <p className='home-eyebrow mb-6 flex items-center gap-3'>
            <span
              className='bg-primary size-1.5 rounded-full'
              aria-hidden='true'
            />
            {t('One platform for AI capabilities')}
          </p>
          <h1
            id='home-title'
            className='text-[clamp(2.5rem,4.5vw,4rem)] leading-[1.16] font-semibold tracking-tight text-balance'
          >
            {t('Connect with AI.')}
            <span className='home-title-accent text-primary mt-2 block'>
              {t('Build beyond limits.')}
            </span>
          </h1>
          <p className='text-muted-foreground mt-6 max-w-lg text-base leading-8 sm:text-lg'>
            {t(
              'From model APIs to media creation, bring AI into your applications and workflows through one platform.'
            )}
          </p>
          <div className='mt-7 grid grid-cols-1 gap-3 min-[380px]:grid-cols-2'>
            {entries.map((entry, index) => (
              <Button
                key={entry.title}
                role='link'
                variant={index === 0 ? 'default' : 'outline'}
                aria-label={entry.title}
                aria-describedby={`home-entry-${index}`}
                className={cn(
                  'home-entry h-auto min-w-0 justify-start gap-3 rounded-xl p-4 text-left whitespace-normal has-data-[icon=inline-end]:pr-4',
                  index === 0 && 'home-entry-primary'
                )}
                render={entry.render}
              >
                <entry.icon className='size-5 shrink-0' aria-hidden='true' />
                <span className='min-w-0 flex-1'>
                  <span className='block text-sm font-semibold'>
                    {entry.title}
                  </span>
                  <span
                    id={`home-entry-${index}`}
                    className='mt-1 block text-xs leading-5 font-normal opacity-75'
                  >
                    {entry.description}
                  </span>
                </span>
                <ArrowUpRight
                  data-icon='inline-end'
                  className='size-4 opacity-70'
                />
              </Button>
            ))}
          </div>
          <Button
            role='link'
            variant='link'
            className='mt-5 h-auto gap-2 p-0 has-data-[icon=inline-end]:pr-0'
            render={
              docsUrl.startsWith('http') ? (
                <a href={docsUrl} target='_blank' rel='noopener noreferrer' />
              ) : (
                <Link to={docsUrl} />
              )
            }
          >
            {t('Read the documentation')}
            <ArrowRight data-icon='inline-end' />
          </Button>
        </div>
        <div className='home-hero-visual min-w-0'>
          <GatewayOverview />
        </div>
      </div>
    </section>
  )
}
