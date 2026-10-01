/** Bounded concurrent execution, unbounded waiting count; waiting time is not execution time. */
export class FairWorkQueue {
  private active = 0
  private readonly waiting: Array<{ signal?: AbortSignal; grant(): void; cancel(): void }> = []
  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid concurrency')
  }
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('已取消'))
    return new Promise((resolve, reject) => {
      const ticket = { signal,
        cancel: () => { const index = this.waiting.indexOf(ticket); if (index >= 0) this.waiting.splice(index, 1); reject(signal?.reason ?? new Error('已取消')) },
        grant: () => {
          signal?.removeEventListener('abort', ticket.cancel)
          this.active++
          let released = false
          resolve(() => { if (released) return; released = true; this.active--; this.pump() })
        },
      }
      this.waiting.push(ticket); signal?.addEventListener('abort', ticket.cancel, { once: true }); this.pump()
    })
  }
  private pump(): void { while (this.active < this.concurrency && this.waiting.length) this.waiting.shift()!.grant() }
}
