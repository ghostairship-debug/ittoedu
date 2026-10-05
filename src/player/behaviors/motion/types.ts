import type { MotionFrame, MotionKeyframe, MotionTiming } from '../../../shared/contracts/component-platform/motion'
export type { MotionFrame, MotionKeyframe, MotionTiming } from '../../../shared/contracts/component-platform/motion'

export interface MotionClock {
  now(): number
  requestFrame(callback: (timestamp: number) => void): number
  cancelFrame(id: number): void
}

export interface MotionContext {
  readonly signal: AbortSignal
  readonly reducedMotion: boolean
  /** Returns false after completion/cancellation; a retained context cannot write. */
  write(frame: MotionFrame): boolean
  /** Cancellation resolves every pending frame wait with null. */
  nextFrame(): Promise<{ readonly elapsed: number } | null>
  animate(frames: readonly MotionKeyframe[], timing: MotionTiming): Promise<boolean>
  onCleanup(cleanup: () => void): void
}

/** A normal source module can await frames, run any algorithm, and call scoped writes. */
export type MotionProgram = (context: MotionContext) => void | Promise<void>

export type MotionOutcome =
  | { readonly status: 'completed' | 'cancelled' }
  | { readonly status: 'failed'; readonly error: unknown }

export interface MotionTask {
  readonly finished: Promise<MotionOutcome>
  cancel(): void
}
