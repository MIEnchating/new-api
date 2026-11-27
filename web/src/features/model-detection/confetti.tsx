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
import type { Options } from 'canvas-confetti'
import { useEffect } from 'react'

import { useMediaQuery } from '@/hooks/use-media-query'

const colors = [
  '#2563eb',
  '#00a889',
  '#f59e0b',
  '#f43f5e',
  '#8b5cf6',
  '#22b6e6',
]

export function DetectionConfetti() {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  useEffect(() => {
    if (reduceMotion) return

    const playback = new AbortController()
    let reset: (() => void) | undefined
    let secondBurst: number | undefined

    void import('canvas-confetti')
      .then(({ default: confetti }) => {
        if (playback.signal.aborted) return

        const fire = confetti.create(undefined, {
          resize: true,
          disableForReducedMotion: true,
        })
        reset = fire.reset
        const compact = window.innerWidth < 640
        const options: Options = {
          colors,
          shapes: ['square', 'star'],
          spread: 58,
          gravity: 1.14,
          ticks: 145,
          scalar: compact ? 1.1 : 1.45,
          zIndex: 60,
        }

        const first = {
          ...options,
          particleCount: compact ? 38 : 64,
          startVelocity: compact ? 42 : 61,
        }
        void fire({ ...first, angle: 65, origin: { x: 0.02, y: 0.73 } })
        void fire({ ...first, angle: 115, origin: { x: 0.98, y: 0.73 } })

        secondBurst = window.setTimeout(() => {
          const second = {
            ...options,
            particleCount: compact ? 25 : 42,
            startVelocity: compact ? 35 : 48,
          }
          void fire({ ...second, angle: 53, origin: { x: 0.06, y: 0.7 } })
          void fire({ ...second, angle: 127, origin: { x: 0.94, y: 0.7 } })
        }, 260)
      })
      .catch(() => {
        // A failed animation chunk should never interrupt the result.
      })

    return () => {
      playback.abort()
      window.clearTimeout(secondBurst)
      reset?.()
    }
  }, [reduceMotion])

  return null
}
