import { MotionScope } from '../motion/MotionScope'
import type { MotionProgram } from '../motion/types'

/** Uses L06's presentation and cancellation, without acquiring frame/camera ownership. */
export function navigationMotion<Target>(
  scope: MotionScope,
  element: (target: Target) => HTMLElement | SVGElement | null,
  program: (target: Target) => MotionProgram,
): (target: Target, signal: AbortSignal) => Promise<void> {
  return async (target, signal) => {
    if (signal.aborted) return
    const root = element(target)
    if (!root) return
    const task = scope.replace('navigation', root, program(target))
    const cancel = () => task.cancel()
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    try {
      const result = await task.finished
      if (result.status === 'failed') throw result.error
    } finally { signal.removeEventListener('abort', cancel) }
  }
}
