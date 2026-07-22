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
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Save, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageActionsPortal } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'
import {
  clearAllRouteAffinity,
  getRouteAffinityStats,
} from './route-affinity-api'

const routeAffinitySchema = z.object({
  RetryTimes: z.coerce.number().min(0).max(10),
  ChannelRouteCooldownEnabled: z.boolean(),
  ChannelRouteCooldownSeconds: z.coerce
    .number()
    .int()
    .min(0)
    .max(31536000, 'Cooldown cannot exceed 31536000 seconds'),
  ChannelRouteStickyEnabled: z.boolean(),
  ChannelRouteSameChannelRetries: z.coerce.number().int().min(0).max(10),
})

type RouteAffinityFormInput = z.input<typeof routeAffinitySchema>
type RouteAffinityFormValues = z.output<typeof routeAffinitySchema>

type RouteAffinitySettings = {
  RetryTimes: number
  ChannelRouteCooldownEnabled: boolean
  ChannelRouteCooldownSeconds: number
  ChannelRouteStickyEnabled: boolean
  ChannelRouteSameChannelRetries: number
}

type RouteAffinitySectionProps = {
  defaultValues: RouteAffinitySettings
}

function normalizeValues(
  values: RouteAffinityFormValues | RouteAffinitySettings
): RouteAffinitySettings {
  return {
    RetryTimes: values.ChannelRouteCooldownEnabled ? 0 : values.RetryTimes,
    ChannelRouteCooldownEnabled: values.ChannelRouteCooldownEnabled,
    ChannelRouteCooldownSeconds: values.ChannelRouteCooldownSeconds,
    ChannelRouteStickyEnabled: values.ChannelRouteStickyEnabled,
    ChannelRouteSameChannelRetries: values.ChannelRouteSameChannelRetries,
  }
}

export function ChannelRoutingSection(props: RouteAffinitySectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const defaults = useMemo(
    () => normalizeValues(props.defaultValues),
    [props.defaultValues]
  )
  const form = useForm<
    RouteAffinityFormInput,
    unknown,
    RouteAffinityFormValues
  >({
    resolver: zodResolver(routeAffinitySchema),
    defaultValues: defaults,
  })

  useResetForm(form, defaults)

  const affinityStats = useQuery({
    queryKey: ['route-affinity-stats'],
    queryFn: getRouteAffinityStats,
  })

  const routeEnabled = form.watch('ChannelRouteCooldownEnabled')

  const onSubmit = async (values: RouteAffinityFormValues) => {
    const normalized = normalizeValues(values)
    const updates = (
      Object.keys(normalized) as Array<keyof RouteAffinitySettings>
    ).filter((key) => normalized[key] !== defaults[key])

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of updates) {
      await updateOption.mutateAsync({ key, value: normalized[key] })
    }
  }

  const handleClearAll = async () => {
    setIsClearing(true)
    try {
      const result = await clearAllRouteAffinity()
      if (!result.success) {
        toast.error(result.message || t('Failed to clear route affinity'))
        return
      }
      toast.success(t('Route affinity cleared'))
      await affinityStats.refetch()
      setClearConfirmOpen(false)
    } catch {
      toast.error(t('Failed to clear route affinity'))
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <>
      <SettingsSection title={t('Channel routing')}>
        <Alert>
          <AlertDescription className='text-xs'>
            {t(
              'Route affinity keeps using the last successful routed channel for the same group, model, and request path until it fails.'
            )}
          </AlertDescription>
        </Alert>

        <Form {...form}>
          <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
            <SettingsPageActionsPortal>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() => affinityStats.refetch()}
                disabled={affinityStats.isFetching}
              >
                <RefreshCw
                  data-icon='inline-start'
                  className={affinityStats.isFetching ? 'animate-spin' : ''}
                />
                <span>{t('Refresh Cache')}</span>
              </Button>
              <Button
                type='button'
                size='sm'
                variant='destructive'
                onClick={() => setClearConfirmOpen(true)}
              >
                <Trash2 data-icon='inline-start' />
                <span>{t('Clear all route affinity')}</span>
              </Button>
              <Button
                type='button'
                size='sm'
                onClick={form.handleSubmit(onSubmit)}
                disabled={updateOption.isPending}
              >
                <Save data-icon='inline-start' />
                <span>
                  {updateOption.isPending ? t('Saving...') : t('Save Changes')}
                </span>
              </Button>
              {affinityStats.data?.data ? (
                <span className='text-muted-foreground text-xs'>
                  {t('Cache Entries')}: {affinityStats.data.data.total}
                </span>
              ) : null}
            </SettingsPageActionsPortal>

            <FormField
              control={form.control}
              name='ChannelRouteCooldownEnabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Channel routing')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Tries available channels in the same group from highest priority to lowest; standard request retries are disabled, while same-channel retries are configured separately'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={(checked) => {
                        field.onChange(checked)
                        if (checked) {
                          form.setValue('RetryTimes', 0, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                      }}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />

            <FormField
              control={form.control}
              name='ChannelRouteStickyEnabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Enable route affinity')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Keep using the last successful routed channel until it fails'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      disabled={!routeEnabled}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />

            <Separator />

            <FormField
              control={form.control}
              name='ChannelRouteSameChannelRetries'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Same-channel retries')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      max={10}
                      step={1}
                      disabled={!routeEnabled}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Number of retries on the current channel before switching channels (0 disables)'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='ChannelRouteCooldownSeconds'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Cooldown time (seconds)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      max={31536000}
                      step={1}
                      disabled={!routeEnabled}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'How long a failed routed channel stays out of selection before it is tried again (0 disables cooldown)'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsForm>
        </Form>
      </SettingsSection>

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={t('Confirm clearing all route affinity')}
        desc={t(
          'This clears every saved route affinity record. Future requests will select channels again.'
        )}
        confirmText={t('Clear')}
        destructive
        isLoading={isClearing}
        handleConfirm={handleClearAll}
      />
    </>
  )
}
