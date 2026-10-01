export interface ModelStreamClockOptions {
  timeoutMs?: number
  progressTimeoutMs?: number
  maxDurationMs?: number | null
  now?: () => number
}
/** One attempt, three clocks. Local consumption pauses waiting clocks, never the total deadline. */
export class ModelStreamClock {
  private idle?: ReturnType<typeof setTimeout>
  private progressTimer?: ReturnType<typeof setTimeout>
  private total?: ReturnType<typeof setTimeout>
  private paused = false
  private disposed = false
  private remaining: number
  private progressDeadline = 0
  private readonly now: () => number
  private readonly idleMs: number
  private readonly progressMs: number
  constructor(options: ModelStreamClockOptions, private readonly expire: (phase: 'idle' | 'progress' | 'total') => void) {
    const duration = (value: number | undefined, fallback: number) => value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
    this.now = options.now ?? Date.now
    this.idleMs = duration(options.timeoutMs, 120_000)
    this.remaining = this.progressMs = duration(options.progressTimeoutMs, 10 * 60_000)
    // Progress/idle clocks protect the default path; only an explicit deadline caps total work.
    if (typeof options.maxDurationMs === 'number' && Number.isFinite(options.maxDurationMs) && options.maxDurationMs > 0)
      this.total = setTimeout(() => this.timeout('total'), options.maxDurationMs)
    this.arm()
  }
  private timeout(phase: 'idle' | 'progress' | 'total') { if (!this.disposed) { this.dispose(); this.expire(phase) } }
  private arm() {
    if (this.disposed || this.paused) return
    this.activity()
    this.progressDeadline = this.now() + this.remaining
    this.progressTimer = setTimeout(() => this.timeout('progress'), this.remaining)
  }
  /** Only framed SSE events/comments, not arbitrary arriving bytes, count as activity. */
  activity() {
    if (this.disposed || this.paused) return
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.timeout('idle'), this.idleMs)
  }
  progress() {
    this.remaining = this.progressMs
    if (!this.disposed && !this.paused) {
      clearTimeout(this.progressTimer)
      this.progressDeadline = this.now() + this.remaining
      this.progressTimer = setTimeout(() => this.timeout('progress'), this.remaining)
    }
  }
  pause() {
    if (this.disposed || this.paused) return
    this.remaining = Math.max(0, this.progressDeadline - this.now())
    this.paused = true
    clearTimeout(this.idle); clearTimeout(this.progressTimer)
  }
  resume() { if (this.paused && !this.disposed) { this.paused = false; this.arm() } }
  dispose() { this.disposed = true; clearTimeout(this.idle); clearTimeout(this.progressTimer); clearTimeout(this.total) }
}

/** Cancel the local wait without claiming an ignored upstream resolver has stopped. */
export async function waitForModelOperation<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort: () => void = () => undefined
  const cancelled = new Promise<never>((_, reject) => { abort = () => reject(signal.reason ?? new Error('aborted')); signal.addEventListener('abort', abort, { once: true }) })
  try { return await Promise.race([operation(), cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}
