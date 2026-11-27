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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { TitledCard } from '@/components/ui/titled-card'
import {
  SecureVerificationDialog,
  useSecureVerification,
} from '@/features/auth/secure-verification'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

type BindingStatus = { enabled: boolean; bound: boolean }
type BindingResponse = { success: boolean; data: BindingStatus }

const path = '/api/user/qqbot'
const bindingSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{43}$/, 'Enter a valid QQ binding code.'),
})

export function QQBotBindingCard() {
  const { t } = useTranslation()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const queryClient = useQueryClient()
  const verification = useSecureVerification()
  const form = useForm({
    resolver: zodResolver(bindingSchema),
    defaultValues: { code: '' },
  })
  const queryKey = ['qq-bot-account-binding', userID]
  const status = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await api.get<BindingResponse>(path, { signal })
      return requireServerSuccess(response.data).data
    },
    enabled: Boolean(userID),
  })
  const change = useMutation({
    gcTime: 0,
    retry: false,
    meta: { errorToast: false },
    mutationFn: async (input: { code?: string; proof: string }) => {
      const config = { headers: { 'X-Security-Proof': input.proof } }
      const response = input.code
        ? await api.post<BindingResponse>(path, { code: input.code }, config)
        : await api.delete<BindingResponse>(path, config)
      return requireServerSuccess(response.data).data.bound
    },
  })

  const binding = status.data
  if (!binding || (!binding.enabled && !binding.bound)) return null

  const updateBinding = async (code?: string) => {
    try {
      const proof = code
        ? await verification.requestVerification({
            scope: 'account.binding.bind',
            context: { provider: 'qq_bot', code },
            title: t('Bind QQ account'),
          })
        : await verification.requestVerification({
            scope: 'qq_bot.account.unbind',
            title: t('Unbind QQ account'),
          })
      if (!proof) return
      const bound = await change.mutateAsync({ code, proof: proof.proof_token })
      queryClient.setQueryData<BindingStatus>(queryKey, {
        enabled: binding.enabled,
        bound,
      })
      form.reset()
      toast.success(bound ? t('Binding successful') : t('QQ account unbound.'))
    } catch (error) {
      handleServerError(error)
    } finally {
      change.reset()
    }
  }

  return (
    <TitledCard
      title={t('QQ Bot')}
      description={
        binding.enabled
          ? t(
              'In a QQ group, send /bind followed by your registered email and enter the code from your inbox here. For private chat, send /bind to the bot.'
            )
          : undefined
      }
      action={
        binding.bound && (
          <Button
            type='button'
            variant='outline'
            disabled={
              change.isPending ||
              verification.dialogProps.state.phase !== 'idle'
            }
            onClick={() => void updateBinding()}
          >
            {t('Unbind')}
          </Button>
        )
      }
    >
      {binding.bound && (
        <p className='text-muted-foreground mb-3 text-sm'>
          {t('Your QQ account is bound.')}
        </p>
      )}
      {binding.enabled && (
        <Form {...form}>
          <form
            className='flex flex-wrap items-end gap-3'
            onSubmit={form.handleSubmit(({ code }) => updateBinding(code))}
          >
            <FormField
              control={form.control}
              name='code'
              render={({ field }) => (
                <FormItem className='min-w-0 flex-1'>
                  <FormLabel>{t('QQ binding code')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete='off'
                      autoCapitalize='none'
                      spellCheck={false}
                      type='password'
                      maxLength={43}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type='submit' disabled={form.formState.isSubmitting}>
              {t('Bind')}
            </Button>
          </form>
        </Form>
      )}
      <SecureVerificationDialog {...verification.dialogProps} />
    </TitledCard>
  )
}
