import { DomMotionPresentation } from './DomMotionPresentation'
import type { MotionClock, MotionContext, MotionOutcome, MotionProgram, MotionTask } from './types'

interface RunningMotion {
  readonly controller: AbortController
  settle(outcome: MotionOutcome): void
}

/** One scope belongs to one R0 instance; channels are local to that instance. */
export class MotionScope {
  readonly #tasks = new Map<string, RunningMotion>()
  #disposed = false

  constructor(readonly options: { clock?: MotionClock; prefersReducedMotion?: () => boolean } = {}) {}

  replace(channel: string, target: HTMLElement | SVGElement, program: MotionProgram): MotionTask {
    if (this.#disposed) throw new Error('Motion scope is disposed')
    const view = target.ownerDocument.defaultView
    const clock = this.options.clock ?? {
      now: () => view?.performance.now() ?? performance.now(),
      requestFrame: (callback: (timestamp: number) => void) => {
        if (!view) throw new Error('Motion target document has no animation clock')
        return view.requestAnimationFrame(callback)
      },
      cancelFrame: (id: number) => view?.cancelAnimationFrame(id),
    }
    const previous = this.#tasks.get(channel)
    const controller = new AbortController()
    let presentation: DomMotionPresentation | undefined
    const frames = new Map<number, (value: null) => void>()
    const cleanups = new Set<() => void>()
    const started = clock.now()
    let settled = false
    let resolve!: (outcome: MotionOutcome) => void
    const finished = new Promise<MotionOutcome>(done => { resolve = done })
    const current = (): boolean => !settled && !this.#disposed && this.#tasks.get(channel) === running
    const running: RunningMotion = {
      controller,
      settle: (outcome) => {
        if (settled) return
        settled = true
        if (this.#tasks.get(channel) === running) this.#tasks.delete(channel)
        // Invalidate writes before abort listeners, promises or cleanup reenter.
        controller.abort()
        for (const [id, done] of frames) { clock.cancelFrame(id); done(null) }
        frames.clear()
        presentation?.clear()
        for (const cleanup of cleanups) {
          try { cleanup() } catch { /* Continue releasing the instance's resources. */ }
        }
        cleanups.clear()
        resolve(outcome)
      },
    }
    this.#tasks.set(channel, running)
    previous?.settle({ status: 'cancelled' })
    // Read the underlying opacity only after removing the previous task's effect.
    if (current()) presentation = new DomMotionPresentation(target)
    const context: MotionContext = {
      signal: controller.signal,
      reducedMotion: this.#reducedMotion(target),
      write: (frame) => {
        if (!current()) return false
        if (!target.isConnected) { running.settle({ status: 'cancelled' }); return false }
        try { presentation!.write(frame); return true } catch (error) { running.settle({ status: 'failed', error }); return false }
      },
      nextFrame: () => {
        if (!current()) return Promise.resolve(null)
        return new Promise(done => {
          const id = clock.requestFrame(timestamp => {
            frames.delete(id)
            if (!current()) { done(null); return }
            if (!target.isConnected) { running.settle({ status: 'cancelled' }); done(null); return }
            done({ elapsed: Math.max(0, timestamp - started) })
          })
          frames.set(id, done)
        })
      },
      animate: async (keyframes, timing) => {
        if (!current()) return false
        if (!target.isConnected) { running.settle({ status: 'cancelled' }); return false }
        if (context.reducedMotion) return true
        const completed = await presentation!.animate(keyframes, timing)
        if (!current()) return false
        if (!completed || !target.isConnected) { running.settle({ status: 'cancelled' }); return false }
        return true
      },
      onCleanup: (cleanup) => {
        if (current()) cleanups.add(cleanup)
        else cleanup()
      },
    }
    // Old abort/cleanup code may itself replace this channel; it owns that newer task.
    if (current()) {
      try {
        void Promise.resolve(program(context)).then(
          () => running.settle({ status: 'completed' }),
          error => running.settle({ status: 'failed', error }),
        )
      } catch (error) { running.settle({ status: 'failed', error }) }
    }
    return { finished, cancel: () => running.settle({ status: 'cancelled' }) }
  }

  cancel(channel: string): void { this.#tasks.get(channel)?.settle({ status: 'cancelled' }) }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const task of [...this.#tasks.values()]) task.settle({ status: 'cancelled' })
  }

  #reducedMotion(target: HTMLElement | SVGElement): boolean {
    try {
      return this.options.prefersReducedMotion?.()
        ?? target.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ?? false
    } catch { return false }
  }
}
