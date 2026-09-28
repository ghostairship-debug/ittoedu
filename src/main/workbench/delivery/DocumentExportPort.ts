import type { ExportBuildReply, ExportBuildRequest } from '../../../shared/workbench/toolPorts'

interface Pending {
  request: ExportBuildRequest
  resolve(reply: ExportBuildReply): void
  reject(error: Error): void
  removeAbort(): void
}

/** Main-owned single-sender request/reply port. Late, foreign and duplicate replies never settle a request. */
export class DocumentExportPort {
  private readonly pending = new Map<string, Pending>()
  private closed = false
  constructor(private readonly senderId: number, private readonly dispatch: (request: ExportBuildRequest) => void) {}

  build(request: ExportBuildRequest, signal?: AbortSignal): Promise<ExportBuildReply> {
    if (this.closed || signal?.aborted) return Promise.reject(new Error('导出已取消'))
    if (this.pending.has(request.requestId)) return Promise.reject(new Error('导出请求编号重复'))
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const clear = () => { signal?.removeEventListener('abort', abort); if (timer) clearTimeout(timer) }
      const abort = () => { this.pending.delete(request.requestId); clear(); reject(new Error('导出已取消')) }
      signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => {
        this.pending.delete(request.requestId); clear(); reject(new Error('导出构建超时，请检查当前窗口后重试'))
      }, 120_000)
      this.pending.set(request.requestId, { request, resolve, reject, removeAbort: clear })
      try { this.dispatch(request) }
      catch (error) { this.pending.delete(request.requestId); clear(); reject(error) }
    })
  }

  accept(value: unknown, senderId: number): boolean {
    if (this.closed || senderId !== this.senderId) return false
    if (!value || typeof value !== 'object') return false
    const reply = value as Partial<ExportBuildReply>
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
    for (const pending of this.pending.values()) { pending.removeAbort(); pending.reject(new Error('导出宿主已关闭')) }
    this.pending.clear()
  }
}
