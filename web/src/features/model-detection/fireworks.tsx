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
import { motion, useReducedMotion } from 'motion/react'

import { cn } from '@/lib/utils'

const bursts = [
  { left: '50%', top: '47%', radius: 96, delay: 0, color: 'bg-chart-1' },
  { left: '25%', top: '67%', radius: 76, delay: 0.18, color: 'bg-warning' },
  { left: '75%', top: '56%', radius: 88, delay: 0.34, color: 'bg-chart-4' },
  { left: '38%', top: '55%', radius: 72, delay: 0.61, color: 'bg-chart-2' },
  { left: '63%', top: '65%', radius: 78, delay: 0.78, color: 'bg-chart-5' },
]

const sparks = Array.from({ length: 16 }, (_, index) => ({
  angle: (index * Math.PI) / 8,
  distance: index % 2 === 0 ? 1 : 0.68,
}))

export function DetectionFireworks() {
  const reduceMotion = useReducedMotion()
  if (reduceMotion) return null

  return (
    <motion.div
      aria-hidden='true'
      data-slot='detection-fireworks'
      className='pointer-events-none absolute inset-x-0 top-0 z-20 h-[min(45vh,20rem)] overflow-hidden motion-reduce:hidden'
      initial='waiting'
      animate='burst'
    >
      {bursts.map(({ left, top, radius, delay, color }) => (
        <div key={left} className='absolute' style={{ left, top }}>
          {sparks.map(({ angle, distance }) => {
            const x = Math.cos(angle + delay) * radius * distance
            const y = Math.sin(angle + delay) * radius * distance
            return (
              <motion.span
                key={angle}
                className={cn('absolute size-2 rounded-full', color)}
                variants={{
                  waiting: { opacity: 0 },
                  burst: {
                    opacity: [0, 1, 0.8, 0],
                    scale: [0.25, 1.1, 0.4],
                    x: [0, x * 0.84, x],
                    y: [0, y * 0.84, y + 20],
                    transition: { delay, duration: 1.15, ease: 'easeOut' },
                  },
                }}
              />
            )
          })}
        </div>
      ))}
    </motion.div>
  )
}
