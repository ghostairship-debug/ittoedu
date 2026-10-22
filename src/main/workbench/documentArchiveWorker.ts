import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { ZodError, type ZodIssue } from 'zod'
import { UserFacingError } from '../../shared/errors'
import type { WorkProjectMigrationMap } from '../../shared/contracts/component-platform/workProjectMigration'
import type { CourseProjectV10ArchiveData } from '../../core/drivers/codecs/courseProjectV10Archive'
import { createCourseV10Driver } from '../../core/drivers/CourseV10Driver'
import type { DocumentDriver, DocumentModel, DurableDocumentState } from '../../shared/workbench/document'

export interface DocumentArchiveOpenOptions {
  identities?: WorkProjectMigrationMap
  includeMigrationIds?: boolean
}

export type DocumentArchiveOpenResult = CourseProjectV10ArchiveData & { courseProjectMigrationIds?: WorkProjectMigrationMap }

export type DocumentArchiveRequest =
  | { type: 'create'; data: CourseProjectV10ArchiveData }
  | { type: 'open'; bytes: Uint8Array; options?: DocumentArchiveOpenOptions }
  | { type: 'journal-checkpoint'; state: DurableDocumentState }

export interface DocumentArchiveError {
  name: string
  message: string
  stack?: string
  issues?: ZodIssue[]
  title?: string
  suggestion?: string
}

export type DocumentArchiveReply =
  | { ok: true; result: Uint8Array | DocumentArchiveOpenResult }
  | { ok: false; error: DocumentArchiveError }

function createWorker(): Worker {
  const entry = path.join(__dirname, `documentArchiveWorkerEntry${path.extname(__filename)}`)
  // Keep the existing Main worker launch convention: source tests use tsx;
  // compiled Electron runs the emitted JS without a development loader.
  return entry.endsWith('.ts')
    ? new Worker('const {workerData}=require("node:worker_threads"); require(workerData.loader); require(workerData.entry)', { eval: true, execArgv: [],
      workerData: { loader: require.resolve('tsx/cjs'), entry } })
    : new Worker(entry, { execArgv: [] })
}

function restoreError(value: DocumentArchiveError): Error {
  const error = value.title !== undefined && value.suggestion !== undefined
    ? new UserFacingError(value.title, value.message, value.suggestion)
    : value.issues ? new ZodError(value.issues) : new Error(value.message)
  error.name = value.name
  if (value.stack) error.stack = value.stack
  return error
}

/** One fixed input owns one short-lived worker. File and document publication
 * remain with Main; shared Session/History buffers are never transferred. */
function run<T>(request: DocumentArchiveRequest, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new DOMException('工程归档已取消', 'AbortError')); return }
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
    const abort = () => finish(() => reject(signal?.reason ?? new DOMException('工程归档已取消', 'AbortError')))
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('message', (reply: DocumentArchiveReply) => finish(() => {
      if (reply.ok) resolve(reply.result as T)
      else reject(restoreError(reply.error))
    }))
    worker.once('error', error => finish(() => reject(error)))
    worker.once('exit', code => finish(() => reject(new Error(`工程归档进程未返回结果（exit ${code}）`))))
    try { worker.postMessage(request) }
    catch (error) { finish(() => reject(error)) }
  })
}

export function createDocumentArchive(data: CourseProjectV10ArchiveData, signal?: AbortSignal): Promise<Uint8Array> {
  return run<Uint8Array>({ type: 'create', data }, signal)
}

export function openDocumentArchive(bytes: Uint8Array, options?: DocumentArchiveOpenOptions, signal?: AbortSignal): Promise<DocumentArchiveOpenResult> {
  return run<DocumentArchiveOpenResult>({ type: 'open', bytes, ...(options ? { options } : {}) }, signal)
}

/** Pure encoding only; the journal owner still validates identity and publishes. */
export function createDocumentJournalCheckpoint(state: DurableDocumentState): Promise<Uint8Array> {
  return run<Uint8Array>({ type: 'journal-checkpoint', state })
}

const openedModels = new WeakSet<DocumentModel>()

/** Main's owned read boundary. The returned model stays immutable until Session
 * consumes the worker's validation fact; this is never a renderer input path. */
export async function loadDocumentArchive(bytes: Uint8Array, options?: DocumentArchiveOpenOptions) {
  const { project, resources, courseProjectMigrationIds } = await openDocumentArchive(bytes, options)
  const model: DocumentModel = { kind: 'course-v10', project, resources }
  openedModels.add(model)
  return { model, ...(courseProjectMigrationIds ? { courseProjectMigrationIds } : {}) }
}

/** Only Main's archive CPU is asynchronous; the canonical apply owner is unchanged. */
export function createDocumentArchiveDriver(): DocumentDriver {
  const driver: DocumentDriver = createCourseV10Driver()
  const validate = driver.validate.bind(driver)
  driver.validate = model => { if (!openedModels.delete(model)) validate(model) }
  driver.load = async bytes => (await loadDocumentArchive(bytes)).model
  driver.serialize = model => {
    if (model.kind !== 'course-v10') throw new TypeError('Course V10 Driver 不接受其他文档格式')
    return createDocumentArchive({ project: model.project, resources: model.resources })
  }
  return driver
}
