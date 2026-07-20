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
  Search,
  Loader2,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  TicketPercent,
  UserRoundCheck,
  ShieldCheck,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CompactDateTimeRangePicker } from '@/components/compact-date-time-range-picker'
import { Dialog } from '@/components/dialog'
import { MultiSelect } from '@/components/multi-select'
import { StatusBadge } from '@/components/status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { formatCurrencyFromUSD } from '@/lib/currency'
import { formatQuota } from '@/lib/format'

import { useBillingHistory } from '../../hooks/use-billing-history'
import {
  getStatusConfig,
  getPaymentMethodName,
  formatTimestamp,
} from '../../lib/billing'
import type { BillingRecordType } from '../../types'

interface BillingHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const BILLING_SKELETON_IDS = ['one', 'two', 'three', 'four', 'five']

export function BillingHistoryDialog({
  open,
  onOpenChange,
}: BillingHistoryDialogProps) {
  const { t } = useTranslation()
  const {
    records,
    total,
    page,
    pageSize,
    keyword,
    userKeyword,
    types,
    startTime,
    endTime,
    loading,
    completing,
    isAdmin,
    handlePageChange,
    handlePageSizeChange,
    handleKeywordChange,
    handleUserKeywordChange,
    handleTypesChange,
    handleStartTimeChange,
    handleEndTimeChange,
    handleApplyFilters,
    handleCompleteOrder,
  } = useBillingHistory({ enabled: open })

  const [confirmTradeNo, setConfirmTradeNo] = useState<string | null>(null)
  const { copyToClipboard, copiedText } = useCopyToClipboard({ notify: false })

  const totalPages = Math.ceil(total / pageSize)
  const typeOptions = useMemo(
    () => [
      { value: 'online_topup', label: t('Online Top-up') },
      { value: 'redemption', label: t('Redemption Code') },
      { value: 'affiliate_transfer', label: t('Affiliate Transfer') },
      { value: 'admin_adjustment', label: t('Admin Adjustment') },
    ],
    [t]
  )
  const getTypeConfig = (type: BillingRecordType) => {
    switch (type) {
      case 'redemption':
        return {
          label: t('Redemption Code'),
          icon: TicketPercent,
          variant: 'purple' as const,
        }
      case 'affiliate_transfer':
        return {
          label: t('Affiliate Transfer'),
          icon: UserRoundCheck,
          variant: 'info' as const,
        }
      case 'admin_adjustment':
        return {
          label: t('Admin Adjustment'),
          icon: ShieldCheck,
          variant: 'warning' as const,
        }
      default:
        return {
          label: t('Online Top-up'),
          icon: CreditCard,
          variant: 'success' as const,
        }
    }
  }

  const handleConfirmComplete = async () => {
    if (confirmTradeNo) {
      const success = await handleCompleteOrder(confirmTradeNo)
      if (success) {
        setConfirmTradeNo(null)
      }
    }
  }

  const handleFilterKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleApplyFilters()
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('Billing History')}
        description={t(
          'View balance changes from top-ups, redemptions, affiliate transfers, and administrator adjustments'
        )}
        contentClassName='flex max-h-[calc(100dvh-2rem)] flex-col max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:p-4 sm:max-w-4xl'
        contentHeight='auto'
        bodyClassName='space-y-3'
      >
        <div className='min-h-0 space-y-3'>
          {/* Search and Filter Bar */}
          <div className='grid gap-2 sm:grid-cols-2'>
            <div className='relative flex-1'>
              <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
              <Input
                placeholder={t('Search by order number...')}
                value={keyword}
                onChange={(e) => handleKeywordChange(e.target.value)}
                onKeyDown={handleFilterKeyDown}
                className='h-9 pl-10'
              />
            </div>
            {isAdmin && (
              <div className='relative flex-1'>
                <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
                <Input
                  placeholder={t('Search users by ID or name...')}
                  value={userKeyword}
                  onChange={(e) => handleUserKeywordChange(e.target.value)}
                  onKeyDown={handleFilterKeyDown}
                  className='h-9 pl-10'
                />
              </div>
            )}
          </div>

          <div className='bg-muted/20 flex flex-col gap-3 rounded-md border p-3'>
            <div className='flex min-w-0 flex-col gap-1.5'>
              <Label className='text-muted-foreground text-xs'>
                {t('Type')}
              </Label>
              <MultiSelect
                options={typeOptions}
                selected={types}
                onChange={handleTypesChange}
                placeholder={t('All transaction types')}
                className='min-h-9 md:h-9 md:flex-nowrap md:overflow-hidden md:[&_[data-slot=combobox-chip-input]]:min-w-0'
              />
            </div>

            <div className='grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end'>
              <div className='flex min-w-0 flex-col gap-1.5'>
                <Label className='text-muted-foreground text-xs'>
                  {t('Date Range')}
                </Label>
                <CompactDateTimeRangePicker
                  start={startTime}
                  end={endTime}
                  className='h-9'
                  onChange={({ start, end }) => {
                    handleStartTimeChange(start)
                    handleEndTimeChange(end)
                  }}
                />
              </div>
              <Button
                type='button'
                onClick={handleApplyFilters}
                disabled={loading}
                className='h-9 w-full gap-1.5 sm:w-auto sm:min-w-24'
              >
                {loading ? (
                  <Loader2 className='size-4 animate-spin' />
                ) : (
                  <Search className='size-4' />
                )}
                {t('Search')}
              </Button>
            </div>
          </div>

          {/* Records List */}
          <div>
            {loading && (
              <div className='space-y-3'>
                {BILLING_SKELETON_IDS.map((id) => (
                  <div key={id} className='rounded-lg border p-3 sm:p-4'>
                    <div className='flex items-start justify-between'>
                      <div className='flex-1 space-y-2'>
                        <Skeleton className='h-4 w-48' />
                        <Skeleton className='h-3 w-32' />
                      </div>
                      <Skeleton className='h-5 w-16' />
                    </div>
                    <div className='mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4'>
                      <Skeleton className='h-3 w-full' />
                      <Skeleton className='h-3 w-full' />
                      <Skeleton className='h-3 w-full' />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!loading && records.length === 0 && (
              <div className='text-muted-foreground flex min-h-40 flex-col items-center justify-center py-10 text-center'>
                <p className='text-sm font-medium'>
                  {t('No billing records found')}
                </p>
                <p className='mt-1 text-xs'>
                  {keyword
                    ? t('Try adjusting your search')
                    : t('Your transaction history will appear here')}
                </p>
              </div>
            )}
            {!loading && records.length > 0 && (
              <div className='space-y-3'>
                {records.map((record) => {
                  const statusConfig = getStatusConfig(record.status)
                  const typeConfig = getTypeConfig(record.type)
                  const TypeIcon = typeConfig.icon
                  return (
                    <div
                      key={record.id}
                      className='rounded-lg border p-3 sm:p-4'
                    >
                      {/* Header Row */}
                      <div className='flex items-start justify-between gap-2'>
                        <div className='flex-1 space-y-1'>
                          <div className='flex min-w-0 items-center gap-2'>
                            <StatusBadge
                              variant={typeConfig.variant}
                              size='sm'
                              copyable={false}
                            >
                              <TypeIcon className='size-3' />
                              {typeConfig.label}
                            </StatusBadge>
                            {isAdmin && record.user_id != null && (
                              <StatusBadge
                                label={`${record.username || record.display_name || t('User')} (${record.user_id})`}
                                variant='neutral'
                                size='sm'
                                copyText={String(record.user_id)}
                              />
                            )}
                          </div>
                          <div className='text-muted-foreground text-xs'>
                            {formatTimestamp(record.created_at)}
                          </div>
                        </div>
                        {record.type === 'online_topup' && (
                          <StatusBadge
                            label={statusConfig.label}
                            variant={statusConfig.variant}
                            showDot
                            copyable={false}
                          />
                        )}
                      </div>

                      {record.reference && (
                        <div className='mt-2 flex min-w-0 items-center gap-1.5'>
                          <code className='text-muted-foreground min-w-0 truncate font-mono text-xs'>
                            {record.reference}
                          </code>
                          <Button
                            variant='ghost'
                            size='sm'
                            className='h-5 w-5 shrink-0 p-0'
                            onClick={() => copyToClipboard(record.reference)}
                          >
                            {copiedText === record.reference ? (
                              <Check className='h-3 w-3' />
                            ) : (
                              <Copy className='h-3 w-3' />
                            )}
                          </Button>
                        </div>
                      )}

                      {/* Details Grid */}
                      <div className='mt-3 grid grid-cols-2 gap-3 sm:mt-4 sm:grid-cols-3 sm:gap-4'>
                        <div className='space-y-1'>
                          <Label className='text-muted-foreground text-xs'>
                            {t('Payment Method')}
                          </Label>
                          <div className='text-sm font-medium'>
                            {record.type === 'online_topup'
                              ? getPaymentMethodName(record.payment_method, t)
                              : typeConfig.label}
                          </div>
                        </div>
                        <div className='space-y-1'>
                          <Label className='text-muted-foreground text-xs'>
                            {t('Quota Change')}
                          </Label>
                          <div
                            className={`text-sm font-semibold ${record.quota < 0 ? 'text-red-600' : 'text-green-600'}`}
                          >
                            {record.quota > 0 ? '+' : ''}
                            {formatQuota(record.quota)}
                          </div>
                        </div>
                        {record.type === 'online_topup' && (
                          <div className='space-y-1'>
                            <Label className='text-muted-foreground text-xs'>
                              {t('Payment')}
                            </Label>
                            <div className='text-sm font-semibold'>
                              {formatCurrencyFromUSD(record.money, {
                                digitsLarge: 2,
                                digitsSmall: 2,
                                abbreviate: false,
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Admin Actions */}
                      {isAdmin &&
                        record.type === 'online_topup' &&
                        record.status === 'pending' && (
                          <div className='mt-4 flex justify-end'>
                            <Button
                              size='sm'
                              variant='outline'
                              onClick={() =>
                                setConfirmTradeNo(record.reference)
                              }
                              disabled={completing}
                            >
                              {t('Complete Order')}
                            </Button>
                          </div>
                        )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Pagination */}
          {!loading && (
            <div className='flex flex-col items-center gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between'>
              <div className='text-muted-foreground text-xs sm:text-sm'>
                {t('Showing')} {total === 0 ? 0 : (page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, total)} {t('of')} {total}
              </div>
              <div className='flex flex-wrap items-center justify-center gap-2'>
                <div className='flex items-center gap-2'>
                  <Label className='text-muted-foreground text-xs whitespace-nowrap'>
                    {t('Rows per page')}
                  </Label>
                  <Select
                    items={[
                      { value: '10', label: '10' },
                      { value: '20', label: '20' },
                      { value: '50', label: '50' },
                      { value: '100', label: '100' },
                    ]}
                    value={pageSize.toString()}
                    onValueChange={(value) =>
                      value !== null &&
                      handlePageSizeChange(Number.parseInt(value))
                    }
                  >
                    <SelectTrigger className='h-8 w-[4.75rem]'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        <SelectItem value='10'>10</SelectItem>
                        <SelectItem value='20'>20</SelectItem>
                        <SelectItem value='50'>50</SelectItem>
                        <SelectItem value='100'>100</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1}
                  className='h-8 w-8 p-0'
                >
                  <ChevronLeft className='h-4 w-4' />
                </Button>
                <div className='text-muted-foreground flex items-center gap-1 text-sm'>
                  <span className='font-medium'>{page}</span>
                  <span>/</span>
                  <span>{Math.max(totalPages, 1)}</span>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => handlePageChange(page + 1)}
                  disabled={totalPages === 0 || page >= totalPages}
                  className='h-8 w-8 p-0'
                >
                  <ChevronRight className='h-4 w-4' />
                </Button>
              </div>
            </div>
          )}
        </div>
      </Dialog>

      {/* Confirm Complete Order Dialog */}
      <AlertDialog
        open={!!confirmTradeNo}
        onOpenChange={(open) => !open && setConfirmTradeNo(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Complete Order')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Are you sure you want to manually complete this order? The user will be credited with the corresponding quota.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={completing}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmComplete}
              disabled={completing}
            >
              {completing ? t('Processing...') : t('Confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
