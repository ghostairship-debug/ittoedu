/** Temporary local transforms compose after the current author transform. */
export interface MotionFrame {
  readonly transform?: string
  /** Temporary opacity scale, sampled when a task starts. */
  readonly opacity?: number
}

export interface MotionKeyframe extends MotionFrame {
  readonly offset?: number
  readonly easing?: string
}

/** Serializable timing supported by the shared motion presentation service. */
export interface MotionTiming {
  readonly delay?: number
  readonly direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse'
  readonly duration?: number | 'auto'
  readonly easing?: string
  readonly endDelay?: number
  readonly fill?: 'none' | 'forwards' | 'backwards' | 'both' | 'auto'
  readonly iterationStart?: number
  readonly iterations?: number
}

export interface ComponentMotionContext {
  readonly signal: AbortSignal
  readonly reducedMotion: boolean
  /** Resolves only after the host applies the frame; false means this task retired. */
  write(frame: MotionFrame): Promise<boolean>
  nextFrame(): Promise<{ readonly elapsed: number } | null>
  animate(frames: readonly MotionKeyframe[], timing: MotionTiming): Promise<boolean>
  onCleanup(cleanup: () => void): void
}

/** Executed in the calling implementation's realm; functions never cross the host port. */
export type ComponentMotionProgram = (context: ComponentMotionContext) => void | Promise<void>
export type ComponentMotionOutcome =
  | { readonly status: 'completed' | 'cancelled' }
  | { readonly status: 'failed'; readonly error: unknown }

export interface ComponentMotionTask {
  readonly finished: Promise<ComponentMotionOutcome>
  cancel(): void
}

export interface ComponentMotionPort {
  /** A channel is private to this source mount and target. */
  replace(channel: string, program: ComponentMotionProgram): ComponentMotionTask
}
