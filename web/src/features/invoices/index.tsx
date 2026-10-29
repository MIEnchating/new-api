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
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'

import { InvoiceApplicationForm } from './components/application-form'
import { InvoiceEmailTemplatesDialog } from './components/email-templates'
import { InvoiceNotificationDialog } from './components/notification-settings'
import { InvoiceRequestList } from './components/request-list'

export function InvoicesPage(props: { admin?: boolean }) {
  const { t } = useTranslation()
  const [applying, setApplying] = useState(false)
  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {props.admin ? t('Invoice management') : t('Invoice applications')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        {props.admin && <InvoiceEmailTemplatesDialog />}
        {props.admin && <InvoiceNotificationDialog />}
        {!props.admin && (
          <InvoiceApplicationForm
            open={applying}
            onOpenChange={setApplying}
            onSubmitted={() => setApplying(false)}
            trigger={
              <Button>
                <Plus aria-hidden='true' />
                {t('Request invoice')}
              </Button>
            }
          />
        )}
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <InvoiceRequestList admin={Boolean(props.admin)} />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
