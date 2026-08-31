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
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { createManualLotteryGrant } from './api'

interface ManualLotteryGrantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void | Promise<void>
}

export function ManualLotteryGrantDialog(props: ManualLotteryGrantDialogProps) {
  const { t } = useTranslation()
  const [user, setUser] = useState('')
  const [chances, setChances] = useState('1')
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState<Date>()
  const [loading, setLoading] = useState(false)
  const requestId = useRef('')

  const reset = () => {
    setUser('')
    setChances('1')
    setReason('')
    setExpiresAt(undefined)
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

    if (!requestId.current) requestId.current = nanoid(24)
    setLoading(true)
    try {
      const response = await createManualLotteryGrant({
        user: normalizedUser,
        chances: chanceCount,
        reason: normalizedReason,
        expires_at: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : 0,
        request_id: requestId.current,
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
      bodyClassName='space-y-4'
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
      <div className='space-y-2'>
        <Label htmlFor='lottery-manual-grant-user'>{t('Target user')}</Label>
        <Input
          id='lottery-manual-grant-user'
          value={user}
          onChange={(event) => setUser(event.target.value)}
          placeholder={t('Username or user ID')}
          disabled={loading}
          autoComplete='off'
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='lottery-manual-grant-chances'>
          {t('Number of chances')}
        </Label>
        <Input
          id='lottery-manual-grant-chances'
          type='number'
          min={1}
          max={1000}
          step={1}
          value={chances}
          onChange={(event) => setChances(event.target.value)}
          disabled={loading}
        />
      </div>
      <div className='space-y-2'>
        <Label>{t('Expiration time')}</Label>
        <DateTimePicker
          value={expiresAt}
          onChange={setExpiresAt}
          placeholder={t('No expiration')}
          disabled={loading}
        />
        <p className='text-muted-foreground text-xs'>
          {t('Leave blank for no expiration')}
        </p>
      </div>
      <div className='space-y-2'>
        <Label htmlFor='lottery-manual-grant-reason'>{t('Grant reason')}</Label>
        <Textarea
          id='lottery-manual-grant-reason'
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('Enter the reason for this manual grant')}
          maxLength={200}
          disabled={loading}
        />
      </div>
    </Dialog>
  )
}
