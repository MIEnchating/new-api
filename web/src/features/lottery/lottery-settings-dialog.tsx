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
import { Gift, Loader2, Plus, Settings2, Trash2, Trophy } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CompactDateTimeRangePicker } from '@/components/compact-date-time-range-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { getLotteryConfig, updateLotteryConfig } from './api'
import type {
  LotteryChanceGrantRule,
  LotteryChanceGrantRuleType,
  LotteryConfig,
  LotteryPrize,
  LotteryRechargeGrantLimit,
} from './types'

const EMPTY_CONFIG: LotteryConfig = {
  rules: {
    weekly_spend_amount: 50,
    weekly_chance_limit: 5,
    daily_active_amount: 20,
    streak_rewards: [
      { days: 3, chances: 1 },
      { days: 7, chances: 3 },
    ],
  },
  prizes: [],
  grant_rules: [],
}

function normalizeLotteryPrizeName(prize: LotteryPrize) {
  const legacyNames: Record<string, string> = {
    '1 quota': '1 元额度',
    '5 quota': '5 元额度',
    '8 quota': '8 元额度',
    'No prize': '未中奖',
  }
  if (prize.name in legacyNames) return legacyNames[prize.name]
  if (prize.name) return prize.name
  return prize.amount <= 0 ? '未中奖' : prize.type
}

function normalizeConfig(value: Partial<LotteryConfig>): LotteryConfig {
  return {
    rules: {
      ...EMPTY_CONFIG.rules,
      ...value.rules,
      streak_rewards:
        value.rules?.streak_rewards || EMPTY_CONFIG.rules.streak_rewards,
    },
    prizes: (value.prizes || []).map((prize) => ({
      ...prize,
      name: normalizeLotteryPrizeName(prize),
    })),
    grant_rules: (value.grant_rules || []).map((rule) => ({
      ...rule,
      limit: rule.type === 'recharge' ? rule.limit || 'cumulative' : undefined,
      reclaim:
        rule.type === 'event' &&
        (rule.reclaim === true ||
          (rule.reclaim as unknown) === 1 ||
          (rule.reclaim as unknown) === 'true'),
    })),
  }
}

function createGrantRule(
  type: LotteryChanceGrantRuleType
): LotteryChanceGrantRule {
  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() + 7)
  return {
    id: `grant_${nanoid(12)}`,
    type,
    name: '',
    enabled: true,
    threshold: type === 'recharge' ? 50 : 0,
    limit: type === 'recharge' ? 'cumulative' : undefined,
    reclaim: type === 'event',
    chances: 1,
    start_at: Math.floor(now.getTime() / 1000),
    end_at: Math.floor(end.getTime() / 1000),
  }
}

function rechargeGrantLimitLabel(
  limit: LotteryRechargeGrantLimit | undefined,
  t: ReturnType<typeof useTranslation>['t']
) {
  switch (limit) {
    case 'daily':
      return t('Once per day')
    case 'unlimited':
      return t('Every qualifying recharge')
    case 'cumulative':
    default:
      return t('Once per campaign')
  }
}

function createPrize(noPrize = false): LotteryPrize {
  return {
    type: `prize_${nanoid(12)}`,
    name: '',
    amount: noPrize ? 0 : 1,
    probability: 0,
  }
}

function timestampToDate(value: number) {
  return value > 0 ? new Date(value * 1000) : undefined
}

function dateToTimestamp(value: Date | undefined) {
  return value ? Math.floor(value.getTime() / 1000) : 0
}

interface LotterySettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (config: LotteryConfig) => void
}

