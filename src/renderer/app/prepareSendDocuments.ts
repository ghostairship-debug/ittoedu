import type { DocumentSnapshot } from '../../shared/workbench/document'
import type { ExecutionDocumentReference } from '../../shared/workbench/executionDesktop'

/** Compose the existing input owners using Main's document type, never the active tab. */
export async function prepareSendDocuments(
  references: readonly Pick<ExecutionDocumentReference, 'documentId' | 'epoch'>[],
  ports: {
    read(documentId: string): Promise<DocumentSnapshot>
    drainDocuments(documentIds: readonly string[]): Promise<boolean>
    prepareCourses?(documentIds: readonly string[]): Promise<void>
    reportFailure?(error: unknown, context: { operation: 'send-prepare'; phase: string; documentId?: string; epoch?: string; revision?: number; documentKind?: string }): Promise<unknown>
  },
): Promise<boolean> {
  const ids = [...new Set(references.map(reference => reference.documentId))]
  let phase = 'read'
  let targetContext: { documentId: string; epoch: string; revision?: number } | undefined
  try {
  const targets = await Promise.all(ids.map(id => ports.read(id).catch(error => { targetContext = references.find(ref => ref.documentId === id); throw error })))
  for (const reference of references) if (targets.find(target => target.documentId === reference.documentId)?.epoch !== reference.epoch)
    { targetContext = reference; throw new Error('引用文档已关闭或重开，输入与附件已保留，请重新确认引用后发送。') }
  phase = 'drain'
  if (!await ports.drainDocuments(ids)) return false
  phase = 'prepare'
  const courses = targets.filter(target => target.model.kind === 'course-v10').map(target => target.documentId)
  if (courses.length) await ports.prepareCourses?.(courses)
  for (const target of targets) {
    phase = 'read'; targetContext = { documentId: target.documentId, epoch: target.epoch, revision: target.revision }
    const current = await ports.read(target.documentId)
    if (current.epoch !== target.epoch)
      throw new Error('发送准备期间文档已关闭或重开，输入与附件已保留，请重新确认引用后发送。')
  }
  return true
  } catch (error) {
    try { void ports.reportFailure?.(error, { operation: 'send-prepare', phase, ...targetContext }).catch(() => undefined) } catch { /* A log failure never changes the draft outcome. */ }
    throw error
  }
}
