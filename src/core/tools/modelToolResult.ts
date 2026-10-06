import type { DocumentOperationResult } from '../../shared/workbench/document'
import type { ToolResult } from '../../shared/workbench/tools'

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function operationReceipt(value: unknown): value is DocumentOperationResult {
  return record(value) && (value.status === 'applied' || value.status === 'unchanged')
    && typeof value.documentId === 'string' && typeof value.operationId === 'string'
    && typeof value.beforeRevision === 'number' && typeof value.revision === 'number'
    && value.persistence === 'recoverable'
}

function projectReceipt(receipt: DocumentOperationResult): DocumentOperationResult {
  if (!('appliedChanges' in receipt) || !receipt.appliedChanges) return receipt
  return { ...receipt, appliedChanges: { ...receipt.appliedChanges,
    changes: receipt.appliedChanges.changes.map(({ value: _value, ...change }) => change),
  } }
}

/** Model replies describe committed paths; normalized document values stay in the host receipt. */
export function modelToolResult(toolName: string, result: ToolResult): ToolResult {
  if (result.kind === 'document-operation') return { ...result, result: projectReceipt(result.result) }
  // Only this write tool wraps its host receipt in read.data. Explicit reads are authored content.
  if (toolName === 'project.apply' && result.kind === 'read' && record(result.data)
    && operationReceipt(result.data.receipt)) {
    return { ...result, data: { ...result.data, receipt: projectReceipt(result.data.receipt) } }
  }
  return result
}
