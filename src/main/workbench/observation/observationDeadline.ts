/** One observation owns one deadline across readiness, DOM, pixels and publication.
 * Reuse the isolated observation host's existing 20s fault envelope rather than
 * granting a fresh allowance to every frame or phase. This is not an action retry.
 */
export const OBSERVATION_TIMEOUT_MS = 20_000

export class ObservationDeadline {
  private readonly controller = new AbortController()
  private readonly expiresAt: number
  private stage = 'ready'
  private failure?: Error
  private readonly onAbort = () => this.fail(this.parent?.reason instanceof Error ? this.parent.reason
    : Object.assign(new Error(`页面观察已停止（${this.stage}）`), { code: 'observation-cancelled', observationStage: this.stage }))

  constructor(private readonly parent?: AbortSignal, private readonly timeoutMs = OBSERVATION_TIMEOUT_MS) {
    this.expiresAt = Date.now() + timeoutMs
    parent?.addEventListener('abort', this.onAbort, { once: true })
    if (parent?.aborted) this.onAbort()
  }

  get signal(): AbortSignal { return this.controller.signal }

  private fail(error: Error): void {
    if (this.failure) return
    this.failure = error
    this.controller.abort(error)
  }

  private expire(stage: string): void {
    this.fail(Object.assign(
      new Error(`页面观察超时（${stage}）；当前覆盖未验证，请重新观察，不要重复已应用动作。`),
      { code: 'observation-timeout', observationStage: stage, timeoutMs: this.timeoutMs }))
  }

  check(stage: string): void {
    this.stage = stage
    if (!this.failure && Date.now() >= this.expiresAt) this.expire(stage)
    if (this.failure) throw this.failure
  }

  /** Discard is scoped to this result: never clear another attempt's resources. */
  wait<T>(stage: string, work: () => Promise<T>, discard?: (value: T) => void | Promise<void>): Promise<T> {
    try { this.check(stage) } catch (error) { return Promise.reject(error) }
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const cleanup = () => { clearTimeout(timer); this.signal.removeEventListener('abort', stop) }
      const stop = () => {
        if (settled) return
        settled = true; cleanup(); reject(this.failure ?? new Error('页面观察已停止'))
      }
      // A timer may fire just before wall-clock rounding reaches expiresAt.
      // Its elapsed deadline is authoritative; never leave the wait unarmed.
      const timer = setTimeout(() => this.expire(stage), Math.max(0, this.expiresAt - Date.now()))
      this.signal.addEventListener('abort', stop, { once: true })
      if (this.signal.aborted) { stop(); return }
      try {
        work().then(value => {
          if (settled || this.signal.aborted) {
            void Promise.resolve().then(() => discard?.(value)).catch(() => undefined)
            return
          }
          settled = true; cleanup(); resolve(value)
        }, error => {
          if (settled) return
          settled = true; cleanup(); reject(error)
        })
      } catch (error) { settled = true; cleanup(); reject(error) }
    })
  }

  dispose(): void {
    this.parent?.removeEventListener('abort', this.onAbort)
    // Any native IPC still pending may settle later; it cannot resume this attempt.
    this.fail(Object.assign(new Error('页面观察已结束'), { code: 'observation-ended', observationStage: this.stage }))
  }
}
