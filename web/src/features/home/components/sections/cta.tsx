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
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Button } from '@/components/ui/button'

interface CTAProps {
  isAuthenticated?: boolean
}

export function CTA(props: CTAProps) {
  const { t } = useTranslation()
  return (
    <section
      className='home-cta relative overflow-hidden px-6 py-14 sm:px-8 lg:py-16'
      aria-labelledby='home-cta-title'
    >
      <AnimateInView className='relative z-10 mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 lg:flex-row lg:items-center'>
        <div className='relative max-w-2xl'>
          <p className='mb-4 text-xs font-medium tracking-wide opacity-75'>
            {t('AI services for your business')}
          </p>
          <h2
            id='home-cta-title'
            className='text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl'
          >
            {t('Put AI to work for your business.')}
          </h2>
          <p className='mt-5 text-sm leading-7 opacity-75'>
            {t(
              'Explore the models and pricing, then connect when you are ready.'
            )}
          </p>
        </div>
        <Button
          role='link'
          size='lg'
          className='home-action home-cta-action relative h-12 shrink-0 gap-2.5 rounded-xl px-7 has-data-[icon=inline-end]:pr-7'
          render={
            <Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />
          }
        >
          {props.isAuthenticated ? t('Go to Dashboard') : t('Get Started')}
          <ArrowRight data-icon='inline-end' />
        </Button>
      </AnimateInView>
    </section>
  )
}
