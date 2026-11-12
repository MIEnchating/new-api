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
import { Check, Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

interface CopyButtonProps {
  disabled?: boolean
  value?: string
  getValue?: () => Promise<string>
  children?: ReactNode
  className?: string
  iconClassName?: string
  variant?: 'ghost' | 'outline' | 'default' | 'secondary' | 'destructive'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  tooltip?: string
  successTooltip?: string
  'aria-label'?: string
}

export function CopyButton({
  value,
  getValue,
  disabled,
  children,
  className,
  iconClassName,
  variant = 'ghost',
  size = 'icon',
  tooltip,
  successTooltip,
  'aria-label': ariaLabel,
}: CopyButtonProps) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })
  const [loading, setLoading] = useState(false)
  const isCopied =
    copiedText !== null && (getValue ? true : copiedText === value)
  const copy = async () => {
    if (loading) return
    setLoading(true)
    try {
      const text = getValue ? await getValue() : value
      if (text === undefined || (getValue && text === '')) return
      const success = await copyToClipboard(text)
      if (!success) {
        handleServerError(new Error(t('Failed to copy to clipboard')))
      }
    } catch (error) {
      handleServerError(error, t('Failed to copy to clipboard'))
    } finally {
      setLoading(false)
    }
  }
  const resolvedTooltip = tooltip ?? t('Copy to clipboard')
  const resolvedSuccessTooltip = successTooltip ?? t('Copied!')
  const resolvedAriaLabel = ariaLabel ?? resolvedTooltip
  const copiedAriaLabel = t('Copied')

  const button = (
    <Button
      type='button'
      disabled={disabled || loading}
      aria-busy={loading}
      variant={variant}
      size={size}
      className={cn('shrink-0', className)}
      onClick={copy}
      aria-label={isCopied ? copiedAriaLabel : resolvedAriaLabel}
    >
      {isCopied ? (
        <Check className={cn('text-success', iconClassName)} />
      ) : (
        <Copy className={cn(iconClassName)} />
      )}
      {children}
    </Button>
  )

  if (tooltip || successTooltip) {
    return (
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent>
          <p>{isCopied ? resolvedSuccessTooltip : resolvedTooltip}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return button
}
