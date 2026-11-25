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
import i18next from 'i18next'
import { Gift, SlidersHorizontal, Wallet } from 'lucide-react'
import { useId, type ChangeEvent, type ReactNode } from 'react'
import type { Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Switch } from '@/components/ui/switch'
import { TitledCard } from '@/components/ui/titled-card'
import { formatQuota } from '@/lib/format'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsControlGroup,
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
  SettingsFormGrid,
  SettingsFormGridItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeJsonParse } from '../utils/json-parser'

const affiliateUsageRewardSchema = z.object({
  enabled: z.boolean(),
  rate_percent: z
    .number({ error: () => i18next.t('Please enter a valid number') })
    .refine((rate) => rate >= 0 && rate <= 100, {
      error: () =>
        i18next.t('Wallet usage commission rate must be between 0 and 100.'),
    }),
})

const defaultAffiliateUsageReward = { enabled: true, rate_percent: 5 }

const quotaSchema = z.object({
  QuotaForNewUser: z.coerce.number().min(0),
  QuotaForInviter: z.coerce.number().min(0),
  QuotaForInvitee: z.coerce.number().min(0),
  InviteRechargeRebateRatio: z.coerce.number().min(0),
  AffiliateUsageReward: affiliateUsageRewardSchema,
  TopUpLink: z.string(),
  quota_setting: z.object({
    enable_free_model_pre_consume: z.boolean(),
    trust_quota_usd: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.coerce
        .number({ error: () => i18next.t('Please enter a valid number') })
        .min(0, {
          error: () => i18next.t('Must be greater than or equal to 0'),
        })
    ),
    pre_consume_multiplier: z.coerce
      .number({ error: () => i18next.t('Please enter a valid number') })
      .positive({ error: () => i18next.t('Must be greater than 0') }),
  }),
})

type QuotaFormValues = z.infer<typeof quotaSchema>
type QuotaInputValue = number | ''

function formatQuotaInputValue(value: QuotaInputValue): string {
  return formatQuota(value === '' ? 0 : value)
}

type QuotaSettingsSectionProps = {
  defaultValues: Omit<QuotaFormValues, 'AffiliateUsageReward'>
  affiliateUsageRewardOption?: string
  complianceConfirmed?: boolean
}

function QuotaSettingsGroup(props: {
  title: string
  icon: ReactNode
  children: ReactNode
}) {
  const titleId = useId()

  return (
    <section aria-labelledby={titleId} className='min-w-0'>
      <TitledCard
        title={<h3 id={titleId}>{props.title}</h3>}
        icon={props.icon}
        iconTone='primary'
        disableHoverEffect
        className='rounded-2xl'
        headerClassName='bg-muted/25 sm:py-3 sm:!pb-3'
        contentClassName='sm:py-4'
        titleClassName='text-sm font-semibold sm:text-base'
      >
        <SettingsFormGrid className='items-start gap-y-4 [&_[data-slot=form-description]]:leading-relaxed'>
          {props.children}
        </SettingsFormGrid>
      </TitledCard>
    </section>
  )
}

