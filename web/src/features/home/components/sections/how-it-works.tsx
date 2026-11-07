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
import CherryStudio from '@lobehub/icons/es/CherryStudio/components/Mono.js'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Code2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { ProviderBadge } from '@/components/provider-badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'

import { HeroTerminalDemo } from '../hero-terminal-demo'

export function HowItWorks() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const docsUrl =
    (status?.docs_link as string | undefined) || 'https://docs.newapi.pro'
  const steps = [
    {
      title: t('Create an API key'),
      desc: t('Set up a key in the console and define how it can be used.'),
    },
    {
      title: t('Choose a model'),
      desc: t('Compare available models and pricing for your workload.'),
    },
    {
      title: t('Connect your application'),
      desc: t(
        'Use the API address and key in your SDK or compatible application.'
      ),
    },
  ]
  return (
    <section
      className='home-integration px-6 py-16 sm:px-8 lg:py-20'
      aria-labelledby='home-integration-title'
    >
      <div className='mx-auto max-w-6xl'>
        <AnimateInView className='flex flex-col justify-between gap-6 sm:flex-row sm:items-end'>
          <div>
            <p className='home-eyebrow mb-4'>{t('How It Works')}</p>
            <h2
              id='home-integration-title'
              className='text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl'
            >
              {t('Three steps to get started')}
            </h2>
          </div>
          <Button
            role='link'
            variant='outline'
            className='h-11 w-fit gap-2 rounded-xl px-5 has-data-[icon=inline-end]:pr-5'
            render={
              docsUrl.startsWith('http') ? (
                <a href={docsUrl} target='_blank' rel='noopener noreferrer' />
              ) : (
                <Link to={docsUrl} />
              )
            }
          >
            {t('Read the documentation')}
            <ArrowUpRight data-icon='inline-end' />
          </Button>
        </AnimateInView>
        <ol className='home-steps mt-12 grid gap-8 md:grid-cols-3 md:gap-10'>
          {steps.map((step, index) => (
            <AnimateInView
              as='li'
              key={step.title}
              delay={index * 100}
              className='relative'
            >
              <span
                className='home-step-number mb-6 inline-flex size-11 items-center justify-center rounded-xl border font-mono text-sm'
                aria-hidden='true'
              >
                0{index + 1}
              </span>
              <h3 className='text-lg font-semibold'>{step.title}</h3>
              <p className='text-muted-foreground mt-3 max-w-xs text-base leading-8'>
                {step.desc}
              </p>
            </AnimateInView>
          ))}
        </ol>
        <div className='bg-background border-border/60 mt-12 overflow-hidden rounded-2xl border'>
          <Accordion className='px-5 sm:px-7'>
            <AccordionItem value='api-example'>
              <AccordionTrigger className='items-center py-5 hover:no-underline'>
                <span className='flex items-center gap-3'>
                  <Code2 className='text-primary size-5' aria-hidden='true' />
                  {t('View API example')}
                </span>
              </AccordionTrigger>
              <AccordionContent className='pb-6'>
                <HeroTerminalDemo />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          <div className='border-border/60 flex flex-col justify-between gap-5 border-t px-5 py-6 sm:px-7 lg:flex-row lg:items-center'>
            <div className='max-w-lg'>
              <p className='text-sm font-medium'>
                {t('Supported Applications')}
              </p>
              <p className='text-muted-foreground mt-2 text-xs leading-6'>
                {t(
                  'Supports one-click configuration and perfectly adapts to NewAPI multi-protocol configuration.'
                )}
              </p>
            </div>
            <div className='flex flex-wrap gap-x-6 gap-y-4'>
              <a
                href='https://cherry-ai.com'
                target='_blank'
                rel='noopener noreferrer'
                className='flex items-center gap-2 text-sm hover:underline'
              >
                <ProviderBadge
                  label='Cherry Studio'
                  iconNode={<CherryStudio size={18} />}
                  colorText={false}
                  type='text'
                  copyable={false}
                />
                <ArrowUpRight className='size-3.5' aria-hidden='true' />
              </a>
              <a
                href='https://ccswitch.io'
                target='_blank'
                rel='noopener noreferrer'
                className='flex items-center gap-2 text-sm hover:underline'
              >
                CC Switch
                <ArrowUpRight className='size-3.5' aria-hidden='true' />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
