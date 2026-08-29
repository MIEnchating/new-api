/* oxlint-disable react/iframe-missing-sandbox -- The iframe is explicitly sandboxed below. */
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
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ExternalLink, PanelTopOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Main } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { customMenuPagesQueryOptions } from '@/hooks/use-custom-menu-pages'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/pages/$pageId')({
  beforeLoad: async ({ context, params }) => {
    const role = useAuthStore.getState().auth.user?.role ?? 0
    const pages = await context.queryClient.ensureQueryData(
      customMenuPagesQueryOptions(role)
    )
    if (
      !pages.some(
        (page) => page.id === params.pageId && page.openMode === 'iframe'
      )
    ) {
      throw redirect({ to: '/404' })
    }
  },
  component: CustomMenuPageRoute,
})

function CustomMenuPageRoute() {
  const { t } = useTranslation()
  const { pageId } = Route.useParams()
  const role = useAuthStore((state) => state.auth.user?.role ?? 0)
  const pages = Route.useRouteContext().queryClient.getQueryData(
    customMenuPagesQueryOptions(role).queryKey
  )
  const page = pages?.find((entry) => entry.id === pageId)

  if (!page) return null

  return (
    <Main>
      <div className='border-border flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4'>
        <div className='flex min-w-0 items-center gap-2'>
          {page.icon ? (
            <img src={page.icon} alt='' className='size-4 shrink-0' />
          ) : (
            <PanelTopOpen className='text-muted-foreground size-4 shrink-0' />
          )}
          <h1 className='truncate text-sm font-medium'>{page.name}</h1>
        </div>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={t('Open in new tab')}
          title={t('Open in new tab')}
          render={
            <a href={page.url} target='_blank' rel='noreferrer noopener' />
          }
        >
          <ExternalLink />
        </Button>
      </div>
      <iframe
        src={page.url}
        title={page.name}
        className='min-h-0 flex-1 border-0'
        sandbox='allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts'
        referrerPolicy='no-referrer'
      />
    </Main>
  )
}
