import { documentDigest } from '../../../core/documents/documentDigest'
import type { DocumentSession } from '../../../core/documents/DocumentSession'
import type { ToolGateway, ToolResult } from '../../../shared/workbench/tools'
import type { DocumentOperationResult } from '../../../shared/workbench/document'
import { prepareHtmlCourseCandidate, type HtmlCourseCandidate } from './prepareHtmlCourseCandidate'
import type { HtmlImportNetworkGrants } from './htmlImportNetworkGrants'

import type { HtmlImportDestination } from '../../../shared/workbench/toolPorts'
import type { HtmlSectionPage } from './splitHtmlSections'

export interface HtmlImportRequest {
  operationId: string
  runId: string
  targetHandle: string
  sourcePath: string
  locationId?: string
  anchorBlockId?: string
  rootDir?: string
  sourceHtml?: string
  sections?: readonly HtmlSectionPage[]
  destinations?: readonly HtmlImportDestination[]
  mode?: 'whole' | 'sections'
  commitCallId?: string
}
export interface HtmlImportTicket {
  operationId: string
  requestDigest: string
  runId: string
  jobId: string
  target: HtmlCourseCandidate['target']
  sourcePath: string
  instanceId: string
  commitCallId?: string
  pages?: readonly { order: number; location: string; runtimeId: string }[]
}
type ImportRecord = {
  digest: string; candidate: HtmlCourseCandidate; runId: string; jobId: string
  state: 'prepared' | 'checking' | 'ready' | 'committing' | 'cancelled' | 'failed' | 'committed'
  artifactId?: string; result?: DocumentOperationResult; commitCallId?: string
}
type BuildGateway = Pick<ToolGateway, 'execute'> & { stop(runId: string): Promise<void>; executeInternalBuild?: ToolGateway['execute'] }

function read(result: ToolResult): Record<string, unknown> {
  if (result.kind === 'error') throw new Error(result.message)
  if (result.kind !== 'read' || !result.data || typeof result.data !== 'object') throw new Error('受控构建未返回阶段结果')
  return result.data as Record<string, unknown>
}

/** Uses the installed S13 Gateway job and artifact path. No private admission or document writer. */
export class HtmlImportService {
  private readonly records = new Map<string, ImportRecord>()
  private readonly preparing = new Map<string, { digest: string; promise: Promise<HtmlImportTicket> }>()
  constructor(private readonly ports: {
    session: DocumentSession
    gateway: BuildGateway
    networkGrants?: HtmlImportNetworkGrants
    cancelJob?: (runId: string, jobId: string) => Promise<void>
    beforeCall?: (runId: string, callId: string, name: string, input: unknown) => Promise<void>
    onJobCreated?: (runId: string, jobId: string) => Promise<void>
  }) {}

  private async call(runId: string, callId: string, name: string, input: unknown): Promise<ToolResult> {
    await this.ports.beforeCall?.(runId, callId, name, input)
    return (this.ports.gateway.executeInternalBuild ?? this.ports.gateway.execute).call(this.ports.gateway, runId, callId, { name, input })
  }

