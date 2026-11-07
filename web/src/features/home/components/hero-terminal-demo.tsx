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
import { Code2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const API_DEMOS = [
  {
    id: 'openai',
    label: 'OpenAI',
    endpoint: '/v1/chat/completions',
    headers: ['Authorization: Bearer $API_KEY'],
    body: `{
    "model": "your-model",
    "messages": [{ "role": "user", "content": "Hello" }]
  }`,
  },
  {
    id: 'responses',
    label: 'Responses',
    endpoint: '/v1/responses',
    headers: ['Authorization: Bearer $API_KEY'],
    body: `{
    "model": "your-model",
    "input": "Hello"
  }`,
  },
  {
    id: 'claude',
    label: 'Claude',
    endpoint: '/v1/messages',
    headers: ['x-api-key: $API_KEY', 'anthropic-version: 2023-06-01'],
    body: `{
    "model": "your-model",
    "max_tokens": 1024,
    "messages": [{ "role": "user", "content": "Hello" }]
  }`,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    endpoint: '/v1beta/models/your-model:generateContent',
    headers: ['x-goog-api-key: $API_KEY'],
    body: `{
    "contents": [{
      "parts": [{ "text": "Hello" }]
    }]
  }`,
  },
]

export function HeroTerminalDemo(props: { className?: string }) {
  const { t } = useTranslation()
  const [active, setActive] = useState(API_DEMOS[0].id)
  const origin =
    typeof window === 'undefined'
      ? 'https://your-gateway.example'
      : window.location.origin

  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm',
        props.className
      )}
    >
      <div className='border-border/60 flex items-center gap-2 border-b px-5 py-4 text-xs font-medium'>
        <Code2 className='text-primary size-4' aria-hidden='true' />
        {t('API request example')}
      </div>
      <Tabs
        value={active}
        onValueChange={(value) => setActive(String(value))}
        className='gap-0'
      >
        <div className='border-border/60 overflow-x-auto border-b px-3 py-2'>
          <TabsList
            aria-label={t('API protocol')}
            variant='line'
            className='w-full min-w-max'
          >
            {API_DEMOS.map((demo) => (
              <TabsTrigger
                key={demo.id}
                value={demo.id}
                className='px-3 text-xs'
              >
                {demo.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {API_DEMOS.map((demo) => {
          const request = [
            `curl "${origin}${demo.endpoint}" \\`,
            ...demo.headers.map((header) => `  -H "${header}" \\`),
            '  -H "Content-Type: application/json" \\',
            `  -d '${demo.body}'`,
          ].join('\n')
          return (
            <TabsContent key={demo.id} value={demo.id} className='min-w-0'>
              <div className='flex items-center justify-between gap-3 px-5 pt-4'>
                <span className='bg-primary/8 text-primary rounded-md px-2 py-1 font-mono text-xs font-medium'>
                  POST
                </span>
                <CopyButton value={request} aria-label={t('Copy example')} />
              </div>
              <pre
                className='text-foreground/85 min-h-72 overflow-x-auto px-5 pt-3 pb-6 font-mono text-xs leading-7 sm:text-[13px]'
                tabIndex={0}
                aria-label={t('API request example')}
              >
                <code>{request}</code>
              </pre>
            </TabsContent>
          )
        })}
      </Tabs>
      <p className='border-border/60 bg-muted/20 text-muted-foreground border-t px-5 py-4 text-xs leading-6'>
        {t(
          'Replace $API_KEY and your-model with your API key and an available model.'
        )}
      </p>
    </div>
  )
}
