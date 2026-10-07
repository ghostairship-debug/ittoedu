export interface NavigationTask<Target> {
  readonly target: Target
  readonly finished: Promise<NavigationOutcome>
  cancel(): void
}

export type NavigationOutcome =
  | { status: 'completed' | 'cancelled' | 'rejected' }
  | { status: 'failed'; phase: 'prepare' | 'commit' | 'transition'; error: unknown }

export interface NavigationTaskPorts<Request, Target> {
  /** Resolves against the host's current fact/order/guards, never a private list. */
  resolve(request: Request): Target | null
  prepare(target: Target, signal: AbortSignal): void | Promise<void>
  /** Synchronous final admission and fact write, owned by the host. */
  commit(target: Target, signal: AbortSignal): boolean
  /** Temporary visuals after the fact is committed; cancellation never restores an old fact. */
  transition?(target: Target, signal: AbortSignal): boolean | void | Promise<boolean | void>
}

/** One navigation task owner, with no course positions, history or shortcut state. */
export class NavigationTasks<Request, Target> {
  private current?: { cancel(): void }
  private disposed = false

  constructor(private readonly ports: NavigationTaskPorts<Request, Target>) {}

  request(request: Request): NavigationTask<Target> | null {
    if (this.disposed) return null
    const target = this.ports.resolve(request)
    // An invalid request does not cancel the last valid destination.
    if (target === null) return null
    let done!: (outcome: NavigationOutcome) => void
    const finished = new Promise<NavigationOutcome>(resolve => { done = resolve })
    const controller = new AbortController()
    let settled = false
    const settle = (outcome: NavigationOutcome) => {
      if (settled) return
      settled = true
      if (this.current === running) this.current = undefined
      controller.abort()
      done(outcome)
    }
    const running = { cancel: () => settle({ status: 'cancelled' }) }
    const previous = this.current
    this.current = running
    previous?.cancel()
    const live = () => !settled && !this.disposed && this.current === running
    void (async () => {
      let phase: 'prepare' | 'commit' | 'transition' = 'prepare'
      try {
        if (!live()) return
        await this.ports.prepare(target, controller.signal)
        if (!live()) return
        phase = 'commit'
        const accepted = this.ports.commit(target, controller.signal)
        if (!live()) return
        if (!accepted) { settle({ status: 'rejected' }); return }
        phase = 'transition'
        const transitioned = await this.ports.transition?.(target, controller.signal)
        if (live()) settle({ status: transitioned === false ? 'rejected' : 'completed' })
      } catch (error) {
        if (live()) settle({ status: 'failed', phase, error })
      }
    })()
    return { target, finished, cancel: running.cancel }
  }

  cancel(): void { this.current?.cancel() }
  dispose(): void { this.disposed = true; this.cancel() }
}
