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
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { requireServerSuccess } from '@/lib/server-error-message'

import { fetchTemplateTokenKeys } from '../api'

export function TemplateKeysCopyButton(props: { templateID: string }) {
  const { t } = useTranslation()
  return (
    <CopyButton
      variant='outline'
      size='sm'
      aria-label={t('Copy linked keys')}
      getValue={async () => {
        const result = requireServerSuccess(
          await fetchTemplateTokenKeys(props.templateID)
        )
        const keys = Object.values(result.data?.keys || {})
        if (keys.length === 0) toast.info(t('No linked keys'))
        return keys.join('\n')
      }}
    >
      {t('Copy linked keys')}
    </CopyButton>
  )
}
