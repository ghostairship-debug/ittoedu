import type { LessonDocumentDesktopAPI } from '../../shared/lessonDocumentDesktop'
import type { DocumentFilePort, OpenDocumentResult } from '../../shared/document/ports'
import type { DocumentHostAPI } from '../../shared/workbench/desktop'

/** A single in-flight read observes actual files; late replies never replace a closed editor. */
export function createDesktopDocumentPort(api: LessonDocumentDesktopAPI, documents: DocumentHostAPI): LessonDocumentDesktopAPI & DocumentFilePort & { documents: DocumentHostAPI } {
  return { ...api, documents, watchDocument(ref, listener) {
    let closed = false, last: string | undefined, timer: ReturnType<typeof setTimeout> | undefined
    const version = (value: OpenDocumentResult) => JSON.stringify(value.version)
    async function poll() {
      try {
        const disk = await api.openDocument(ref)
        if (closed) return
        const next = version(disk)
        if (next !== last) listener({ type: 'changed', disk })
        last = next
      } catch (error) {
        if (!closed && error instanceof Error && /ENOENT|不存在|已删除/.test(error.message)) { listener({ type: 'deleted' }); last = undefined }
      } finally { if (!closed) timer = setTimeout(() => void poll(), 1000) }
    }
    void poll()
    return () => { closed = true; if (timer) clearTimeout(timer) }
  } }
}
