import { createHash } from 'node:crypto'
import { documentDigest } from '../../../core/documents/documentDigest'
import { applyDynamicInstanceCaptures } from '../../../core/tools/dynamicCaptureAssets'
import type { DocumentSession } from '../../../core/documents/DocumentSession'
import { validateCourseProjectArchiveData } from '../../../core/drivers/codecs/courseProjectArchive'
import { dynamicAdmissionPayloadSchema } from '../../../shared/dynamicAdmissionContract'
import type { BuildAdmissionPort } from '../../../shared/workbench/build'
import type { DocumentOperationResult } from '../../../shared/workbench/document'
import { prepareImageResource } from '../admittedImageResource'
import { prepareHtmlCourseCandidate, type HtmlCourseCandidate } from './prepareHtmlCourseCandidate'

export interface HtmlImportRequest {
  operationId: string
  sourcePath: string
  locationId: string
  rootDir?: string
  runId?: string
}
export interface HtmlImportTicket { operationId: string; requestDigest: string; target: HtmlCourseCandidate['target']; sourcePath: string; instanceId: string }
type Record = { digest: string; candidate: HtmlCourseCandidate; state: 'prepared' | 'admitting' | 'ready' | 'committing' | 'cancelled' | 'failed' | 'committed'; controller: AbortController; result?: DocumentOperationResult }

/** Main-owned coordinator. Only DocumentSession.execute can change the formal project. */
export class HtmlImportService {
  private readonly records = new Map<string, Record>()
  private readonly preparing = new Map<string, { digest: string; promise: Promise<HtmlImportTicket> }>()
  constructor(private readonly ports: { session: DocumentSession; admission: BuildAdmissionPort }) {}

  async prepare(request: HtmlImportRequest): Promise<HtmlImportTicket> {
    if (!request.operationId || !request.sourcePath || !request.locationId) throw new Error('HTML 导入缺少操作、来源或目标')
    const digest = documentDigest({ sourcePath: request.sourcePath, locationId: request.locationId, rootDir: request.rootDir ?? null, runId: request.runId ?? null })
    const existing = this.records.get(request.operationId)
    if (existing) {
      if (existing.digest !== digest) throw new Error('同一 HTML 导入票据不能改变来源或目标')
      return this.ticket(request.operationId, existing)
    }
    const inFlight = this.preparing.get(request.operationId)
    if (inFlight) {
      if (inFlight.digest !== digest) throw new Error('同一 HTML 导入票据不能改变来源或目标')
      return inFlight.promise
    }
    const promise = (async () => {
      const controller = new AbortController()
      const candidate = await prepareHtmlCourseCandidate({ snapshot: this.ports.session.read(), sourcePath: request.sourcePath,
        locationId: request.locationId, ...(request.rootDir ? { rootDir: request.rootDir } : {}), signal: controller.signal })
      const record: Record = { digest, candidate, state: 'prepared', controller }
      this.records.set(request.operationId, record)
      return this.ticket(request.operationId, record)
    })()
    this.preparing.set(request.operationId, { digest, promise })
    try { return await promise } finally { this.preparing.delete(request.operationId) }
  }

  private ticket(operationId: string, record: Record): HtmlImportTicket {
    return { operationId, requestDigest: record.digest, target: { ...record.candidate.target },
      sourcePath: record.candidate.sourcePath, instanceId: record.candidate.instanceId }
  }

  private require(ticket: HtmlImportTicket): Record {
    const record = this.records.get(ticket.operationId)
    if (!record || record.digest !== ticket.requestDigest || documentDigest(record.candidate.target) !== documentDigest(ticket.target)
      || record.candidate.sourcePath !== ticket.sourcePath || record.candidate.instanceId !== ticket.instanceId) throw new Error('HTML 导入票据无效')
    return record
  }

  cancel(ticket: HtmlImportTicket): void {
    const record = this.require(ticket)
    if (record.state === 'committed' || record.state === 'committing') return
    record.state = 'cancelled'
    record.controller.abort(new Error('HTML 导入已取消'))
  }

  async admit(ticket: HtmlImportTicket): Promise<void> {
    const record = this.require(ticket)
    if (record.state === 'ready' || record.state === 'committed') return
    if (record.state !== 'prepared') throw new Error('HTML 候选不可准入')
    record.state = 'admitting'
    try {
      const { candidate } = record
      const payload = dynamicAdmissionPayloadSchema.parse({ project: candidate.model.project, assetFiles: candidate.model.resources.assets,
        componentFiles: Object.fromEntries(Object.entries(candidate.model.resources.components).map(([key, files]) =>
          [key, Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, Buffer.from(bytes).toString('base64')]))])),
        targets: [{ locationId: candidate.target.locationId, instanceIds: [candidate.instanceId] }],
        observeBehavior: true, captureInstances: true, verificationMode: 'full-admission' })
      const result = await this.ports.admission.run(payload, record.controller.signal)
      record.controller.signal.throwIfAborted()
      if (!result.ok || !result.processId || !result.behaviorEvidence?.length) throw new Error(result.message || 'HTML Runtime 未通过真实宿主准入')
      const applied = applyDynamicInstanceCaptures({ project: candidate.model.project, assetFiles: candidate.model.resources.assets,
        componentPackages: {}, targets: payload.targets, captures: result.captures ?? [], refreshInstanceIds: new Set([candidate.instanceId]) })
      for (const change of applied.assetFileChanges) if (change.after) {
        const meta = applied.project.assets[change.assetId]!
        await prepareImageResource({ bytes: change.after, mimeType: meta.mimeType, filename: meta.filename }, () => change.assetId)
        record.controller.signal.throwIfAborted()
      }
      validateCourseProjectArchiveData({ project: applied.project, assetFiles: applied.assetFiles,
        componentFiles: candidate.model.resources.components })
      candidate.model = { ...candidate.model, project: applied.project,
        resources: { ...candidate.model.resources, assets: applied.assetFiles } }
      if (record.state !== 'admitting') throw new Error('HTML 导入已取消')
      record.state = 'ready'
    } catch (error) {
      if (!record.controller.signal.aborted) record.state = 'failed'
      throw error
    }
  }

  async commit(ticket: HtmlImportTicket, runId?: string): Promise<DocumentOperationResult> {
    const record = this.require(ticket)
    if (record.result) return record.result
    if (record.state !== 'ready') throw new Error('HTML 候选尚未通过准入或已取消')
    // No asynchronous work may separate this observation from DocumentSession's serial, final CAS.
    const { candidate } = record
    const current = this.ports.session.read()
    if (current.documentId !== candidate.target.documentId || current.epoch !== candidate.target.epoch
      || current.revision !== candidate.target.baseRevision || current.model.kind !== 'course-v9'
      || current.model.project.id !== candidate.target.projectId) throw new Error('HTML 导入目标已改变；未写入正式文档')
    record.state = 'committing'
    const result = await this.ports.session.execute({ documentId: candidate.target.documentId, epoch: candidate.target.epoch,
      baseRevision: candidate.target.baseRevision, operationId: ticket.operationId, actor: 'human', ...(runId ? { runId } : {}),
      requestDigest: createHash('sha256').update(ticket.requestDigest).digest('hex'),
      mutation: { type: 'command', command: { type: 'course.replace', project: candidate.model.project, resources: candidate.model.resources } } })
    if (result.status === 'applied' || result.status === 'unchanged') { record.state = 'committed'; record.result = result }
    else record.state = 'failed'
    return result
  }
}
