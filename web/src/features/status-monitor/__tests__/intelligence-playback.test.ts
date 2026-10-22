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
import { runInNewContext } from 'node:vm'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { installIntelligencePlayback } from '../intelligence-playback'

let element: HTMLIFrameElement
let preview: Window & typeof globalThis

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  element = document.createElement('iframe')
  document.body.append(element)
  preview = element.contentWindow as Window & typeof globalThis
  vi.spyOn(preview.performance, 'now').mockImplementation(() => Date.now())
  vi.spyOn(preview, 'requestAnimationFrame').mockImplementation((callback) =>
    window.setTimeout(() => callback(Date.now()), 16)
  )
  vi.spyOn(preview, 'cancelAnimationFrame').mockImplementation((id) =>
    window.clearTimeout(id)
  )
  vi.spyOn(preview, 'setTimeout').mockImplementation(((
    handler: TimerHandler,
    delay?: number,
    ...args: unknown[]
  ) => window.setTimeout(handler, delay, ...args)) as typeof preview.setTimeout)
  vi.spyOn(preview, 'clearTimeout').mockImplementation((id) =>
    window.clearTimeout(id)
  )
  runInNewContext(`(${installIntelligencePlayback.toString()})()`, {
    window: preview,
    document: preview.document,
    performance: preview.performance,
    MutationObserver: preview.MutationObserver,
  })
})

afterEach(() => {
  element.remove()
  vi.useRealTimers()
})

function setPlayback(active: boolean, source: Window = preview.parent) {
  preview.dispatchEvent(
    new MessageEvent('message', {
      source,
      data: { type: 'new-api:intelligence-playback', active },
    })
  )
}

it('freezes animation time and timers while paused, then resumes without a callback backlog', () => {
  const frames: number[] = []
  const tick: FrameRequestCallback = (time) => {
    frames.push(time)
    preview.requestAnimationFrame(tick)
  }
  const timeout = vi.fn()
  const interval = vi.fn()
  preview.requestAnimationFrame(tick)
  preview.setTimeout(timeout, 60)
  preview.setInterval(interval, 20)
  vi.advanceTimersByTime(100)
  expect(frames).toEqual([])
  expect(interval).not.toHaveBeenCalled()
  setPlayback(true)
  vi.advanceTimersByTime(20)
  expect(frames).toEqual([16])
  expect(interval).toHaveBeenCalledTimes(1)
  setPlayback(false)
  vi.advanceTimersByTime(1000)
  expect(preview.performance.now()).toBe(20)
  expect(frames).toEqual([16])
  expect(interval).toHaveBeenCalledTimes(1)
  expect(timeout).not.toHaveBeenCalled()
  setPlayback(true)
  setPlayback(true)
  vi.advanceTimersByTime(39)
  expect(timeout).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(timeout).toHaveBeenCalledTimes(1)
  expect(interval).toHaveBeenCalledTimes(3)
  expect(frames).toEqual([16, 36, 52])
})

it('ignores non-parent commands and honors cancellation across a pause', () => {
  const cancelled = vi.fn()
  const allowed = vi.fn()
  const frame = preview.requestAnimationFrame(cancelled)
  const timeout = preview.setTimeout(cancelled, 20)
  const interval = preview.setInterval(cancelled, 20)
  preview.cancelAnimationFrame(frame)
  // Native timers share cancellation handles, including across timer types.
  preview.clearInterval(timeout)
  preview.clearTimeout(interval)
  preview.setTimeout(allowed, 20)
  setPlayback(true, preview)
  vi.advanceTimersByTime(100)
  expect(allowed).not.toHaveBeenCalled()
  setPlayback(true)
  vi.advanceTimersByTime(20)
  expect(allowed).toHaveBeenCalledTimes(1)
  expect(cancelled).not.toHaveBeenCalled()
})

it('pauses CSS and SVG animation timelines without resuming animations already paused by their author', () => {
  const running = {
    playState: 'running',
    pause() {
      this.playState = 'paused'
    },
    play() {
      this.playState = 'running'
    },
  }
  const authorPaused = { playState: 'paused', play: vi.fn() }
  Object.defineProperty(preview.document, 'getAnimations', {
    value: () => [running, authorPaused],
    configurable: true,
  })
  const svg = preview.document.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg'
  )
  let svgPaused = false
  Object.assign(svg, {
    animationsPaused: () => svgPaused,
    pauseAnimations: () => {
      svgPaused = true
    },
    unpauseAnimations: () => {
      svgPaused = false
    },
  })
  preview.document.body.append(svg)
  preview.document.dispatchEvent(new Event('DOMContentLoaded'))
  expect(running.playState).toBe('paused')
  expect(svgPaused).toBe(true)
  setPlayback(true)
  expect(running.playState).toBe('running')
  expect(svgPaused).toBe(false)
  expect(authorPaused.play).not.toHaveBeenCalled()
  setPlayback(false)
  expect(running.playState).toBe('paused')
  expect(svgPaused).toBe(true)
})