export function QuotaSettingsSection({
  defaultValues,
  affiliateUsageRewardOption,
  complianceConfirmed = true,
}: QuotaSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const affiliateUsageReward = affiliateUsageRewardSchema.safeParse(
    safeJsonParse(affiliateUsageRewardOption, { silent: true })
  )
  const handleNumberChange =
    (onChange: (value: QuotaInputValue) => void) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.currentTarget.valueAsNumber
      onChange(Number.isNaN(value) ? '' : value)
    }

  const { form, handleSubmit, isDirty, isSubmitting } =
    useSettingsForm<QuotaFormValues>({
      resolver: zodResolver(quotaSchema) as Resolver<
        QuotaFormValues,
        unknown,
        QuotaFormValues
      >,
      defaultValues: {
        ...defaultValues,
        AffiliateUsageReward:
          affiliateUsageReward.data ?? defaultAffiliateUsageReward,
      },
      onSubmit: async (data, changedFields) => {
        if (
          'AffiliateUsageReward.enabled' in changedFields ||
          'AffiliateUsageReward.rate_percent' in changedFields
        ) {
          await updateOption.mutateAsync({
            key: 'AffiliateUsageReward',
            value: JSON.stringify(data.AffiliateUsageReward),
          })
        }
        for (const [key, value] of Object.entries(changedFields)) {
          if (key.startsWith('AffiliateUsageReward.')) continue
          await updateOption.mutateAsync({
            key,
            value: value as string | number | boolean,
          })
        }
      },
    })

  return (
    <SettingsSection
      title={t('Quota Settings')}
      className='w-full max-w-7xl pb-2'
    >
      <FormNavigationGuard when={isDirty} />

      <Form {...form}>
        <SettingsForm onSubmit={handleSubmit} className='gap-y-4'>
          <SettingsPageFormActions
            onSave={handleSubmit}
            isSaving={updateOption.isPending || isSubmitting}
          />
          <FormDirtyIndicator isDirty={isDirty} />
          <QuotaSettingsGroup title={t('Quota and top-ups')} icon={<Wallet />}>
            <FormField
              control={form.control}
              name='QuotaForNewUser'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('New User Quota')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value ?? ''}
                      onChange={handleNumberChange(field.onChange)}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Initial quota given to new users ({{formattedQuota}})',
                      {
                        formattedQuota: formatQuotaInputValue(field.value),
                      }
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='TopUpLink'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Top-Up Link')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('https://example.com/topup')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('External link for users to purchase quota')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </QuotaSettingsGroup>

          <QuotaSettingsGroup
            title={t('Request pre-consumption')}
            icon={<SlidersHorizontal />}
          >
            <FormField
              control={form.control}
              name='quota_setting.trust_quota_usd'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Wallet pre-consume bypass threshold (USD)')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      step='any'
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Skip pre-consumption when the wallet balance and limited API key balance both exceed this amount. Set to 0 to always pre-consume. Subscriptions and asynchronous tasks always reserve quota.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='quota_setting.pre_consume_multiplier'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Input pre-consume multiplier')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      step='any'
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Reserve the estimated input cost multiplied by this value, without estimating output tokens. Defaults to 1; positive decimals such as 0.5 and 1.5 are supported. Final charges use actual usage. Per-request and task prices are unaffected.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SettingsControlGroup className='py-0'>
              <FormField
                control={form.control}
                name='quota_setting.enable_free_model_pre_consume'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Pre-Consume for Free Models')}</FormLabel>
                      <FormDescription>
                        {t(
                          'When enabled, zero-cost models also pre-consume quota before final settlement.'
                        )}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={updateOption.isPending}
                      />
                    </FormControl>
                  </SettingsSwitchItem>
                )}
              />
            </SettingsControlGroup>
          </QuotaSettingsGroup>

          <QuotaSettingsGroup title={t('Referral Program')} icon={<Gift />}>
            {!complianceConfirmed ? (
              <Alert variant='destructive' className='lg:col-span-2'>
                <AlertDescription>
                  {t(
                    'Non-zero invitation rewards require compliance confirmation in Payment Gateway settings.'
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            <FormField
              control={form.control}
              name='QuotaForInviter'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Inviter Reward')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value ?? ''}
                      onChange={handleNumberChange(field.onChange)}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Quota given to users who invite others ({{formattedQuota}})',
                      {
                        formattedQuota: formatQuotaInputValue(field.value),
                      }
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='QuotaForInvitee'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Invitee Reward')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      value={field.value ?? ''}
                      onChange={handleNumberChange(field.onChange)}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Quota given to invited users ({{formattedQuota}})', {
                      formattedQuota: formatQuotaInputValue(field.value),
                    })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='InviteRechargeRebateRatio'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('First Top-Up Rebate Ratio')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min='0'
                      step='0.01'
                      value={field.value ?? ''}
                      onChange={handleNumberChange(field.onChange)}
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      "Inviters receive this share of an invited user's first successful paid top-up credited quota. 0 disables the rebate; 0.2 means 20%."
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SettingsFormGridItem>
              <SettingsControlGroup
                role='group'
                aria-label={t('Wallet usage commission')}
                className='space-y-2 p-3'
              >
                <FormField
                  control={form.control}
                  name='AffiliateUsageReward.enabled'
                  render={({ field }) => (
                    <SettingsSwitchItem className='py-0'>
                      <SettingsSwitchContent>
                        <FormLabel>
                          {t('Enable wallet usage commission')}
                        </FormLabel>
                      </SettingsSwitchContent>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={updateOption.isPending}
                        />
                      </FormControl>
                    </SettingsSwitchItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='AffiliateUsageReward.rate_percent'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Wallet usage commission (%)')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={0}
                          max={100}
                          step='any'
                          value={field.value ?? ''}
                          onChange={handleNumberChange(field.onChange)}
                          name={field.name}
                          onBlur={field.onBlur}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SettingsControlGroup>
            </SettingsFormGridItem>
          </QuotaSettingsGroup>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
