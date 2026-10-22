import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { ZodError, type ZodIssue } from 'zod'
import { UserFacingError } from '../../../shared/errors'
import type { OfficeContentInspection, OfficeContentRequest, OfficeContentResult, OfficeFormat } from '../../../shared/workbench/officeFiles'

export type OfficeContentWorkerRequest =
  | { type: 'apply'; bytes?: Uint8Array; request: OfficeContentRequest }
  | { type: 'inspect'; bytes: Uint8Array; format: OfficeFormat }
export interface OfficeContentWorkerError {
  name: string; message: string; stack?: string; issues?: ZodIssue[]; title?: string; suggestion?: string
}
export type OfficeContentWorkerReply =
  | { ok: true; result: OfficeContentResult | OfficeContentInspection }
  | { ok: false; error: OfficeContentWorkerError }

function createWorker(): Worker {
  const entry = path.join(__dirname, `officeContentWorkerEntry${path.extname(__filename)}`)
  // Match the existing Main worker convention: tsx only for source execution;
  // packaged Electron uses the ordinary JS emitted by the existing build.
  return entry.endsWith('.ts')
    ? new Worker('const {workerData}=require("node:worker_threads"); require(workerData.loader); require(workerData.entry)', { eval: true, execArgv: [],
      workerData: { loader: require.resolve('tsx/cjs'), entry } })
    : new Worker(entry, { execArgv: [] })
}

function restoreError(value: OfficeContentWorkerError): Error {
  const constructors: Record<string, new(message: string) => Error> = { Error, TypeError, RangeError, SyntaxError, ReferenceError, URIError, EvalError }
  const error = value.title !== undefined && value.suggestion !== undefined
    ? new UserFacingError(value.title, value.message, value.suggestion)
    : value.issues ? new ZodError(value.issues) : new (constructors[value.name] ?? Error)(value.message)
  error.name = value.name
  if (value.stack) error.stack = value.stack
  return error
}

/** One pure operation owns one worker. File authority and publication never enter it. */
function run<T>(request: OfficeContentWorkerRequest, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    let worker: Worker
    try { worker = createWorker() }
    catch (error) { reject(error); return }
    let settled = false
    const finish = (complete: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      complete()
      void worker.terminate().catch(() => undefined)
    }
    const abort = () => finish(() => reject(signal?.reason ?? new Error('Office 处理已取消')))
    worker.once('message', (reply: OfficeContentWorkerReply) => finish(() => {
      if (reply.ok) resolve(reply.result as T)
      else reject(restoreError(reply.error))
    }))
    worker.once('error', error => finish(() => reject(error)))
    worker.once('exit', code => finish(() => reject(new Error(`Office 处理进程未返回结果（exit ${code}）`))))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    // Structured cloning leaves FileArtifact/History's input buffer attached.
    try { worker.postMessage(request) }
    catch (error) { finish(() => reject(error)) }
  })
}

export function applyOfficeContentOffThread(bytes: Uint8Array | undefined, request: OfficeContentRequest, signal?: AbortSignal): Promise<OfficeContentResult> {
  return run<OfficeContentResult>({ type: 'apply', ...(bytes ? { bytes } : {}), request }, signal)
}
export function inspectOfficeContentOffThread(bytes: Uint8Array, format: OfficeFormat, signal?: AbortSignal): Promise<OfficeContentInspection> {
  return run<OfficeContentInspection>({ type: 'inspect', bytes, format }, signal)
}