  async prepare(request: HtmlImportRequest): Promise<HtmlImportTicket> {
    if (!request.operationId || !request.runId || !request.targetHandle || !request.sourcePath || (!request.locationId && (!request.sections || !request.destinations)))
      throw new Error('HTML 导入缺少任务、操作、文档授权、来源或目标')
    const digest = documentDigest({
      runId: request.runId,
      targetHandle: request.targetHandle,
      sourcePath: request.sourcePath,
      locationId: request.locationId ?? null,
      anchorBlockId: request.anchorBlockId ?? null,
      rootDir: request.rootDir ?? null,
      sections: request.sections ? request.sections.length : null,
      destinations: request.destinations ? request.destinations.map(d => d.kind) : null,
    })
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
      const candidate = await prepareHtmlCourseCandidate({
        snapshot: baseline,
        sourcePath: request.sourcePath,
        locationId: request.locationId,
        anchorBlockId: request.anchorBlockId,
        rootDir: request.rootDir,
        sourceHtml: request.sourceHtml,
        sections: request.sections,
        destinations: request.destinations,
        mode: request.mode,
        operationId: request.operationId,
      })
      if (this.ports.session.read().epoch !== baseline.epoch || this.ports.session.read().revision !== baseline.revision) throw new Error('HTML 导入目标已改变；未建立构建任务')
      if (candidate.networkOrigins.length && !this.ports.networkGrants) throw new Error('HTML 导入网络授权服务不可用')
      if (candidate.networkOrigins.length) this.ports.networkGrants!.register(request.runId, {
        documentId: baseline.documentId, epoch: baseline.epoch, revision: baseline.revision, origins: candidate.networkOrigins,
      })
      let job: unknown
      try {
        job = read(await this.call(request.runId, `html:${request.operationId}:create`, 'build.create', { target: request.targetHandle })).job
      } finally {
        this.ports.networkGrants?.clear(request.runId)
      }
      if (typeof job !== 'string') throw new Error('受控构建未返回任务身份')
      await this.ports.onJobCreated?.(request.runId, job)
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
          read(await this.call(request.runId, `html:${request.operationId}:asset:${assetId}`, 'build.write',
            { job, path: meta.path, encoding: 'base64', content }))
        }
        read(await this.call(request.runId, `html:${request.operationId}:project`, 'build.write',
          { job, path: 'project.json', content: JSON.stringify(candidate.model.project) }))
        if (request.commitCallId) record.commitCallId = request.commitCallId
        return this.ticket(request.operationId, record, request.commitCallId)
      } catch (error) { record.state = 'failed'; throw error }
    })()
    this.preparing.set(request.operationId, { digest, promise })
    try { return await promise } finally { this.preparing.delete(request.operationId) }
  }

  private ticket(operationId: string, record: ImportRecord, commitCallId?: string): HtmlImportTicket {
    return { operationId, requestDigest: record.digest, runId: record.runId, jobId: record.jobId,
      target: { ...record.candidate.target }, sourcePath: record.candidate.sourcePath, instanceId: record.candidate.instanceId,
      commitCallId: commitCallId ?? record.commitCallId, pages: record.candidate.pages }
  }

  notices(ticket: HtmlImportTicket): string[] {
    return this.require(ticket).candidate.diagnostics.filter(item => item.level === 'warning').map(item => item.message)
  }

  warnings(ticket: HtmlImportTicket): { code: string; message: string }[] {
    const grouped = new Map<string, { message: string; count: number }>()
    for (const item of this.require(ticket).candidate.diagnostics) {
      if (item.level !== 'warning') continue
      const previous = grouped.get(item.code)
      if (previous) previous.count++
      else grouped.set(item.code, { message: item.message, count: 1 })
    }
    return [...grouped].slice(0, 5).map(([code, item]) => {
      const prefix = `[${code}] `, suffix = `（共 ${item.count} 处）`
      return { code, message: prefix + item.message.slice(0, 200 - prefix.length - suffix.length) + suffix }
    })
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
    if (this.ports.cancelJob) {
      await this.ports.cancelJob(record.runId, record.jobId)
    } else {
      await this.ports.gateway.stop(record.runId)
    }
  }

  async admit(ticket: HtmlImportTicket): Promise<void> {
    const record = this.require(ticket)
    if (record.state === 'ready' || record.state === 'committed') return
    if (record.state !== 'prepared') throw new Error('HTML 候选不可准入')
    record.state = 'checking'
    try {
      const checked = read(await this.call(record.runId, `html:${ticket.operationId}:check`, 'build.check', { job: record.jobId }))
      if (record.state !== 'checking') throw new Error('HTML 导入已取消')
      if (checked.status !== 'ready' || typeof checked.artifact !== 'string') {
        const logs = read(await this.call(record.runId, `html:${ticket.operationId}:logs`, 'build.logs', { job: record.jobId, after: 0, limit: 5000 }))
        const entries = logs.entries as { level: string; message: string }[]
        const reasons = entries.filter(entry => entry.level === 'error').slice(-3).map(entry => entry.message.slice(0, 200))
        throw new Error(`HTML 候选未通过受控构建：${String(checked.status)}${reasons.length ? '\n' + reasons.join('\n') : ''}`)
      }
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
      const commitCallId = ticket.commitCallId ?? `html:${ticket.operationId}:commit`
      const imported = await this.call(record.runId, commitCallId, 'build.import', { job: record.jobId, artifact: record.artifactId })
      if (imported.kind === 'error') throw new Error(imported.message)
      if (imported.kind !== 'document-operation') throw new Error('受控导入未返回正式文档回执')
      if (imported.result.status === 'applied' || imported.result.status === 'unchanged') {
        record.result = imported.result; record.state = 'committed'
      } else record.state = 'failed'
      return imported.result
    } catch (error) { record.state = 'failed'; throw error }
  }
}
