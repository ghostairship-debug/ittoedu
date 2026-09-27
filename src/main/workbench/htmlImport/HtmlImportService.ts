import { documentDigest } from '../../../core/documents/documentDigest'
import type { DocumentSession } from '../../../core/documents/DocumentSession'
import type { ToolGateway, ToolResult } from '../../../shared/workbench/tools'
import type { DocumentOperationResult } from '../../../shared/workbench/document'
import { prepareHtmlCourseCandidate, type HtmlCourseCandidate } from './prepareHtmlCourseCandidate'

export interface HtmlImportRequest {
  operationId: string
  runId: string
  targetHandle: string
  sourcePath: string
  locationId: string
  rootDir?: string
}
export interface HtmlImportTicket {
  operationId: string
  requestDigest: string
  runId: string
  jobId: string
  target: HtmlCourseCandidate['target']
  sourcePath: string
  instanceId: string
}
type ImportRecord = {
  digest: string; candidate: HtmlCourseCandidate; runId: string; jobId: string
  state: 'prepared' | 'checking' | 'ready' | 'committing' | 'cancelled' | 'failed' | 'committed'
  artifactId?: string; result?: DocumentOperationResult
}
type BuildGateway = Pick<ToolGateway, 'execute'> & { stop(runId: string): Promise<void> }

function read(result: ToolResult): Record<string, unknown> {
  if (result.kind === 'error') throw new Error(result.message)
  if (result.kind !== 'read' || !result.data || typeof result.data !== 'object') throw new Error('受控构建未返回阶段结果')
  return result.data as Record<string, unknown>
}

/** Uses the installed S13 Gateway job and artifact path. No private admission or document writer. */
export class HtmlImportService {
  private readonly records = new Map<string, ImportRecord>()
  private readonly preparing = new Map<string, { digest: string; promise: Promise<HtmlImportTicket> }>()
  constructor(private readonly ports: { session: DocumentSession; gateway: BuildGateway }) {}

  private call(runId: string, callId: string, name: string, input: unknown): Promise<ToolResult> {
    return this.ports.gateway.execute(runId, callId, { name, input })
  }

  async prepare(request: HtmlImportRequest): Promise<HtmlImportTicket> {
    if (!request.operationId || !request.runId || !request.targetHandle || !request.sourcePath || !request.locationId)
      throw new Error('HTML 导入缺少任务、操作、文档授权、来源或目标')
    const digest = documentDigest({ runId: request.runId, targetHandle: request.targetHandle, sourcePath: request.sourcePath,
      locationId: request.locationId, rootDir: request.rootDir ?? null })
    const existing = this.records.get(request.operationId)
    if (existing) {
      if (existing.digest !== digest) throw new Error('同一 HTML 导入票据不能改变任务、来源或目标')
      return this.ticket(request.operationId, existing)
    }
    const inFlight = this.preparing.get(request.operationId)
    if (inFlight) {
      if (inFlight.digest !== digest) throw new Error('同一 HTML 导入票据不能改变任务、来源或目标')
      return inFlight.promise
    }
    const promise = (async () => {
      const baseline = this.ports.session.read()
      const candidate = await prepareHtmlCourseCandidate({ snapshot: baseline, sourcePath: request.sourcePath,
        locationId: request.locationId, ...(request.rootDir ? { rootDir: request.rootDir } : {}) })
      if (this.ports.session.read().revision !== baseline.revision) throw new Error('HTML 导入目标已改变；未建立构建任务')
      const job = read(await this.call(request.runId, `${request.operationId}:create`, 'build.create', { target: request.targetHandle })).job
      if (typeof job !== 'string') throw new Error('受控构建未返回任务身份')
      const record: ImportRecord = { digest, candidate, runId: request.runId, jobId: job, state: 'prepared' }
      this.records.set(request.operationId, record)
      try {
        if (this.ports.session.read().epoch !== baseline.epoch || this.ports.session.read().revision !== baseline.revision)
          throw new Error('HTML 导入目标在创建暂存期间改变')
        // S13 scratch already contains the frozen baseline. Write only new/changed binary resources.
        for (const [assetId, meta] of Object.entries(candidate.model.project.assets)) {
          const bytes = candidate.model.resources.assets[assetId]
          const old = baseline.model.kind === 'course-v9' ? baseline.model.resources.assets[assetId] : undefined
          if (!bytes || old && documentDigest(old) === documentDigest(bytes)) continue
          const content = Buffer.from(bytes).toString('base64')
          if (content.length > 24 * 1024 * 1024) throw new Error(`HTML 素材 ${meta.filename} 超过受控写入单文件上限`)
          read(await this.call(request.runId, `${request.operationId}:asset:${assetId}`, 'build.write',
            { job, path: meta.path, encoding: 'base64', content }))
        }
        read(await this.call(request.runId, `${request.operationId}:project`, 'build.write',
          { job, path: 'project.json', content: JSON.stringify(candidate.model.project) }))
        return this.ticket(request.operationId, record)
      } catch (error) { record.state = 'failed'; throw error }
    })()
    this.preparing.set(request.operationId, { digest, promise })
    try { return await promise } finally { this.preparing.delete(request.operationId) }
  }

