import type { DocumentOperationResult } from '../../shared/workbench/document'
import type { ToolResult } from '../../shared/workbench/tools'
import type { ContentApplyDiagnostic } from '../contentApply/planning/types'

/** Public facts have no request or transaction-value slot. The Session retains the original. */
export interface PublicContentApplyReceipt {
  commit: 'committed' | 'unchanged' | 'not_committed' | 'unknown'
  usability: 'usable' | 'partial' | 'unusable' | 'unverified'
  delivery: 'not_requested'
  diagnostics: ContentApplyDiagnostic[]
  insertedIds: string[]
  receipt?: DocumentOperationResult
}

export function publicOperationReceipt(receipt: DocumentOperationResult): DocumentOperationResult {
  if ('applied' in receipt) return {
    status: receipt.status, documentId: receipt.documentId, operationId: receipt.operationId,
    code: receipt.code, message: receipt.message, applied: false,
  }
  return { status: receipt.status, documentId: receipt.documentId, operationId: receipt.operationId,
    beforeRevision: receipt.beforeRevision, revision: receipt.revision, persistence: receipt.persistence,
    ...(receipt.appliedChanges ? { appliedChanges: {
      affectedTargets: receipt.appliedChanges.affectedTargets,
      changes: receipt.appliedChanges.changes.map(change => ({ path: change.path, exists: change.exists })),
    } } : {}) }
}

export function publicContentApplyReceipt(result: PublicContentApplyReceipt): PublicContentApplyReceipt {
  return { commit: result.commit, usability: result.usability, delivery: result.delivery,
    diagnostics: result.diagnostics, insertedIds: result.insertedIds,
    ...(result.receipt ? { receipt: publicOperationReceipt(result.receipt) } : {}) }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** The Gateway public boundary also covers ordinary object writes and operation lookup.
 * It runs after internal ACK/recovery consumers, never on their stored receipts. */
export function publicWriteToolResult(name: string, result: ToolResult): ToolResult {
  if (result.kind === 'document-operation') return { ...result, result: publicOperationReceipt(result.result) }
  if (result.kind !== 'read' || !record(result.data)) return result
  if (name === 'course.createFromHtml' && record(result.data.import) && result.data.import.kind === 'document-operation')
    return { ...result, data: { ...result.data, import: publicWriteToolResult(name, result.data.import as ToolResult) } }
  if (['image.generate', 'image.edit', 'image.status', 'media.apply', 'media.insert'].includes(name)
    && record(result.data.application) && record(result.data.application.receipt))
    return { ...result, data: { ...result.data, application: { ...result.data.application,
      receipt: publicOperationReceipt(result.data.application.receipt as DocumentOperationResult) } } }
  return result
}
