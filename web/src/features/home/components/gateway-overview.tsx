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
import { useTranslation } from 'react-i18next'

import { HeaderLogo } from '@/components/layout/components/header-logo'
import { ProviderBadge } from '@/components/provider-badge'
import { useSystemConfig } from '@/hooks/use-system-config'

import { modelProviders } from '../model-providers'

export function GatewayOverview() {
  const { t } = useTranslation()
  const { systemName, logo, loading, logoLoaded } = useSystemConfig()

  return (
    <figure
      className='home-orbit min-w-0'
      aria-label={t('Integration overview')}
    >
      <div className='home-orbit-stage'>
        <svg
          className='home-network'
          viewBox='0 0 100 100'
          aria-hidden='true'
          focusable='false'
        >
          {[
            'M50 50 Q27 50 27 20',
            'M50 50 Q75 50 75 24',
            'M50 50 Q70 62 85 54',
            'M50 50 Q45 80 70 82',
            'M50 50 Q24 50 25 78',
            'M50 50 Q32 35 14 48',
          ].map((path) => (
            <g key={path}>
              <path className='home-network-line' d={path} />
              <path className='home-network-signal' d={path} pathLength={100} />
            </g>
          ))}
        </svg>
        <div className='home-orbit-track' aria-hidden='true' />
        <div
          className='home-orbit-track home-orbit-track-outer'
          aria-hidden='true'
        />
        <div className='home-orbit-halo' aria-hidden='true' />
        <div className='home-orbit-center'>
          <div className='home-orbit-logo'>
            <HeaderLogo
              src={logo}
              alt={systemName}
              loading={loading}
              logoLoaded={logoLoaded}
              className='size-full object-contain'
            />
          </div>
          <p className='max-w-full truncate font-semibold'>{systemName}</p>
        </div>
        <ul className='home-orbit-models' aria-label={t('Model ecosystems')}>
          {modelProviders.map((provider) => (
            <li key={provider.name} className='home-orbit-position'>
              <div className='home-orbit-anchor'>
                <div className='home-orbit-card'>
                  <ProviderBadge
                    label={provider.name}
                    iconNode={<provider.Icon size={22} />}
                    colorText={false}
                    type='text'
                    size='sm'
                    copyable={false}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className='text-muted-foreground text-center text-xs'>
        {t('Models, tools and workflows')}
        <span
          className='bg-primary/35 mx-3 inline-block size-1 rounded-full align-middle'
          aria-hidden='true'
        />
        {t('Connected through one platform')}
      </figcaption>
    </figure>
  )
}