  private ticket(operationId: string, record: ImportRecord): HtmlImportTicket {
    return { operationId, requestDigest: record.digest, runId: record.runId, jobId: record.jobId,
      target: { ...record.candidate.target }, sourcePath: record.candidate.sourcePath, instanceId: record.candidate.instanceId }
  }

  private require(ticket: HtmlImportTicket): ImportRecord {
    const record = this.records.get(ticket.operationId)
    if (!record || record.digest !== ticket.requestDigest || record.runId !== ticket.runId || record.jobId !== ticket.jobId
      || documentDigest(record.candidate.target) !== documentDigest(ticket.target)
      || record.candidate.sourcePath !== ticket.sourcePath || record.candidate.instanceId !== ticket.instanceId)
      throw new Error('HTML 导入票据无效')
    return record
  }

  async cancel(ticket: HtmlImportTicket): Promise<void> {
    const record = this.require(ticket)
    if (record.state === 'committed' || record.state === 'committing') return
    record.state = 'cancelled'
    await this.ports.gateway.stop(record.runId)
  }

  async admit(ticket: HtmlImportTicket): Promise<void> {
    const record = this.require(ticket)
    if (record.state === 'ready' || record.state === 'committed') return
    if (record.state !== 'prepared') throw new Error('HTML 候选不可准入')
    record.state = 'checking'
    try {
      const checked = read(await this.call(record.runId, `${ticket.operationId}:check`, 'build.check', { job: record.jobId }))
      if (record.state !== 'checking') throw new Error('HTML 导入已取消')
      if (checked.status !== 'ready' || typeof checked.artifact !== 'string') throw new Error(`HTML 候选未通过受控构建：${String(checked.status)}`)
      record.artifactId = checked.artifact
      record.state = 'ready'
    } catch (error) { if (this.records.get(ticket.operationId)?.state !== 'cancelled') record.state = 'failed'; throw error }
  }

  async commit(ticket: HtmlImportTicket): Promise<DocumentOperationResult> {
    const record = this.require(ticket)
    if (record.result) return record.result
    if (record.state !== 'ready' || !record.artifactId) throw new Error('HTML 候选尚未通过受控准入或已取消')
    const { candidate } = record, current = this.ports.session.read()
    if (current.documentId !== candidate.target.documentId || current.epoch !== candidate.target.epoch
      || current.revision !== candidate.target.baseRevision || current.model.kind !== 'course-v9'
      || current.model.project.id !== candidate.target.projectId) throw new Error('HTML 导入目标已改变；未写入正式文档')
    record.state = 'committing'
    try {
      const imported = await this.call(record.runId, ticket.operationId, 'build.import', { job: record.jobId, artifact: record.artifactId })
      if (imported.kind === 'error') throw new Error(imported.message)
      if (imported.kind !== 'document-operation') throw new Error('受控导入未返回正式文档回执')
      if (imported.result.status === 'applied' || imported.result.status === 'unchanged') {
        record.result = imported.result; record.state = 'committed'
      } else record.state = 'failed'
      return imported.result
    } catch (error) { record.state = 'failed'; throw error }
  }
}
