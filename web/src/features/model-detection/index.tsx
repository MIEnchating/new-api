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
import { useQuery } from '@tanstack/react-query'
import { ScanSearch } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { getServerErrorMessage } from '@/lib/server-error-message'

import {
  getDetectionChallenges,
  runModelDetection,
  type ModelDetectionInput,
} from './api'
import { DetectionConfetti } from './confetti'
import { DetectionForm } from './detection-form'
import { DetectionHistory } from './history'
import {
  readDetectionHistory,
  saveDetectionHistory,
  type DetectionHistoryOutcome,
} from './history-storage'
import { ModelDetectionResults } from './results'
import { DetectionSamples } from './samples'
import { TokenizerProbePending, TokenizerProbeResult } from './tokenizer-result'

type DetectionRun =
  | { status: 'idle' }
  | { status: 'running'; tokenizer: boolean }
  | Exclude<DetectionHistoryOutcome, { status: 'success' }>
  | (Extract<DetectionHistoryOutcome, { status: 'success' }> & {
      target: Omit<ModelDetectionInput, 'api_key'>
      historyId: string
    })

export function ModelDetection(props: { userId: number }) {
  const { t } = useTranslation()
  const activeRequest = useRef<{
    controller: AbortController
    input: ModelDetectionInput
    probeOnly?: boolean
  } | null>(null)
  const [run, setRun] = useState<DetectionRun>({ status: 'idle' })
  const [probePending, setProbePending] = useState(false)
  const [probeError, setProbeError] = useState<string>()
  const [history, setHistory] = useState(() =>
    readDetectionHistory(props.userId)
  )
  const challenges = useQuery({
    queryKey: ['model-detection-challenges', props.userId],
    queryFn: ({ signal }) => getDetectionChallenges(signal),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 20 * 60_000,
  })

  useEffect(() => () => activeRequest.current?.controller.abort(), [])

  function remember(
    input: ModelDetectionInput,
    outcome: DetectionHistoryOutcome,
    replaceId?: string
  ) {
    const next = saveDetectionHistory(
      props.userId,
      input,
      outcome,
      history,
      replaceId
    )
    if (outcome.status === 'success') {
      const { api_key: _apiKey, ...target } = input
      setRun({ ...outcome, target, historyId: next[0].id })
    } else {
      setRun(outcome)
    }
    setHistory(next)
  }

  async function submit(input: ModelDetectionInput) {
    if (activeRequest.current) return
    const controller = new AbortController()
    activeRequest.current = { controller, input }
    setProbeError(undefined)
    setRun({ status: 'running', tokenizer: input.tokenizer })
    try {
      const result = await runModelDetection(
        input,
        challenges.data?.token,
        controller.signal
      )
      if (!controller.signal.aborted) {
        remember(input, {
          status: 'success',
          result:
            input.tokenizer && !result.tokenizer
              ? {
                  ...result,
                  tokenizer: { verdict: null, baseline_drift: false },
                }
              : result,
        })
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        remember(input, {
          status: 'error',
          message: getServerErrorMessage(error, t('Model detection failed.')),
        })
      }
    } finally {
      activeRequest.current = null
    }
  }

  async function retryTokenizer(input: ModelDetectionInput) {
    if (activeRequest.current || run.status !== 'success') return
    const controller = new AbortController()
    activeRequest.current = { controller, input, probeOnly: true }
    setProbePending(true)
    setProbeError(undefined)
    try {
      const result = await runModelDetection(
        {
          ...run.target,
          api_key: input.api_key,
          image: false,
          tokenizer: false,
          strict: false,
        },
        undefined,
        controller.signal,
        'tokenizer'
      )
      if (controller.signal.aborted) return
      if (result.tokenizer) {
        remember(
          { ...run.target, api_key: input.api_key },
          {
            status: 'success',
            result: { ...run.result, tokenizer: result.tokenizer },
          },
          run.historyId
        )
      } else {
        setProbeError(t('No tokenizer result was available.'))
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setProbeError(
          getServerErrorMessage(error, t('No tokenizer result was available.'))
        )
      }
    } finally {
      activeRequest.current = null
      setProbePending(false)
    }
  }

  function cancel() {
    const request = activeRequest.current
    if (!request || request.controller.signal.aborted) return
    request.controller.abort()
    if (!request.probeOnly) remember(request.input, { status: 'cancelled' })
  }

  const round = run.status === 'success' ? run.result.rounds?.[0] : undefined
  const topCandidate = round?.analysis?.results?.[0]
  const selectedModel =
    run.status === 'success' ? run.target.model.trim().toLowerCase() : ''
  const topModel = topCandidate?.model.trim().toLowerCase()
  // The reference library groups GPT-6.1 Sol under gpt-6-astra.
  const matchesSelectedModel =
    topModel === selectedModel ||
    topCandidate?.display_name.trim().toLowerCase() === selectedModel ||
    (selectedModel === 'gpt-6.1-sol' && topModel === 'gpt-6-astra')
  const modelMatched =
    run.status === 'success' &&
    !run.result.upstream_status &&
    round?.samples.length === 3 &&
    round.samples.every(({ state }) =>
      ['complete', 'truncated', 'capped'].includes(state)
    ) &&
    topCandidate?.probability != null &&
    topCandidate.probability > 0 &&
    matchesSelectedModel
  let runMessage: ReactNode = null
  switch (run.status) {
    case 'running':
      runMessage = (
        <LoadingState inline size='sm' message={t('Detection in progress…')} />
      )
      break
    case 'error':
      runMessage = <ErrorState title={run.message} className='min-h-28' />
      break
    case 'cancelled':
      runMessage = (
        <p className='text-muted-foreground text-sm'>
          {t('Detection cancelled.')}
        </p>
      )
      break
  }

  return (
    <div className='relative flex min-h-0 min-w-0 flex-1 flex-col'>
      {run.status === 'success' && modelMatched && (
        <DetectionConfetti key={run.historyId} />
      )}
      <header className='shrink-0'>
        <div className='mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-6'>
          <div className='flex min-w-0 items-center gap-3'>
            <IconBadge tone='primary' size='title'>
              <ScanSearch aria-hidden='true' />
            </IconBadge>
            <h1 className='text-lg font-semibold sm:text-xl'>
              {t('Model Detection')}
            </h1>
          </div>
          <DetectionHistory records={history} />
        </div>
      </header>
      <DetectionForm
        onSubmit={submit}
        onCancel={cancel}
        onRefreshSamples={() => {
          setRun({ status: 'idle' })
          void challenges.refetch()
        }}
        samplesLoading={challenges.isFetching}
        samplesReady={Boolean(
          challenges.data && !challenges.isFetching && !challenges.isError
        )}
        tokenizerRetry={
          run.status === 'success' && run.result.tokenizer
            ? { target: run.target, onSubmit: retryTokenizer }
            : undefined
        }
        report={
          (runMessage || run.status === 'success') && (
            <section aria-labelledby='model-detection-results'>
              <Card size='sm' className='gap-2'>
                <CardHeader>
                  <CardTitle className='flex flex-wrap items-center gap-2'>
                    <h2 id='model-detection-results'>
                      {t('Detection results')}
                    </h2>
                    {modelMatched && (
                      <StatusBadge
                        label={t('Model matched')}
                        variant='success'
                        copyable={false}
                      />
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent aria-live='polite'>
                  {run.status === 'success' ? (
                    <ModelDetectionResults result={run.result} />
                  ) : (
                    runMessage
                  )}
                </CardContent>
              </Card>
            </section>
          )
        }
        samples={(retryProbe) => (
          <>
            {challenges.error && (
              <Alert variant='destructive'>
                <AlertDescription>
                  {getServerErrorMessage(
                    challenges.error,
                    t('Failed to prepare samples.')
                  )}
                </AlertDescription>
              </Alert>
            )}
            <DetectionSamples
              challenges={round?.challenges ?? challenges.data?.challenges}
              samples={round?.samples}
              sampling={run.status === 'running'}
              preparing={challenges.isFetching}
              tokenizer={
                run.status === 'success' && run.result.tokenizer ? (
                  <TokenizerProbeResult
                    report={run.result.tokenizer}
                    selectedModel={run.target.model}
                    onRetry={retryProbe}
                    pending={probePending}
                    error={probeError}
                  />
                ) : undefined
              }
            />
            {run.status === 'running' && run.tokenizer && (
              <TokenizerProbePending />
            )}
          </>
        )}
      />
    </div>
  )
}
