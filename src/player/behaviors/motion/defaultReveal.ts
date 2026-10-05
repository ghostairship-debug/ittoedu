import type { MotionContext } from './types'

/** Shared default implementation; parameters and this module's source are editable. */
export async function defaultReveal(context: MotionContext, parameters: {
  durationMs?: number
  distancePx?: number
  useFrames?: boolean
} = {}): Promise<void> {
  const duration = Math.max(0, parameters.durationMs ?? 420)
  const distance = parameters.distancePx ?? 14
  if (context.reducedMotion || duration === 0) return
  if (!parameters.useFrames) {
    await context.animate([
      { opacity: 0, transform: `translateY(${distance}px)` },
      { opacity: 1, transform: 'translateY(0px)' },
    ], { duration, easing: 'ease-out' })
    return
  }
  context.write({ opacity: 0, transform: `translateY(${distance}px)` })
  while (!context.signal.aborted) {
    const frame = await context.nextFrame()
    if (!frame) return
    const t = Math.min(frame.elapsed / duration, 1)
    const eased = 1 - Math.pow(1 - t, 3)
    context.write({ opacity: eased, transform: `translateY(${distance * (1 - eased)}px)` })
    if (t === 1) return
  }
}
