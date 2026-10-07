import type { ExportBuildReply, ExportBuildRequest, ExportBuildProgress, ExportBuildCancel } from '../../../shared/workbench/toolPorts'

interface Pending {
  request: ExportBuildRequest
  resolve(reply: ExportBuildReply): void
  reject(error: Error): void
  removeAbort(): void
  refresh(): void
  sequence: number
}

/** Main-owned single-sender request/reply port. Late, foreign and duplicate replies never settle a request. */
export class DocumentExportPort {
  private readonly pending = new Map<string, Pending>()
  private closed = false
  constructor(private readonly senderId: number, private readonly dispatch: (request: ExportBuildRequest) => void,
    private readonly cancel?: (request: ExportBuildCancel) => void) {}

  private cancelProducer(request: ExportBuildRequest): void {
    try { this.cancel?.({ requestId: request.requestId, identity: request.identity }) }
    catch { /* A closed producer cannot receive cancellation; Main still retires its request. */ }
  }

  build(request: ExportBuildRequest, signal?: AbortSignal): Promise<ExportBuildReply> {
    if (this.closed || signal?.aborted) return Promise.reject(new Error('导出已取消'))
    if (this.pending.has(request.requestId)) return Promise.reject(new Error('导出请求编号重复'))
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const clear = () => { signal?.removeEventListener('abort', abort); if (timer !== undefined) clearTimeout(timer) }
      const abort = () => { this.pending.delete(request.requestId); clear(); this.cancelProducer(request); reject(new Error('导出已取消')) }
      signal?.addEventListener('abort', abort, { once: true })
      const refresh = () => {
        if (timer !== undefined) clearTimeout(timer)
        // Detect an unresponsive producer, not elapsed course/build duration.
        timer = setTimeout(() => {
          this.pending.delete(request.requestId); clear(); this.cancelProducer(request)
          reject(new Error('导出窗口长时间无响应，请检查当前窗口后重试'))
        }, 120_000)
      }
      this.pending.set(request.requestId, { request, resolve, reject, removeAbort: clear, refresh, sequence: 0 })
      refresh()
      try { this.dispatch(request) }
      catch (error) { this.pending.delete(request.requestId); clear(); reject(error) }
    })
  }

  progress(value: unknown, senderId: number): boolean {
    if (this.closed || senderId !== this.senderId || !value || typeof value !== 'object') return false
    const progress = value as Partial<ExportBuildProgress>
    if (typeof progress.requestId !== 'string' || !progress.identity || typeof progress.identity !== 'object') return false
    const pending = this.pending.get(progress.requestId)
    if (!pending || !Number.isSafeInteger(progress.sequence) || progress.sequence! <= pending.sequence) return false
    const expected = pending.request.identity, actual = progress.identity
    if (actual.documentId !== expected.documentId || actual.epoch !== expected.epoch
      || actual.revision !== expected.revision || actual.projectId !== expected.projectId) return false
    pending.sequence = progress.sequence!
    pending.refresh()
    return true
  }

  accept(value: unknown, senderId: number): boolean {
    if (this.closed || senderId !== this.senderId) return false
    if (!value || typeof value !== 'object') return false
    const reply = value as Partial<ExportBuildReply>
    if (!['generated', 'drained', 'failed', 'cancelled'].includes(reply.status ?? '')) return false
    if (typeof reply.requestId !== 'string' || !reply.identity || typeof reply.identity !== 'object') return false
    const pending = this.pending.get(reply.requestId)
    if (!pending) return false
    const expected = pending.request.identity, actual = reply.identity
    if (actual.documentId !== expected.documentId || actual.epoch !== expected.epoch
      || actual.revision !== expected.revision || actual.projectId !== expected.projectId) return false
    this.pending.delete(reply.requestId)
    pending.removeAbort()
    pending.resolve(reply as ExportBuildReply)
    return true
  }

  dispose(): void {
    this.closed = true
    for (const pending of this.pending.values()) { pending.removeAbort(); this.cancelProducer(pending.request); pending.reject(new Error('导出宿主已关闭')) }
    this.pending.clear()
  }
}
