import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createLessonDocumentFiles, type LessonDocumentFilesOptions } from '../../src/main/lessonDocumentFiles'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentEvent } from '../../src/shared/workbench/document'

/** Real Registry, Drivers and durable journal; only the transport is an in-process adapter. */
export function createMarkdownTestHost(directory: string) {
  const host = new DocumentHostService(directory)
  const listeners = new Set<(event: DocumentEvent) => void>()
  host.setEventSink(event => { for (const listener of listeners) listener(event) })
  const documents: DocumentHostAPI & { stopRun(documentId: string, runId: string): Promise<unknown> } = {
    async bootstrapCourse() { throw new Error('Course bootstrap is outside this Markdown fixture') },
    ...host.internalAPI,
    close: async (documentId, discardDirty) => { await host.operate({ type: 'close', documentId, discardDirty }) },
    discardRecovery: async documentId => { await host.operate({ type: 'discard-recovery', documentId }) },
    saveWithDialog: async () => { throw new Error('Native dialog is outside this fixture') },
    closeWithDialog: async documentId => { await host.saveToPath(documentId); await host.operate({ type: 'close', documentId }); return true },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return { host, documents }
}

export function createTestLessonDocumentFiles(options: Omit<LessonDocumentFilesOptions, 'documents'>) {
  const { documents } = createMarkdownTestHost(path.join(options.recoveryDirectory, 'canonical'))
  return { ...createLessonDocumentFiles({ ...options, documents }), documents }
}
