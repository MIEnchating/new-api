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
// Serialized into the opaque-origin preview before generated scripts. Keep
// this function self-contained: it cannot reference imports or module state.
export function installIntelligencePlayback() {
  const previewWindow: Window = window
  const nativeFrame = previewWindow.requestAnimationFrame.bind(window)
  const cancelFrame = previewWindow.cancelAnimationFrame.bind(window)
  const nativeTimeout = previewWindow.setTimeout.bind(window)
  const cancelTimeout = previewWindow.clearTimeout.bind(window)
  const clock = performance.now.bind(performance)
  let active = false
  let pausedAt = clock()
  let pausedDuration = 0
  let nextId = 0

  type Frame = { callback: FrameRequestCallback; nativeId?: number }
  type Timer = {
    handler: TimerHandler
    args: unknown[]
    interval: boolean
    delay: number
    remaining: number
    deadline: number
    nativeId?: number
  }
  const frames = new Map<number, Frame>()
  const timers = new Map<number, Timer>()
  const animations = new Set<Animation>()
  const svgs = new Set<SVGSVGElement>()

  // Keep rAF timestamps and performance.now on the same paused clock so a
  // canvas animation resumes at its previous position instead of jumping.
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: () => (active ? clock() : pausedAt) - pausedDuration,
  })

  function scheduleFrame(id: number, frame: Frame) {
    frame.nativeId = nativeFrame((time) => {
      frames.delete(id)
      frame.callback(time - pausedDuration)
    })
  }

  previewWindow.requestAnimationFrame = (callback) => {
    const id = ++nextId
    const frame: Frame = { callback }
    frames.set(id, frame)
    if (active) scheduleFrame(id, frame)
    return id
  }
  previewWindow.cancelAnimationFrame = (id) => {
    const frame = frames.get(id)
    if (frame?.nativeId !== undefined) cancelFrame(frame.nativeId)
    frames.delete(id)
  }

  function scheduleTimer(id: number, timer: Timer) {
    timer.deadline = clock() + timer.remaining
    timer.nativeId = nativeTimeout(() => {
      timer.nativeId = undefined
      if (!timer.interval) timers.delete(id)
      try {
        if (typeof timer.handler === 'function') {
          timer.handler.apply(previewWindow, timer.args)
        } else {
          // Retain native CSP restrictions on string handlers; never eval.
          nativeTimeout(timer.handler, 0, ...timer.args)
        }
      } finally {
        if (timer.interval && timers.has(id)) {
          timer.remaining = timer.delay
          if (active) scheduleTimer(id, timer)
        }
      }
    }, timer.remaining)
  }

  function createTimer(
    handler: TimerHandler,
    delay: number | undefined,
    interval: boolean,
    args: unknown[]
  ) {
    const id = ++nextId
    const duration = Math.max(0, Number(delay) || 0)
    const timer: Timer = {
      handler,
      args,
      interval,
      delay: duration,
      remaining: duration,
      deadline: 0,
    }
    timers.set(id, timer)
    if (active) scheduleTimer(id, timer)
    return id
  }

  previewWindow.setTimeout = (handler, delay, ...args) =>
    createTimer(handler, delay, false, args)
  previewWindow.setInterval = (handler, delay, ...args) =>
    createTimer(handler, delay, true, args)
  const clearTimer = (id: number | undefined) => {
    if (id === undefined) return
    const timer = timers.get(id)
    if (timer?.nativeId !== undefined) cancelTimeout(timer.nativeId)
    timers.delete(id)
  }
  previewWindow.clearTimeout = clearTimer
  previewWindow.clearInterval = clearTimer

  function pauseVisuals() {
    if (active) return
    for (const animation of document.getAnimations?.() ?? []) {
      if (animation.playState === 'running') {
        animations.add(animation)
        const time = animation.currentTime
        animation.pause()
        // Commit the paused position without waiting for an offscreen frame.
        if (time !== null) animation.currentTime = time
      }
    }
    for (const svg of document.querySelectorAll('svg')) {
      if (svg.animationsPaused && !svg.animationsPaused()) {
        svgs.add(svg)
        svg.pauseAnimations()
      }
    }
  }

  previewWindow.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== previewWindow.parent) return
    const message = event.data as { type?: string; active?: boolean } | null
    if (
      message?.type !== 'new-api:intelligence-playback' ||
      typeof message.active !== 'boolean'
    ) {
      return
    }
    if (active === message.active) return
    if (message.active) {
      pausedDuration += clock() - pausedAt
      active = true
      for (const [id, frame] of frames) scheduleFrame(id, frame)
      for (const [id, timer] of timers) scheduleTimer(id, timer)
      for (const animation of animations) {
        if (animation.playState === 'paused') animation.play()
      }
      for (const svg of svgs) svg.unpauseAnimations()
      animations.clear()
      svgs.clear()
    } else {
      pausedAt = clock()
      active = false
      for (const frame of frames.values()) {
        if (frame.nativeId !== undefined) cancelFrame(frame.nativeId)
        frame.nativeId = undefined
      }
      for (const timer of timers.values()) {
        if (timer.nativeId === undefined) continue
        cancelTimeout(timer.nativeId)
        timer.nativeId = undefined
        timer.remaining = Math.max(0, timer.deadline - pausedAt)
      }
      pauseVisuals()
    }
  })

  // Catch visuals created during initial parsing or by late DOM updates while
  // paused, without a polling timer running in every offscreen document.
  document.addEventListener('DOMContentLoaded', pauseVisuals)
  document.addEventListener('animationstart', pauseVisuals, true)
  new MutationObserver(pauseVisuals).observe(document, {
    childList: true,
    subtree: true,
  })
}
