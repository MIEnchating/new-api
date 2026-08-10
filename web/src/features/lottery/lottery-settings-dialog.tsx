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
import { useEffect, useState } from 'react'
import {
  type Resolver,
  useFieldArray,
  useForm,
  useWatch,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

import { updateLotteryConfig } from './api'
import type { LotteryPrize } from './types'

const prizeSchema = z.object({
  type: z.enum(['quota_1', 'quota_5', 'quota_8', 'none']),
  amount: z.coerce.number().int().min(0).max(10000),
  probability: z.coerce.number().int().min(0).max(100),
})

const schema = z
  .object({ prizes: z.array(prizeSchema).length(4) })
  .superRefine((values, context) => {
    const total = values.prizes.reduce(
      (sum, prize) => sum + prize.probability,
      0
    )
    if (total !== 100) {
      context.addIssue({
        code: 'custom',
        path: ['prizes'],
        message: 'Total probability must equal 100%',
      })
    }
    values.prizes.forEach((prize, index) => {
      if (prize.type !== 'none' && prize.amount <= 0) {
        context.addIssue({
          code: 'custom',
          path: ['prizes', index, 'amount'],
          message: 'Prize amount must be greater than 0',
        })
      }
    })
  })

type Values = z.infer<typeof schema>

interface LotterySettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prizes: LotteryPrize[]
  onSaved: (prizes: LotteryPrize[]) => void
}

export function LotterySettingsDialog(props: LotterySettingsDialogProps) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const form = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues: { prizes: props.prizes },
  })
  const fields = useFieldArray({ control: form.control, name: 'prizes' })
  const prizes = useWatch({ control: form.control, name: 'prizes' })
  const probabilityTotal = prizes.reduce(
    (sum, prize) => sum + (Number(prize.probability) || 0),
    0
  )

  useEffect(() => {
    if (props.open) form.reset({ prizes: props.prizes })
  }, [form, props.open, props.prizes])

  const submit = form.handleSubmit(async (values) => {
    setSaving(true)
    try {
      const response = await updateLotteryConfig(values.prizes)
      if (!response.success || !response.data) {
        toast.error(t('Failed to save lottery settings'))
        return
      }
      props.onSaved(response.data.prizes)
      props.onOpenChange(false)
      toast.success(t('Lottery settings saved'))
    } catch {
      toast.error(t('Failed to save lottery settings'))
    } finally {
      setSaving(false)
    }
  })

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-2xl' initialFocus={false}>
        <DialogHeader>
          <DialogTitle>{t('Lottery settings')}</DialogTitle>
          <DialogDescription>
            {t(
              'Set the quota amount and probability for each prize. The total probability must be 100%.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className='space-y-3' onSubmit={submit}>
            <div className='hidden grid-cols-[minmax(0,1fr)_120px_120px] gap-3 px-1 text-xs font-medium sm:grid'>
              <span>{t('Prize')}</span>
              <span>{t('Amount')}</span>
              <span>{t('Probability')}</span>
            </div>
            {fields.fields.map((field, index) => {
              const isNoPrize = field.type === 'none'
              return (
                <div
                  key={field.id}
                  className='grid grid-cols-2 items-start gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_120px_120px]'
                  data-testid='lottery-prize-setting-row'
                >
                  <div className='col-span-2 text-sm font-medium sm:col-span-1 sm:pt-2'>
                    {isNoPrize
                      ? t('No prize')
                      : t('Prize {{index}}', { index: index + 1 })}
                  </div>
                  <FormField
                    control={form.control}
                    name={`prizes.${index}.amount`}
                    render={({ field: amountField }) => (
                      <FormItem>
                        <FormLabel className='sr-only'>{t('Amount')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={isNoPrize ? 0 : 1}
                            max={10000}
                            disabled={isNoPrize || saving}
                            {...amountField}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`prizes.${index}.probability`}
                    render={({ field: probabilityField }) => (
                      <FormItem>
                        <FormLabel className='sr-only'>
                          {t('Probability')}
                        </FormLabel>
                        <FormControl>
                          <div className='relative'>
                            <Input
                              type='number'
                              min={0}
                              max={100}
                              className='pr-8'
                              disabled={saving}
                              {...probabilityField}
                            />
                            <span className='text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2'>
                              %
                            </span>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )
            })}
            <div className='flex items-center justify-between border-t pt-3 text-sm'>
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
            {form.formState.errors.prizes?.root?.message ? (
              <p className='text-destructive text-xs'>
                {t(form.formState.errors.prizes.root.message)}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                disabled={saving}
                onClick={() => props.onOpenChange(false)}
              >
                {t('Cancel')}
              </Button>
              <Button type='submit' disabled={saving}>
                {saving ? t('Saving...') : t('Save')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
