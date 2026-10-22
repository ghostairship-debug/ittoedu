import { parentPort } from 'node:worker_threads'
import { ZodError } from 'zod'
import { UserFacingError } from '../../../shared/errors'
import { applyOfficeContent, inspectOfficeContent } from './OfficeContentService'
import type { OfficeContentWorkerError, OfficeContentWorkerReply, OfficeContentWorkerRequest } from './officeContentWorker'

function errorReply(error: unknown): OfficeContentWorkerError {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) }
  return { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}),
    ...(error instanceof ZodError ? { issues: error.issues } : {}),
    ...(error instanceof UserFacingError ? { title: error.title, suggestion: error.suggestion } : {}) }
}

const port = parentPort
if (!port) throw new Error('Office 处理入口只能由 Office worker 运行')
port.once('message', (request: OfficeContentWorkerRequest) => {
  void (async () => {
    try {
      const result = request.type === 'apply'
        ? await applyOfficeContent(request.bytes, request.request)
        : inspectOfficeContent(request.bytes, request.format)
      port.postMessage({ ok: true, result } satisfies OfficeContentWorkerReply)
    } catch (error) {
      port.postMessage({ ok: false, error: errorReply(error) } satisfies OfficeContentWorkerReply)
    } finally { port.close() }
  })()
})
