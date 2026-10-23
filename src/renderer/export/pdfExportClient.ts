import type { DesktopAPI } from '../../shared/ipcTypes'

type PdfApi = Pick<DesktopAPI, 'exportPdf' | 'cancelPdfExport' | 'onPdfExportPrepared'>
export interface PdfExportOptions { signal?: AbortSignal; onSaving?(): void }

/** The signal stays in this renderer; Main owns the matching print window. */
export async function exportPdfWithSignal(api: PdfApi, input: Parameters<DesktopAPI['exportPdf']>[0], options: PdfExportOptions = {}) {
  const { signal } = options
  signal?.throwIfAborted()
  const requestId = crypto.randomUUID()
  const stop = api.onPdfExportPrepared?.(event => {
    if (event.requestId === requestId && !signal?.aborted) options.onSaving?.()
  })
  const abort = () => { void api.cancelPdfExport?.({ requestId }).catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    signal?.throwIfAborted()
    // A successful publication remains a success even if cancellation arrives
    // after atomic writing has already started in Main.
    return await api.exportPdf({ ...input, requestId })
  } finally { signal?.removeEventListener('abort', abort); stop?.() }
}
