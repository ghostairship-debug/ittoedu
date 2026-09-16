import { flowRecoveryStorageIdentity } from '../../shared/flowDocumentRecovery'
import type { FlowDocumentRecoveryAPI, FlowDocumentRecoveryRecord, FlowDocumentRecoveryIdentity } from '../../shared/flowDocumentRecovery'
export type { FlowDocumentRecoveryRecord } from '../../shared/flowDocumentRecovery'
import type { DocumentDiagnostic } from '../../shared/document/ports'

/** App-local source draft. This shape must never enter a V9 archive or Published payload. */
export interface FlowDocumentDraft {
  surfaceId: string
  revision: number
  source: string
  diagnostics: DocumentDiagnostic[]
  composing: boolean
}
export interface FlowDocumentRecoveryTarget extends FlowDocumentRecoveryIdentity { revision: number }
export type FlowDocumentRecoveryPort = FlowDocumentRecoveryAPI
export function serializeFlowDocumentRecovery(target: FlowDocumentRecoveryTarget, draft: FlowDocumentDraft): FlowDocumentRecoveryRecord {
  return { projectId: target.projectId, projectPath: target.projectPath, epoch: target.epoch, surfaceId: draft.surfaceId, revision: draft.revision, source: draft.source, composing: draft.composing, diagnostics: draft.diagnostics.map(({ path, ...diagnostic }) => ({ ...diagnostic, ...(path ? { path: path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number') } : {}) })) }
}
export function flowDocumentDraftSaveBlock(draft: FlowDocumentDraft | null | undefined): { ok: false; reason: string } | null {
  if (!draft) return null
  return { ok: false, reason: draft.composing ? '请完成当前中文输入后保存。' : draft.diagnostics[0]?.message || '正文源文尚未应用，请修正后保存；恢复草稿会单独保留。' }
}
export function recoverFlowDocumentDraft(record: FlowDocumentRecoveryRecord, target: FlowDocumentRecoveryTarget): FlowDocumentDraft {
  if (flowRecoveryStorageIdentity(record) !== flowRecoveryStorageIdentity(target) || record.revision !== target.revision) throw new Error('发现其他版本的正文恢复稿，已保留在本机；请先恢复对应版本的课件。')
  return { surfaceId: record.surfaceId, revision: record.revision, source: record.source, diagnostics: structuredClone(record.diagnostics), composing: false }
}
