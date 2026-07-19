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
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import i18next from 'i18next'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { wechatLoginByCode } from '@/features/auth/api'
import { completeLoginSession } from '@/features/auth/lib/login-session'
import {
  buildOAuthCallbackKey,
  resolveOAuthLoginCompletion,
} from '@/features/auth/lib/oauth-callback'
import { normalizeOAuthRedirectTarget } from '@/features/auth/lib/oauth-redirect'
import { saveUserId } from '@/features/auth/lib/storage'
import { getSelf } from '@/lib/api'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'

function OAuthComponent() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/(auth)/oauth' }) as {
    redirect?: string
    provider?: 'github' | 'discord' | 'oidc' | 'linuxdo' | 'telegram' | 'wechat'
    code?: string
    state?: string
  }
  const processedCallbackRef = useRef<string | null>(null)

  useEffect(() => {
    const callbackKey = buildOAuthCallbackKey(search)
    if (processedCallbackRef.current === callbackKey) return
    processedCallbackRef.current = callbackKey

    ;(async () => {
      try {
        if (search?.provider === 'wechat' && search.code) {
          const wechatResponse = await wechatLoginByCode(search.code)
          if (!wechatResponse?.success) {
            throw new Error(wechatResponse?.message || 'OAuth failed')
          }
        }
        const completed = await completeLoginSession<
          AuthUser & { status: number }
        >({
          fetchCurrentUser: getSelf,
          persistUser: (user) => {
            useAuthStore.getState().auth.setUser(user)
            saveUserId(user.id)
          },
          clearUser: () => useAuthStore.getState().auth.reset(),
          onSuccess: () => undefined,
        })
        const completion = resolveOAuthLoginCompletion(
          completed,
          i18next.t('OAuth failed')
        )
        if (completion.ok) {
          const target = normalizeOAuthRedirectTarget(
            search?.redirect,
            window.location.origin
          )
          navigate({ to: target, replace: true })
          return
        }
        toast.error(completion.message)
        navigate({ to: '/sign-in', replace: true })
        return
      } catch {
        /* empty */
      }
      toast.error(i18next.t('OAuth failed'))
      navigate({ to: '/sign-in', replace: true })
    })()
  }, [navigate, search])

  return null
}

export const Route = createFileRoute('/(auth)/oauth')({
  component: OAuthComponent,
})
