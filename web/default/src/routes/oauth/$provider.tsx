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
import {
  createFileRoute,
  useNavigate,
  useParams,
  useSearch,
} from '@tanstack/react-router'
import type { AxiosRequestConfig } from 'axios'
import i18next from 'i18next'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { OAuthCallbackScreen } from '@/features/auth/components/oauth-callback-screen'
import { OAUTH_BIND_STORAGE_KEY } from '@/features/auth/constants'
import { completeLoginSession } from '@/features/auth/lib/login-session'
import {
  buildOAuthCallbackKey,
  resolveOAuthLoginCompletion,
} from '@/features/auth/lib/oauth-callback'
import {
  buildOAuthReturnURL,
  normalizeOAuthRedirectTarget,
} from '@/features/auth/lib/oauth-redirect'
import { saveUserId } from '@/features/auth/lib/storage'
import { api, getSelf } from '@/lib/api'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'

type OAuthRequestConfig = AxiosRequestConfig & {
  skipBusinessError?: boolean
}

function OAuthCallback() {
  const navigate = useNavigate()
  const { provider } = useParams({ from: '/oauth/$provider' }) as {
    provider: string
  }
  const search = useSearch({ from: '/oauth/$provider' }) as {
    code?: string
    state?: string
    redirect?: string
  }
  const [mode, setMode] = useState<'login' | 'bind'>(() => {
    if (typeof window === 'undefined') return 'login'
    return window.opener ? 'bind' : 'login'
  })
  const processedCallbackRef = useRef<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(window.opener ? 'bind' : 'login')
  }, [])

  useEffect(() => {
    const callbackKey = buildOAuthCallbackKey({
      provider,
      code: search?.code,
      state: search?.state,
      redirect: search?.redirect,
    })
    if (processedCallbackRef.current === callbackKey) return
    processedCallbackRef.current = callbackKey

    ;(async () => {
      const safeNavigate = (target: string) => {
        navigate({ to: target as never, replace: true })
        if (typeof window !== 'undefined') {
          setTimeout(() => {
            const normalizedTarget = target.startsWith('/')
              ? target
              : `/${target}`
            const currentPath =
              window.location.pathname + window.location.search
            if (
              currentPath !== normalizedTarget &&
              currentPath !== `${normalizedTarget}/`
            ) {
              window.location.replace(target)
            }
          }, 100)
        }
      }

      if (!search?.code) {
        toast.error(i18next.t('Missing code'))
        safeNavigate('/sign-in')
        return
      }
      const isBindingFlow =
        typeof window !== 'undefined' ? Boolean(window.opener) : mode === 'bind'
      if (isBindingFlow && mode !== 'bind') {
        setMode('bind')
      } else if (!isBindingFlow && mode !== 'login') {
        setMode('login')
      }
      const notifyBindingResult = (
        status: 'success' | 'error',
        returnOrigin?: string
      ) => {
        if (typeof window === 'undefined') return
        const payload = {
          type: OAUTH_BIND_STORAGE_KEY,
          provider,
          status,
          timestamp: Date.now(),
        }
        try {
          window.localStorage.setItem(
            OAUTH_BIND_STORAGE_KEY,
            JSON.stringify(payload)
          )
        } catch (_error) {
          // ignore storage write failures
          void _error
        }
        if (window.opener && returnOrigin) {
          try {
            const targetOrigin = new URL(returnOrigin).origin
            if (targetOrigin.startsWith('https://')) {
              window.opener.postMessage(payload, targetOrigin)
            }
          } catch (_error) {
            void _error
          }
        }
      }

      const closeBindingWindow = () => {
        if (typeof window === 'undefined') return
        window.close()
        setTimeout(() => {
          if (!window.closed) {
            window.location.replace('/_authenticated/profile/')
          }
        }, 200)
      }

      const finalizeLogin = () =>
        completeLoginSession<AuthUser & { status: number }>({
          fetchCurrentUser: getSelf,
          persistUser: (user) => {
            useAuthStore.getState().auth.setUser(user)
            saveUserId(user.id)
          },
          clearUser: () => useAuthStore.getState().auth.reset(),
          onSuccess: () => undefined,
        })

      const redirectAfterLogin = (target?: string, returnOrigin?: string) => {
        const currentOrigin = window.location.origin
        const to = normalizeOAuthRedirectTarget(
          target || search?.redirect,
          currentOrigin
        )
        const crossSiteReturnURL = buildOAuthReturnURL(
          returnOrigin,
          to,
          currentOrigin
        )
        if (crossSiteReturnURL) {
          window.location.replace(crossSiteReturnURL)
          return
        }
        safeNavigate(to)
        toast.success(i18next.t('Signed in successfully!'))
      }

      const handleBindingFailure = (message: string) => {
        notifyBindingResult('error')
        toast.error(message)
      }

      const handleLoginFailure = async (message: string) => {
        const completed = await finalizeLogin()
        if (completed.ok) {
          redirectAfterLogin()
          return
        }
        toast.error(message)
        safeNavigate('/sign-in')
      }

      try {
        const config: OAuthRequestConfig = {
          params: { code: search.code, state: search.state },
          skipBusinessError: true,
        }
        const res = await api.get(`/api/oauth/${provider}`, config)
        if (res?.data?.success) {
          const { message } = res.data
          const loginUser = (res.data?.data ?? null) as
            | (AuthUser & { return_origin?: string })
            | null
          // Check if this is a bind operation
          if (message === 'bind') {
            const bindReturnOrigin = (
              res.data?.data as {
                return_origin?: string
              }
            )?.return_origin
            toast.success(i18next.t('Binding successful!'))
            notifyBindingResult('success', bindReturnOrigin)
            if (isBindingFlow) {
              // Close the callback window if we opened a new tab for binding
              closeBindingWindow()
            } else {
              safeNavigate('/_authenticated/profile/')
            }
            return
          }
          // The callback payload only contains a small identity projection.
          // Verify the session and fetch the authoritative user before storing
          // it, otherwise a cross-site cookie failure can look like success.
          if (loginUser) {
            const returnOrigin = loginUser.return_origin
            const completed = resolveOAuthLoginCompletion(
              await finalizeLogin(),
              i18next.t('OAuth failed')
            )
            if (completed.ok) {
              redirectAfterLogin(undefined, returnOrigin)
              return
            }
            toast.error(completed.message)
            safeNavigate('/sign-in')
            return
          }
          const completed = resolveOAuthLoginCompletion(
            await finalizeLogin(),
            res?.data?.message || i18next.t('OAuth failed')
          )
          if (completed.ok) {
            redirectAfterLogin()
            return
          }
          toast.error(completed.message)
          safeNavigate('/sign-in')
          return
        }
        const message = res?.data?.message || 'OAuth failed'
        if (!res?.data?.success && !isBindingFlow) {
          // When logging in with an already bound GitHub account, backend may return this message
          if (message === '该 GitHub 账户已被绑定') {
            const completed = await finalizeLogin()
            if (completed.ok) {
              redirectAfterLogin()
              return
            }
            toast.error(message)
            safeNavigate('/sign-in')
            return
          }
        }
        if (isBindingFlow) {
          handleBindingFailure(message)
        } else {
          await handleLoginFailure(message)
        }
        return
      } catch (error) {
        const message = ((error &&
          typeof error === 'object' &&
          'response' in error &&
          (error as { response?: { data?: { message?: string } } }).response
            ?.data?.message) ??
          (error instanceof Error ? error.message : undefined) ??
          'OAuth failed') as string

        if (isBindingFlow) {
          handleBindingFailure(message)
          return
        }
        await handleLoginFailure(message)
        return
      }
    })()
  }, [mode, navigate, provider, search])

  return <OAuthCallbackScreen provider={provider} mode={mode} />
}

export const Route = createFileRoute('/oauth/$provider')({
  component: OAuthCallback,
})
