import { parentPort } from 'node:worker_threads'
import { ZodError } from 'zod'
import { UserFacingError } from '../../shared/errors'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../core/drivers/codecs/courseProjectV10Archive'
import { validateComponentData } from '../../core/components/validateComponentData'
import type { DocumentArchiveError, DocumentArchiveReply, DocumentArchiveRequest } from './documentArchiveWorker'
import { DocumentJournalCodec } from './documentJournalCodec'
import { recordDocumentJournalPayload } from './documentJournalRecord'

function errorReply(error: unknown): DocumentArchiveError {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) }
  return { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}),
    ...(error instanceof ZodError ? { issues: error.issues } : {}),
    ...(error instanceof UserFacingError ? { title: error.title, suggestion: error.suggestion } : {}) }
}

/** Only worker-owned output may be transferred. Preserve exact byte views even
 * if the codec later returns a slice rather than its current compact buffers. */
function outputBytes(bytes: Uint8Array): Uint8Array {
  return bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes : Uint8Array.from(bytes)
}

const port = parentPort
if (!port) throw new Error('工程归档入口只能由归档 worker 运行')
port.once('message', (request: DocumentArchiveRequest) => {
  try {
    if (request.type === 'journal-checkpoint') {
      const prepared = new DocumentJournalCodec().prepare('checkpoint', request.state)
      const bytes = outputBytes(recordDocumentJournalPayload(prepared.payload))
      port.postMessage({ ok: true, result: bytes } satisfies DocumentArchiveReply, [bytes.buffer as ArrayBuffer])
    } else if (request.type === 'create') {
      validateComponentData(request.data.project)
      const bytes = outputBytes(createCourseProjectV10Archive(request.data))
      port.postMessage({ ok: true, result: bytes } satisfies DocumentArchiveReply, [bytes.buffer as ArrayBuffer])
    } else {
      const result = openCourseProjectV10Archive(request.bytes, request.options)
      validateComponentData(result.project)
      const transfer = new Set<ArrayBuffer>()
      const take = (bytes: Uint8Array) => {
        const owned = outputBytes(bytes)
        transfer.add(owned.buffer as ArrayBuffer)
        return owned
      }
      for (const [id, bytes] of Object.entries(result.resources.assets)) result.resources.assets[id] = take(bytes)
      for (const files of Object.values(result.resources.components)) for (const [name, bytes] of Object.entries(files)) files[name] = take(bytes)
      port.postMessage({ ok: true, result } satisfies DocumentArchiveReply, [...transfer])
    }
  } catch (error) {
    port.postMessage({ ok: false, error: errorReply(error) } satisfies DocumentArchiveReply)
  } finally { port.close() }
})
