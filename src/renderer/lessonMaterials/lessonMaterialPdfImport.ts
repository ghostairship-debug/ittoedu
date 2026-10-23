import type { LessonMaterialDesktopAPI, LessonMaterialOfficeInput, LessonMaterialPdfInput } from '../../shared/lessonMaterialDesktop'
import type { LessonMaterialTarget } from '../../shared/materialExtraction'

interface ImportOptions { signal: AbortSignal; onProgress: (page: number, total: number) => void }
async function runMaterialRequest<T>(api: LessonMaterialDesktopAPI, options: ImportOptions, execute: (requestId: string) => Promise<T>) {
  options.signal.throwIfAborted()
  const requestId = crypto.randomUUID()
  const stop = api.subscribeImportProgress(progress => { if (progress.requestId === requestId && !options.signal.aborted) options.onProgress(progress.page, progress.total) })
  const abort = () => { void api.cancelImport(requestId).catch(() => undefined) }
  options.signal.addEventListener('abort', abort, { once: true })
  try {
    options.signal.throwIfAborted()
    const result = await execute(requestId)
    options.signal.throwIfAborted()
    return result
  }
  finally { options.signal.removeEventListener('abort', abort); stop() }
}

export async function importLessonMaterialPdf(api: LessonMaterialDesktopAPI, target: LessonMaterialTarget,
  input: Omit<LessonMaterialPdfInput, 'requestId'>, options: ImportOptions) {
  return runMaterialRequest(api, options, requestId => api.importPdf(target, { ...input, requestId }))
}

export async function extractLessonMaterialOffice(api: LessonMaterialDesktopAPI,
  input: Omit<LessonMaterialOfficeInput, 'requestId'>, options: ImportOptions) {
  return runMaterialRequest(api, options, requestId => api.extractOffice({ ...input, requestId }))
}
