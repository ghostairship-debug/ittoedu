import type { ContentApplyResult } from '../../../core/contentApply/planning/types'
import type { DocumentOperationResult } from '../../../shared/workbench/document'
import type { SaveReceipt } from '../../../shared/workbench/toolPorts'
import type { ToolResult } from '../../../shared/workbench/tools'

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
type SuccessfulReceipt = Extract<DocumentOperationResult, { status: 'applied' | 'unchanged' }>

/** Read only the named write tool's host envelope; authored reads are never execution facts. */
export function contentApplyFact(name: string, result?: ToolResult): ContentApplyResult | null {
  if (name !== 'project.apply' || result?.kind !== 'read' || !record(result.data)) return null
  const data = result.data
  return ['committed', 'unchanged', 'not_committed', 'unknown'].includes(String(data.commit))
    && ['usable', 'partial', 'unusable', 'unverified'].includes(String(data.usability))
    && data.delivery === 'not_requested' && Array.isArray(data.diagnostics) && Array.isArray(data.insertedIds)
    ? data as unknown as ContentApplyResult : null
}

export function operationFact(name: string, result?: ToolResult): DocumentOperationResult | null {
  if (result?.kind === 'document-operation') return result.result
  return contentApplyFact(name, result)?.receipt ?? null
}
export function committedFact(name: string, result?: ToolResult): SuccessfulReceipt | null {
  const apply = contentApplyFact(name, result), receipt = operationFact(name, result)
  if (apply && apply.commit !== 'committed' && apply.commit !== 'unchanged') return null
  return receipt && (receipt.status === 'applied' || receipt.status === 'unchanged')
    && typeof receipt.documentId === 'string' && typeof receipt.operationId === 'string'
    && revision(receipt.beforeRevision) && revision(receipt.revision) && receipt.persistence === 'recoverable' ? receipt : null
}
/** An equivalent content result can be known without a receipt, but supplies no invented revision. */
export function knownApplication(name: string, result?: ToolResult): boolean {
  const apply = contentApplyFact(name, result)
  return !!committedFact(name, result) || apply?.commit === 'committed' || apply?.commit === 'unchanged'
}
export function applicationEventFacts(name: string, result?: ToolResult) {
  const receipt = operationFact(name, result), apply = contentApplyFact(name, result)
  if (receipt) return { applicationStatus: receipt.status, documentId: receipt.documentId,
    ...('revision' in receipt ? { revision: receipt.revision } : { error: receipt.message }) }
  if (apply?.commit === 'unchanged') return { applicationStatus: 'unchanged' as const }
  return {}
}

export function saveFact(name: string, result?: ToolResult): SaveReceipt | null {
  if ((name !== 'file.save' && name !== 'project.save') || result?.kind !== 'read' || !record(result.data)) return null
  const data = result.data
  return data.status === 'saved' && typeof data.documentId === 'string' && revision(data.savedRevision)
    && revision(data.currentRevision) && typeof data.dirty === 'boolean'
    && (name !== 'project.save' || typeof data.path === 'string' && typeof data.epoch === 'string')
    ? data as unknown as SaveReceipt : null
}
export const currentSave = (fact: SaveReceipt | null): boolean => !!fact && !fact.dirty && fact.savedRevision === fact.currentRevision

/** Lookup proves the transaction, never runtime usability. Preserve the original apply diagnostics/source. */
export function reconciledToolResult(name: string, previous: ToolResult | undefined, receipt: ToolResult): ToolResult {
  const apply = contentApplyFact(name, previous)
  if (!apply || previous?.kind !== 'read' || receipt.kind !== 'document-operation') return receipt
  return { ...previous, data: { ...apply, receipt: receipt.result,
    commit: receipt.result.status === 'applied' ? 'committed' : receipt.result.status === 'unchanged' ? 'unchanged' : 'not_committed' } }
}
