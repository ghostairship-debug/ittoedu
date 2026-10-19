import type { FlowDocumentRecoveryRecord, FlowDocumentRecoveryIdentity } from '../../shared/flowDocumentRecovery'
import type { AuthoringRecoveryClaim, DocumentHostAPI } from '../../shared/workbench/desktop'
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
export interface FlowDocumentRecoveryTarget extends FlowDocumentRecoveryIdentity { documentId: string; revision: number }
export interface FlowDocumentRecoveryCandidate extends FlowDocumentRecoveryRecord { recovery: { id: string; digest: string } }
export interface FlowDocumentRecoveryPort {
  read(target: FlowDocumentRecoveryTarget): Promise<FlowDocumentRecoveryCandidate[]>
  write(record: FlowDocumentRecoveryRecord, target: FlowDocumentRecoveryTarget): Promise<void>
  clear(target: FlowDocumentRecoveryTarget): Promise<void>
  claim(target: FlowDocumentRecoveryTarget, record: FlowDocumentRecoveryCandidate): Promise<void>
}
/** Flow owns input adaptation; the document host owns recovery identity and persistence. */
export function createFlowDocumentRecoveryPort(host: Pick<DocumentHostAPI, 'readAuthoringDrafts' | 'writeAuthoringDrafts' | 'claimAuthoringDrafts'>): FlowDocumentRecoveryPort {
  const documentEpoch = (target: FlowDocumentRecoveryTarget) => String(target.documentEpoch ?? target.epoch)
  const scope = (target: FlowDocumentRecoveryTarget) => JSON.stringify([target.documentId, target.surfaceId, documentEpoch(target)])
  const unadopted = new Map<string, AuthoringRecoveryClaim[]>()
  const retained = (target: FlowDocumentRecoveryTarget) => {
    const retainedRecords = unadopted.get(scope(target))
    return retainedRecords?.length ? { retainedRecords } : {}
  }
  return {
    async read(target) {
      const drafts = await host.readAuthoringDrafts(target.documentId)
      const records = (drafts?.recoveryRecords ?? []).flatMap(record => record.kind === 'flow'
        ? [{ ...record.value as FlowDocumentRecoveryRecord, recovery: { id: record.id, digest: record.digest } }]
        : [])
      const candidates = [...new Map(records.map(record => [record.recovery.id + ':' + record.recovery.digest, record])).values()]
      unadopted.set(scope(target), candidates.filter(record => record.surfaceId === target.surfaceId).map(record => record.recovery))
      return candidates
    },
    write: (record, target) => host.writeAuthoringDrafts(target.documentId, { flow: [record], flowSurfaceId: target.surfaceId, ...retained(target) }, documentEpoch(target)),
    clear: target => host.writeAuthoringDrafts(target.documentId, { flow: [], flowSurfaceId: target.surfaceId, ...retained(target) }, documentEpoch(target)),
    async claim(target, record) {
      if (!host.claimAuthoringDrafts) throw new Error('正文恢复服务尚未提供采用确认，原稿已保留')
      await host.claimAuthoringDrafts(target.documentId, documentEpoch(target), [record.recovery])
      const key = scope(target)
      unadopted.set(key, (unadopted.get(key) ?? []).filter(candidate => candidate.id !== record.recovery.id || candidate.digest !== record.recovery.digest))
    },
  }
}
export function serializeFlowDocumentRecovery(target: FlowDocumentRecoveryTarget, draft: FlowDocumentDraft): FlowDocumentRecoveryRecord {
  return { documentId: target.documentId, projectId: target.projectId, projectPath: target.projectPath, epoch: target.epoch, ...(target.documentEpoch === undefined ? {} : { documentEpoch: target.documentEpoch }), surfaceId: draft.surfaceId, revision: draft.revision, source: draft.source, composing: draft.composing, diagnostics: draft.diagnostics.map(({ path, ...diagnostic }) => ({ ...diagnostic, ...(path ? { path: path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number') } : {}) })) }
}
export function flowDocumentDraftSaveBlock(draft: FlowDocumentDraft | null | undefined): { ok: false; reason: string } | null {
  if (!draft) return null
  return { ok: false, reason: draft.composing ? '请完成当前中文输入后保存。' : draft.diagnostics[0]?.message || '正文源文尚未应用，请修正后保存；恢复草稿会单独保留。' }
}
export function recoverFlowDocumentDraft(record: FlowDocumentRecoveryRecord, target: FlowDocumentRecoveryTarget): FlowDocumentDraft {
  if (record.projectId !== target.projectId || record.surfaceId !== target.surfaceId || record.revision !== target.revision) throw new Error('旧版本正文恢复稿已保留，可查看原文；当前内容可以正常保存。')
  return { surfaceId: record.surfaceId, revision: record.revision, source: record.source, diagnostics: structuredClone(record.diagnostics), composing: false }
}
