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
import { Loader2, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthLayout } from '../auth-layout'
import { ErrorState } from '@/components/error-state'
import { api } from '@/lib/http-client'
import { authRequestOptions, authResult } from '@/lib/secure-verification'

export function ChatGPT2APISSO(props: { request?: string }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const pending = useRef<Promise<{ url: string }> | null>(null)

  useEffect(() => {
    let active = true
    // React StrictMode must not issue two authorization codes for one visit.
    pending.current ??= props.request
      ? authResult<{ url: string }>(
          api.post(
            '/api/sso/chatgpt2api/authorize',
            { request: props.request },
            { ...authRequestOptions, singleUseAuthorization: true }
          )
        )
      : Promise.reject(new Error('Missing single sign-on request'))
    void pending.current
      .then((result) => {
        if (!active) return
        const destination = new URL(result.url)
        if (
          destination.protocol !== 'https:' ||
          destination.username ||
          destination.password
        ) {
          setFailed(true)
          return
        }
        window.location.replace(destination.href)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [props.request])

  if (failed) {
    return (
      <ErrorState
        description={t(
          'Single sign-on failed. Please return to the platform and try again.'
        )}
        onRetry={() => window.location.replace('/sso/chatgpt2api')}
      />
    )
  }
  return (
    <AuthLayout>
      <div className='w-full space-y-8'>
        <div className='flex flex-col items-center space-y-4 text-center'>
          <div className='bg-muted flex h-16 w-16 items-center justify-center rounded-2xl'>
            <ShieldCheck className='h-8 w-8' aria-hidden='true' />
          </div>
          <div className='space-y-2'>
            <h1 className='text-2xl font-semibold tracking-tight'>
              {t('Signing in to chatgpt2api...')}
            </h1>
            <p className='text-muted-foreground text-sm sm:text-base'>
              {t('Processing OAuth response...')}
            </p>
          </div>
        </div>
        <div className='text-muted-foreground flex flex-col items-center gap-3 text-center text-sm'>
          <Loader2 className='h-5 w-5 animate-spin' aria-hidden='true' />
          <p>
            {t(
              "You'll be redirected automatically. You can return to the previous page if nothing happens after a few seconds."
            )}
          </p>
        </div>
      </div>
    </AuthLayout>
  )
}