export function LotterySettingsDialog(props: LotterySettingsDialogProps) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<LotteryConfig>(EMPTY_CONFIG)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getLotteryConfig()
      if (!response.success || !response.data) {
        toast.error(t(response.message || 'Failed to load lottery settings'))
        return
      }
      setConfig(normalizeConfig(response.data))
    } catch {
      toast.error(t('Failed to load lottery settings'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (props.open) void loadConfig()
  }, [loadConfig, props.open])

  const probabilityTotal = useMemo(
    () => config.prizes.reduce((sum, prize) => sum + prize.probability, 0),
    [config.prizes]
  )

  const patchGrant = (
    index: number,
    patch: Partial<LotteryChanceGrantRule>
  ) => {
    setConfig((current) => ({
      ...current,
      grant_rules: current.grant_rules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule
      ),
    }))
  }

  const patchPrize = (index: number, patch: Partial<LotteryPrize>) => {
    setConfig((current) => ({
      ...current,
      prizes: current.prizes.map((prize, prizeIndex) =>
        prizeIndex === index ? { ...prize, ...patch } : prize
      ),
    }))
  }

  const validate = () => {
    if (
      config.rules.weekly_spend_amount < 0 ||
      config.rules.weekly_chance_limit < 0 ||
      config.rules.daily_active_amount < 0
    ) {
      return t('Lottery rule values cannot be negative')
    }
    if (
      config.rules.streak_rewards.some(
        (reward) => reward.days <= 0 || reward.chances <= 0
      )
    ) {
      return t('Streak days and reward chances must be greater than 0')
    }
    if (config.prizes.length < 2 || config.prizes.length > 20) {
      return t('The prize pool must contain between 2 and 20 entries')
    }
    if (probabilityTotal !== 100) return t('Total probability must equal 100%')
    if (!config.prizes.some((prize) => prize.amount === 0)) {
      return t('Add at least one no-prize entry with an amount of 0')
    }
    if (config.prizes.some((prize) => !prize.name.trim())) {
      return t('Each prize needs a name')
    }
    if (
      config.grant_rules.some(
        (rule) =>
          !rule.name.trim() ||
          rule.chances <= 0 ||
          (rule.type === 'recharge' && rule.threshold <= 0) ||
          (rule.start_at > 0 && rule.end_at > 0 && rule.end_at <= rule.start_at)
      )
    ) {
      return t('Complete the chance grant rule and check its time range')
    }
    return ''
  }

  const submit = async () => {
    const nextConfig = normalizeConfig(config)
    const validationMessage = validate()
    if (validationMessage) {
      toast.error(validationMessage)
      return
    }
    setSaving(true)
    try {
      const response = await updateLotteryConfig(nextConfig)
      if (!response.success || !response.data) {
        toast.error(t(response.message || 'Failed to save lottery settings'))
        return
      }
      const savedConfig = normalizeConfig(response.data)
      setConfig(savedConfig)
      props.onSaved(savedConfig)
      props.onOpenChange(false)
      toast.success(t('Lottery settings saved'))
    } catch {
      toast.error(t('Failed to save lottery settings'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className='flex h-[min(760px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] flex-col p-0 sm:max-w-4xl'
        initialFocus={false}
      >
        <DialogHeader className='shrink-0 border-b px-5 py-4'>
          <DialogTitle>{t('Lottery management')}</DialogTitle>
          <DialogDescription>
            {t(
              'Manage earning rules, chance grant campaigns, and the prize pool separately.'
            )}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className='flex flex-1 items-center justify-center'>
            <Loader2 className='text-muted-foreground size-6 animate-spin' />
          </div>
        ) : (
          <Tabs defaultValue='prizes' className='min-h-0 flex-1 gap-0'>
            <TabsList variant='line' className='mx-5 mt-3 shrink-0'>
              <TabsTrigger value='rules'>
                <Settings2 />
                {t('Base rules')}
              </TabsTrigger>
              <TabsTrigger value='grants'>
                <Gift />
                {t('Chance grants')}
              </TabsTrigger>
              <TabsTrigger value='prizes'>
                <Trophy />
                {t('Prize pool')}
              </TabsTrigger>
            </TabsList>
            <div className='min-h-0 flex-1 overflow-auto'>
              <TabsContent value='rules' className='space-y-4 p-5'>
                <section className='grid gap-4 rounded-md border p-4 sm:grid-cols-3'>
                  <NumberField
                    label={t('Spend amount per chance')}
                    value={config.rules.weekly_spend_amount}
                    min={0}
                    suffix={t('Yuan')}
                    onChange={(value) =>
                      setConfig((current) => ({
                        ...current,
                        rules: { ...current.rules, weekly_spend_amount: value },
                      }))
                    }
                  />
                  <NumberField
                    label={t('Weekly chance limit')}
                    value={config.rules.weekly_chance_limit}
                    min={0}
                    suffix={t('times')}
                    onChange={(value) =>
                      setConfig((current) => ({
                        ...current,
                        rules: { ...current.rules, weekly_chance_limit: value },
                      }))
                    }
                  />
                  <NumberField
                    label={t('Daily active spend')}
                    value={config.rules.daily_active_amount}
                    min={0}
                    suffix={t('Yuan')}
                    onChange={(value) =>
                      setConfig((current) => ({
                        ...current,
                        rules: { ...current.rules, daily_active_amount: value },
                      }))
                    }
                  />
                </section>
                <section className='rounded-md border'>
                  <div className='flex items-center justify-between border-b px-4 py-3'>
                    <div>
                      <h3 className='font-medium'>{t('Streak rewards')}</h3>
                      <p className='text-muted-foreground text-xs'>
                        {t(
                          'Configure any streak milestone instead of fixed 3-day and 7-day rewards.'
                        )}
                      </p>
                    </div>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          rules: {
                            ...current.rules,
                            streak_rewards: [
                              ...current.rules.streak_rewards,
                              { days: 1, chances: 1 },
                            ],
                          },
                        }))
                      }
                    >
                      <Plus />
                      {t('Add')}
                    </Button>
                  </div>
                  <div className='divide-y'>
                    {config.rules.streak_rewards.map((reward, index) => (
                      <div
                        key={`${index}-${reward.days}`}
                        className='grid items-end gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]'
                      >
                        <NumberField
                          label={t('Consecutive days')}
                          value={reward.days}
                          min={1}
                          suffix={t('days')}
                          onChange={(value) =>
                            setConfig((current) => ({
                              ...current,
                              rules: {
                                ...current.rules,
                                streak_rewards:
                                  current.rules.streak_rewards.map(
                                    (item, rewardIndex) =>
                                      rewardIndex === index
                                        ? { ...item, days: value }
                                        : item
                                  ),
                              },
                            }))
                          }
                        />
                        <NumberField
                          label={t('Reward chances')}
                          value={reward.chances}
                          min={1}
                          suffix={t('times')}
                          onChange={(value) =>
                            setConfig((current) => ({
                              ...current,
                              rules: {
                                ...current.rules,
                                streak_rewards:
                                  current.rules.streak_rewards.map(
                                    (item, rewardIndex) =>
                                      rewardIndex === index
                                        ? { ...item, chances: value }
                                        : item
                                  ),
                              },
                            }))
                          }
                        />
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          aria-label={t('Delete')}
                          onClick={() =>
                            setConfig((current) => ({
                              ...current,
                              rules: {
                                ...current.rules,
                                streak_rewards:
                                  current.rules.streak_rewards.filter(
                                    (_, rewardIndex) => rewardIndex !== index
                                  ),
                              },
                            }))
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              </TabsContent>

              <TabsContent value='grants' className='space-y-4 p-5'>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <p className='text-muted-foreground text-sm'>
                    {t(
                      'Each recharge campaign grants once per user after cumulative successful recharges reach the threshold.'
                    )}
                  </p>
                  <div className='flex gap-2'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          grant_rules: [
                            ...current.grant_rules,
                            createGrantRule('recharge'),
                          ],
                        }))
                      }
                    >
                      <Plus />
                      {t('Recharge grant')}
                    </Button>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          grant_rules: [
                            ...current.grant_rules,
                            createGrantRule('event'),
                          ],
                        }))
                      }
                    >
                      <Plus />
                      {t('Event grant')}
                    </Button>
                  </div>
                </div>
                {config.grant_rules.length === 0 ? (
                  <div className='text-muted-foreground flex min-h-40 items-center justify-center rounded-md border border-dashed text-sm'>
                    {t('No chance grant rules')}
                  </div>
                ) : (
                  config.grant_rules.map((rule, index) => (
                    <section
                      key={rule.id}
                      className='relative isolate overflow-visible rounded-md border'
                    >
                      <div className='flex items-center justify-between gap-3 border-b px-4 py-3'>
                        <div className='flex min-w-0 items-center gap-3'>
                          <Switch
                            checked={rule.enabled}
                            onCheckedChange={(enabled) =>
                              patchGrant(index, { enabled })
                            }
                          />
                          <span className='truncate font-medium'>
                            {rule.name ||
                              (rule.type === 'recharge'
                                ? t('Recharge grant')
                                : t('Event grant'))}
                          </span>
                        </div>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          aria-label={t('Delete')}
                          onClick={() =>
                            setConfig((current) => ({
                              ...current,
                              grant_rules: current.grant_rules.filter(
                                (_, ruleIndex) => ruleIndex !== index
                              ),
                            }))
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <div className='grid items-start gap-4 p-4 sm:grid-cols-2'>
                        <LabeledField label={t('Rule name')}>
                          <Input
                            value={rule.name}
                            maxLength={80}
                            placeholder={
                              rule.type === 'recharge'
                                ? t('Example: Recharge bonus')
                                : t('Example: Spring Festival gift')
                            }
                            onChange={(event) =>
                              patchGrant(index, { name: event.target.value })
                            }
                          />
                        </LabeledField>
                        <LabeledField label={t('Grant type')}>
                          <Select
                            value={rule.type}
                            onValueChange={(type) =>
                              patchGrant(index, {
                                type: type as LotteryChanceGrantRuleType,
                                threshold:
                                  type === 'recharge'
                                    ? Math.max(rule.threshold, 1)
                                    : 0,
                                limit:
                                  type === 'recharge'
                                    ? rule.limit || 'cumulative'
                                    : undefined,
                                reclaim: type === 'event' ? true : undefined,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue>
                                {rule.type === 'recharge'
                                  ? t('Recharge threshold')
                                  : t('Festival or event')}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent alignItemWithTrigger={false}>
                              <SelectItem value='recharge'>
                                {t('Recharge threshold')}
                              </SelectItem>
                              <SelectItem value='event'>
                                {t('Festival or event')}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </LabeledField>
                        {rule.type === 'recharge' ? (
                          <LabeledField label={t('Grant frequency')}>
                            <Select
                              value={rule.limit || 'cumulative'}
                              onValueChange={(limit) =>
                                patchGrant(index, {
                                  limit: limit as LotteryRechargeGrantLimit,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue>
                                  {rechargeGrantLimitLabel(rule.limit, t)}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent alignItemWithTrigger={false}>
                                <SelectItem value='daily'>
                                  {t('Once per day')}
                                </SelectItem>
                                <SelectItem value='cumulative'>
                                  {t('Once per campaign')}
                                </SelectItem>
                                <SelectItem value='unlimited'>
                                  {t('Every qualifying recharge')}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </LabeledField>
                        ) : null}
                        {rule.type === 'event' ? (
                          <LabeledField label={t('After the event ends')}>
                            <div className='flex h-9 items-center justify-between rounded-md border px-3'>
                              <span className='text-muted-foreground text-xs'>
                                {t('Reclaim unused chances')}
                              </span>
                              <Switch
                                checked={rule.reclaim === true}
                                onCheckedChange={(reclaim) =>
                                  patchGrant(index, { reclaim })
                                }
                              />
                            </div>
                          </LabeledField>
                        ) : null}
                        {rule.type === 'recharge' ? (
                          <NumberField
                            label={t('Cumulative recharge threshold')}
                            value={rule.threshold}
                            min={0.01}
                            step={0.01}
                            suffix={t('Yuan')}
                            onChange={(threshold) =>
                              patchGrant(index, { threshold })
                            }
                          />
                        ) : null}
                        <NumberField
                          label={t('Granted chances')}
                          value={rule.chances}
                          min={1}
                          suffix={t('times')}
                          onChange={(chances) => patchGrant(index, { chances })}
                        />
                        <div className='h-[3.75rem] min-h-0 sm:col-span-2'>
                          <LabeledField label={t('Validity Period')}>
                            <CompactDateTimeRangePicker
                              start={timestampToDate(rule.start_at)}
                              end={timestampToDate(rule.end_at)}
                              onChange={({ start, end }) =>
                                patchGrant(index, {
                                  start_at: dateToTimestamp(start),
                                  end_at: dateToTimestamp(end),
                                })
                              }
                              className='w-full'
                            />
                          </LabeledField>
                        </div>
                      </div>
                    </section>
                  ))
                )}
              </TabsContent>

              <TabsContent value='prizes' className='space-y-4 p-5'>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <p className='text-muted-foreground text-sm'>
                    {t(
                      'Prize entries are no longer fixed. An amount of 0 represents no prize.'
                    )}
                  </p>
                  <div className='flex gap-2'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          prizes: [...current.prizes, createPrize()],
                        }))
                      }
                    >
                      <Plus />
                      {t('Add prize')}
                    </Button>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={config.prizes.some(
                        (prize) => prize.amount === 0
                      )}
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          prizes: [...current.prizes, createPrize(true)],
                        }))
                      }
                    >
                      <Plus />
                      {t('Add no-prize entry')}
                    </Button>
                  </div>
                </div>
                <div className='overflow-hidden rounded-md border'>
                  <div className='bg-muted/30 hidden grid-cols-[minmax(160px,1fr)_140px_140px_40px] gap-3 border-b px-4 py-2 text-xs font-medium sm:grid'>
                    <span>{t('Prize name')}</span>
                    <span>{t('Quota amount')}</span>
                    <span>{t('Probability')}</span>
                    <span />
                  </div>
                  <div className='divide-y'>
                    {config.prizes.map((prize, index) => (
                      <div
                        key={prize.type}
                        className='grid grid-cols-2 items-end gap-3 p-4 sm:grid-cols-[minmax(160px,1fr)_140px_140px_40px]'
                        data-testid='lottery-prize-setting-row'
                      >
                        <LabeledField label={t('Prize name')} hideOnDesktop>
                          <Input
                            value={prize.name}
                            maxLength={80}
                            placeholder={
                              prize.amount === 0
                                ? t('No prize')
                                : t('Prize name')
                            }
                            onChange={(event) =>
                              patchPrize(index, { name: event.target.value })
                            }
                          />
                        </LabeledField>
                        <NumberField
                          label={t('Quota amount')}
                          hideLabelOnDesktop
                          value={prize.amount}
                          min={0}
                          suffix={t('Yuan')}
                          onChange={(amount) => patchPrize(index, { amount })}
                        />
                        <NumberField
                          label={t('Probability')}
                          hideLabelOnDesktop
                          value={prize.probability}
                          min={0}
                          max={100}
                          suffix='%'
                          onChange={(probability) =>
                            patchPrize(index, { probability })
                          }
                        />
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          aria-label={t('Delete')}
                          disabled={config.prizes.length <= 2}
                          onClick={() =>
                            setConfig((current) => ({
                              ...current,
                              prizes: current.prizes.filter(
                                (_, prizeIndex) => prizeIndex !== index
                              ),
                            }))
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className='bg-muted/20 flex items-center justify-between border-t px-4 py-3 text-sm'>
                    <span className='text-muted-foreground'>
                      {t('Total probability')}
                    </span>
                    <strong
                      className={
                        probabilityTotal === 100
                          ? 'text-success tabular-nums'
                          : 'text-destructive tabular-nums'
                      }
                    >
                      {probabilityTotal}%
                    </strong>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        )}
        <DialogFooter className='bg-muted/30 mx-0 mb-0 shrink-0 rounded-b-xl border-t px-5 py-4'>
          <Button
            type='button'
            variant='outline'
            disabled={saving}
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='button'
            disabled={loading || saving}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className='animate-spin' /> : null}
            {saving ? t('Saving...') : t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LabeledField(props: {
  label: string
  children: React.ReactNode
  hideOnDesktop?: boolean
}) {
  return (
    <label className='min-w-0 space-y-1.5'>
      <span
        className={
          props.hideOnDesktop
            ? 'text-xs font-medium sm:sr-only'
            : 'text-xs font-medium'
        }
      >
        {props.label}
      </span>
      {props.children}
    </label>
  )
}

function NumberField(props: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  hideLabelOnDesktop?: boolean
}) {
  return (
    <LabeledField label={props.label} hideOnDesktop={props.hideLabelOnDesktop}>
      <div className='relative'>
        <Input
          type='number'
          value={props.value}
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          className={props.suffix ? 'pr-12' : undefined}
          onChange={(event) => props.onChange(Number(event.target.value) || 0)}
        />
        {props.suffix ? (
          <span className='text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs'>
            {props.suffix}
          </span>
        ) : null}
      </div>
    </LabeledField>
  )
}
