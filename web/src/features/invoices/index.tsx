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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { InvoiceApplicationForm } from './components/application-form'
import { InvoiceRequestList } from './components/request-list'

export function InvoicesButton(props: { admin?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('apply')
  return (
    <>
      <Button variant='outline' onClick={() => setOpen(true)}>
        {t('Invoice applications')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Invoice applications')}
        contentClassName='max-h-[calc(100dvh-2rem)] max-sm:w-[calc(100vw-1.5rem)] sm:max-w-3xl'
      >
        {open &&
          (props.admin ? (
            <InvoiceRequestList admin />
          ) : (
            <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
              <TabsList>
                <TabsTrigger value='apply'>{t('Request invoice')}</TabsTrigger>
                <TabsTrigger value='history'>
                  {t('Application history')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value='apply'>
                <InvoiceApplicationForm onSubmitted={() => setTab('history')} />
              </TabsContent>
              <TabsContent value='history'>
                <InvoiceRequestList admin={false} />
              </TabsContent>
            </Tabs>
          ))}
      </Dialog>
    </>
  )
}
