import type { NodeMotionAction } from '../../shared/interactionTypes'
import { MotionScope, type MotionProgram } from '../../player/behaviors/motion'

/** Preset parameters choose a default program; source programs remain unrestricted. */
export function nodeMotionProgram(action: NodeMotionAction): MotionProgram {
  return async context => {
    const duration = Number.isFinite(action.durationMs) ? Math.max(0, action.durationMs) : 0
    if (!duration || action.effect === 'none' || context.reducedMotion) return
    let transform = 'none'
    if (action.effect === 'slide') {
      const direction = action.direction ?? 'left'
      transform = direction === 'left' ? 'translateX(-48px)' : direction === 'right' ? 'translateX(48px)'
        : direction === 'up' ? 'translateY(-48px)' : 'translateY(48px)'
    } else if (action.effect === 'scale') transform = 'scale(0.84)'
    const from = { opacity: 0, transform }, to = { opacity: 1, transform: 'none' }
    await context.animate(action.type === 'node.enter' ? [from, to] : [to, from], { duration, easing: action.easing })
  }
}

/** The world owns visibility; this adapter owns only a cancellable presentation task. */
export async function runComponentNodeMotion(scope: MotionScope, channel: string, element: HTMLElement | SVGElement,
  action: NodeMotionAction, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false
  const task = scope.replace(channel, element, nodeMotionProgram(action))
  const cancel = () => task.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  try { return (await task.finished).status === 'completed' && !signal.aborted }
  finally { signal.removeEventListener('abort', cancel) }
}
