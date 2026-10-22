import type { LessonMaterialDesktopAPI, LessonMaterialPdfInput } from '../../shared/lessonMaterialDesktop'
import type { LessonMaterialTarget } from '../../shared/materialExtraction'

export async function importLessonMaterialPdf(api: LessonMaterialDesktopAPI, target: LessonMaterialTarget,
  input: Omit<LessonMaterialPdfInput, 'requestId'>, options: { signal: AbortSignal; onProgress: (page: number, total: number) => void }) {
  options.signal.throwIfAborted()
  const requestId = crypto.randomUUID()
  const stop = api.subscribeImportProgress(progress => { if (progress.requestId === requestId && !options.signal.aborted) options.onProgress(progress.page, progress.total) })
  const abort = () => { void api.cancelImport(requestId).catch(() => undefined) }
  options.signal.addEventListener('abort', abort, { once: true })
  try { return await api.importPdf(target, { ...input, requestId }) }
  finally { options.signal.removeEventListener('abort', abort); stop() }
}
