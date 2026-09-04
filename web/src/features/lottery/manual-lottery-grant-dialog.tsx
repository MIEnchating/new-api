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
import { nanoid } from 'nanoid'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import { createManualLotteryGrant } from './api'
import type { LotteryChanceGrantRule } from './types'

interface ManualLotteryGrantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void | Promise<void>
  grantRules: LotteryChanceGrantRule[]
}

export function ManualLotteryGrantDialog(props: ManualLotteryGrantDialogProps) {
  const { t } = useTranslation()
  const [user, setUser] = useState('')
  const [chances, setChances] = useState('1')
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState<Date>()
  const [linkRecharge, setLinkRecharge] = useState(false)
  const [rechargeRuleId, setRechargeRuleId] = useState('')
  const [rechargeDate, setRechargeDate] = useState('')
  const [loading, setLoading] = useState(false)
  const requestId = useRef('')
  const dailyRechargeRules = useMemo(
    () =>
      props.grantRules.filter(
        (rule) =>
          rule.enabled && rule.type === 'recharge' && rule.limit === 'daily'
      ),
    [props.grantRules]
  )
  const dailyRechargeRuleItems = useMemo(
    () =>
      Object.fromEntries(
        dailyRechargeRules.map((rule) => [rule.id, rule.name])
      ),
    [dailyRechargeRules]
  )
  const selectedRechargeRule = dailyRechargeRules.find(
    (rule) => rule.id === rechargeRuleId
  )
  const currentDate = new Date()
  const maxRechargeDate = `${currentDate.getFullYear()}-${String(
    currentDate.getMonth() + 1
  ).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`

  const reset = () => {
    setUser('')
    setChances('1')
    setReason('')
    setExpiresAt(undefined)
    setLinkRecharge(false)
    setRechargeRuleId('')
    setRechargeDate('')
    requestId.current = ''
  }

  const handleOpenChange = (open: boolean) => {
    if (loading) return
    if (!open) reset()
    props.onOpenChange(open)
  }

  const handleSubmit = async () => {
    const normalizedUser = user.trim()
    const normalizedReason = reason.trim()
    const chanceCount = Number(chances)
    if (!normalizedUser) {
      toast.error(t('Please enter a username or user ID'))
      return
    }
    if (
      !Number.isInteger(chanceCount) ||
      chanceCount < 1 ||
      chanceCount > 1000
    ) {
      toast.error(t('Lottery chances must be between 1 and 1000'))
      return
    }
    if (normalizedReason.length < 2) {
      toast.error(t('Please enter a grant reason'))
      return
    }
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      toast.error(t('Expiration time must be in the future'))
      return
    }
    if (linkRecharge && !selectedRechargeRule) {
      toast.error(t('Please select a daily recharge rule'))
      return
    }
    if (linkRecharge && !rechargeDate) {
      toast.error(t('Please select the recharge date'))
      return
    }

    if (!requestId.current) requestId.current = nanoid(24)
    setLoading(true)
    try {
      const response = await createManualLotteryGrant({
        user: normalizedUser,
        chances: chanceCount,
        reason: normalizedReason,
        expires_at: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : 0,
        request_id: requestId.current,
        recharge_rule_id: linkRecharge ? rechargeRuleId : undefined,
        recharge_date: linkRecharge ? rechargeDate : undefined,
      })
      if (!response.success || !response.data) {
        toast.error(t(response.message || 'Failed to grant lottery chances'))
        return
      }
      toast.success(t('Lottery chances granted'))
      reset()
      props.onOpenChange(false)
      await props.onSuccess()
    } catch {
      toast.error(t('Failed to grant lottery chances'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={handleOpenChange}
      title={t('Grant lottery chances')}
      description={t(
        'Manually compensate a user when automatic lottery chances were not granted.'
      )}
      contentHeight='auto'
      contentClassName='sm:max-w-lg'
      footer={
        <>
          <Button
            variant='outline'
            disabled={loading}
            onClick={() => handleOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button disabled={loading} onClick={() => void handleSubmit()}>
            {loading ? t('Processing...') : t('Grant')}
          </Button>
        </>
      }
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor='lottery-manual-grant-user'>
            {t('Target user')}
          </FieldLabel>
          <Input
            id='lottery-manual-grant-user'
            value={user}
            onChange={(event) => setUser(event.target.value)}
            placeholder={t('Username or user ID')}
            disabled={loading}
            autoComplete='off'
          />
        </Field>
        <Field orientation='horizontal'>
          <Checkbox
            id='lottery-manual-grant-link-recharge'
            checked={linkRecharge}
            disabled={loading || dailyRechargeRules.length === 0}
            onCheckedChange={(checked) => {
              setLinkRecharge(checked)
              if (!checked) {
                setRechargeRuleId('')
                setRechargeDate('')
                setChances('1')
                return
              }
              setExpiresAt(undefined)
              const firstRule = dailyRechargeRules[0]
              if (firstRule) {
                setRechargeRuleId(firstRule.id)
                setChances(String(firstRule.chances))
              }
            }}
          />
          <FieldLabel
            htmlFor='lottery-manual-grant-link-recharge'
            className='font-normal'
          >
            {t('Link to a daily recharge reward')}
          </FieldLabel>
        </Field>
        {linkRecharge ? (
          <div className='grid gap-4 sm:grid-cols-2'>
            <Field>
              <FieldLabel htmlFor='lottery-manual-grant-recharge-rule'>
                {t('Recharge rule')}
              </FieldLabel>
              <Select
                items={dailyRechargeRuleItems}
                value={rechargeRuleId}
                onValueChange={(value) => {
                  const rule = dailyRechargeRules.find(
                    (candidate) => candidate.id === value
                  )
                  if (!rule) return
                  setRechargeRuleId(rule.id)
                  setChances(String(rule.chances))
                }}
              >
                <SelectTrigger
                  id='lottery-manual-grant-recharge-rule'
                  aria-label={t('Recharge rule')}
                >
                  <SelectValue>
                    {selectedRechargeRule?.name || t('Select a recharge rule')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {dailyRechargeRules.map((rule) => (
                      <SelectItem key={rule.id} value={rule.id}>
                        {rule.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor='lottery-manual-grant-recharge-date'>
                {t('Recharge date')}
              </FieldLabel>
              <Input
                id='lottery-manual-grant-recharge-date'
                type='date'
                value={rechargeDate}
                max={maxRechargeDate}
                disabled={loading}
                onChange={(event) => setRechargeDate(event.target.value)}
              />
            </Field>
          </div>
        ) : null}
        <Field>
          <FieldLabel htmlFor='lottery-manual-grant-chances'>
            {t('Number of chances')}
          </FieldLabel>
          <Input
            id='lottery-manual-grant-chances'
            type='number'
            min={1}
            max={1000}
            step={1}
            value={chances}
            onChange={(event) => setChances(event.target.value)}
            disabled={loading || linkRecharge}
          />
        </Field>
        {!linkRecharge ? (
          <Field>
            <FieldLabel>{t('Expiration time')}</FieldLabel>
            <DateTimePicker
              value={expiresAt}
              onChange={setExpiresAt}
              placeholder={t('No expiration')}
              disabled={loading}
            />
            <FieldDescription>
              {t('Leave blank for no expiration')}
            </FieldDescription>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor='lottery-manual-grant-reason'>
            {t('Grant reason')}
          </FieldLabel>
          <Textarea
            id='lottery-manual-grant-reason'
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('Enter the reason for this manual grant')}
            maxLength={200}
            disabled={loading}
          />
        </Field>
      </FieldGroup>
    </Dialog>
  )
}
