type Lease = () => void
type Waiting = { signal: AbortSignal; grant(lease: Lease): void; reject(reason: unknown): void; abort(): void }
type Pool = { running: number; limit: number; waiting: Waiting[] }

/** One execution capacity for the root's entire native task tree. */
export class NativeTaskCapacity {
  private readonly pools = new Map<string, Pool>()

  acquire(rootRunId: string, limit: number, signal: AbortSignal): Promise<Lease> {
    signal.throwIfAborted()
    let pool = this.pools.get(rootRunId)
    if (!pool) { pool = { running: 0, limit, waiting: [] }; this.pools.set(rootRunId, pool) }
    const current = pool
    return new Promise((grant, reject) => {
      const entry: Waiting = { signal, grant, reject, abort: () => {
        const index = current.waiting.indexOf(entry)
        if (index >= 0) current.waiting.splice(index, 1)
        reject(signal.reason)
        this.pump(rootRunId, current)
      } }
      signal.addEventListener('abort', entry.abort, { once: true })
      current.waiting.push(entry)
      this.pump(rootRunId, current)
    })
  }

  private pump(rootRunId: string, pool: Pool): void {
    while (pool.running < pool.limit && pool.waiting.length) {
      const entry = pool.waiting.shift()!
      entry.signal.removeEventListener('abort', entry.abort)
      if (entry.signal.aborted) { entry.reject(entry.signal.reason); continue }
      pool.running++
      let released = false
      entry.grant(() => {
        if (released) return
        released = true; pool.running--
        this.pump(rootRunId, pool)
      })
    }
    if (!pool.running && !pool.waiting.length && this.pools.get(rootRunId) === pool) this.pools.delete(rootRunId)
  }
}
