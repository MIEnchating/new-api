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
import { ArrowRight, Braces } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Button } from '@/components/ui/button'
import { resolveCustomMenuPageUrl } from '@/lib/custom-menu-pages'

import { MEDIA_WORKSPACE_URL } from '../../constants'

export function Features() {
  const { t } = useTranslation()
  return (
    <section
      className='home-services px-6 py-16 sm:px-8 lg:py-20'
      aria-labelledby='home-features-title'
    >
      <div className='mx-auto max-w-6xl'>
        <AnimateInView className='mb-12 max-w-2xl'>
          <p className='home-eyebrow mb-4'>{t('Our services')}</p>
          <h2
            id='home-features-title'
            className='text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl'
          >
            {t('From integration to creation. Built around your work.')}
          </h2>
        </AnimateInView>
        <div className='grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20'>
          <AnimateInView>
            <p className='home-service-index' aria-hidden='true'>
              01 / API
            </p>
            <h3 className='mt-4 text-2xl font-semibold sm:text-3xl'>
              {t('Multi-model APIs')}
            </h3>
            <p className='text-muted-foreground mt-5 max-w-lg text-base leading-8'>
              {t(
                'Access leading models through one platform. Choose the capabilities and pricing that fit your application.'
              )}
            </p>
            <p className='text-muted-foreground mt-4 text-sm leading-7'>
              {t(
                'Connect through OpenAI, Claude, Gemini, and other compatible API routes'
              )}
            </p>
            <Button
              role='link'
              variant='link'
              className='mt-7 h-auto gap-2 p-0 text-base has-data-[icon=inline-end]:pr-0'
              render={<Link to='/pricing' />}
            >
              {t('Explore models')}
              <ArrowRight data-icon='inline-end' />
            </Button>
          </AnimateInView>
          <AnimateInView className='home-api-surface min-w-0 overflow-hidden rounded-2xl p-6 sm:p-9'>
            <div className='mb-7 flex items-center justify-between gap-4'>
              <p className='text-lg font-medium'>
                {t('One key. Multiple models.')}
              </p>
              <Braces className='size-6 opacity-70' aria-hidden='true' />
            </div>
            <ul className='divide-y divide-white/15'>
              {[
                { name: 'OpenAI', path: '/v1/chat/completions' },
                { name: 'Claude', path: '/v1/messages' },
                { name: 'Gemini', path: '/v1beta/models/*:generateContent' },
              ].map((protocol) => (
                <li
                  key={protocol.name}
                  className='flex flex-col gap-2 py-5 sm:flex-row sm:items-center sm:justify-between'
                >
                  <span className='text-sm font-medium'>{protocol.name}</span>
                  <code className='text-xs break-all text-blue-100/80'>
                    {protocol.path}
                  </code>
                </li>
              ))}
            </ul>
            <p className='mt-5 border-t border-white/15 pt-5 text-xs text-blue-100/80'>
              {t('Multi-protocol Compatible')}
            </p>
          </AnimateInView>
        </div>
        <div
          id='home-image-services'
          className='border-border/70 mt-14 grid scroll-mt-24 items-center gap-10 border-t pt-14 lg:mt-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20 lg:pt-20'
        >
          <AnimateInView className='min-w-0 lg:order-2'>
            <p className='home-service-index' aria-hidden='true'>
              02 / WORKSPACE
            </p>
            <h3 className='mt-4 text-2xl font-semibold sm:text-3xl'>
              {t('Media workspace')}
            </h3>
            <p className='text-muted-foreground mt-5 max-w-lg text-base leading-8'>
              {t(
                'Bring creative tasks into your media workspace. Start with AI images and turn ideas into content for your business.'
              )}
            </p>
            <ul className='text-muted-foreground mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm'>
              {[
                t('Product visuals'),
                t('Creative content'),
                t('Marketing design'),
              ].map((label) => (
                <li key={label} className='border-primary/25 border-l-2 pl-3'>
                  {label}
                </li>
              ))}
            </ul>
            <Button
              role='link'
              variant='link'
              className='mt-7 h-auto gap-2 p-0 text-base has-data-[icon=inline-end]:pr-0'
              render={
                <a href={resolveCustomMenuPageUrl(MEDIA_WORKSPACE_URL)} />
              }
            >
              {t('Start creating')}
              <ArrowRight data-icon='inline-end' />
            </Button>
          </AnimateInView>
          <AnimateInView className='min-w-0 lg:order-1'>
            <figure>
              <img
                src='/images/home/ai-product-visual.png'
                width={1536}
                height={1024}
                loading='lazy'
                decoding='async'
                alt={t('AI-generated blue product visual')}
                className='aspect-[3/2] w-full rounded-2xl object-cover'
              />
              <figcaption className='text-muted-foreground mt-3 text-xs'>
                {t('AI-generated visual example')}
              </figcaption>
            </figure>
          </AnimateInView>
        </div>
      </div>
    </section>
  )
}
