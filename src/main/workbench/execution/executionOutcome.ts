import type { ExecutionRunRecord, ExecutionToolRecord } from '../../../shared/workbench/execution'
import type { ToolResult } from '../../../shared/workbench/tools'
import { USER_QUESTION_TOOL } from '../../../shared/workbench/userQuestion'
import { agentFileMutationNames } from '../../../core/tools/AgentFileTools'

export const committed = (result?: ToolResult): result is Extract<ToolResult, { kind: 'document-operation' }> =>
  result?.kind === 'document-operation' && (result.result.status === 'applied' || result.result.status === 'unchanged')

export const fileCreated = (name: string, result?: ToolResult): boolean => name === 'file.create' && result?.kind === 'read'
  && !!result.data && typeof result.data === 'object'
  && (result.data as { operation?: { status?: unknown } }).operation?.status === 'success'

export interface ServiceToolOutcome { status: 'failed' | 'unknown' | 'pending' | 'stopped' | 'saved' | 'generated' | 'written'; message: string }
const fileMutations = new Set<string>(agentFileMutationNames)

/** Only tools whose read receipt is itself a service job use its status for task settlement. */
export const serviceToolOutcome = (name: string, result?: ToolResult): ServiceToolOutcome | null => {
  if (name === 'html.import' && result?.kind === 'error' && result.code === 'html-import-cancelled')
    return { status: 'stopped', message: result.message }
  if (result?.kind !== 'read' || !result.data || typeof result.data !== 'object') return null
  const data = result.data as Record<string, unknown>
  if (fileMutations.has(name) && data.operation && typeof data.operation === 'object') {
    const operation = data.operation as { status?: unknown; items?: { error?: { message?: string } }[] }
    if (operation.status === 'failed' || operation.status === 'cancelled' || operation.status === 'partial')
      return { status: 'failed', message: operation.items?.find(item => item.error?.message)?.error?.message ?? '文件整理未完整成功' }
  }
  if (fileMutations.has(name) && data.documentResult && typeof data.documentResult === 'object') {
    const document = data.documentResult as { status?: unknown; message?: unknown }
    if (document.status !== 'applied' && document.status !== 'unchanged')
      return { status: 'failed', message: typeof document.message === 'string' ? document.message : '文件文档事务未提交' }
  }
  if (name === 'file.save' && data.status === 'saved') return { status: 'saved', message: data.dirty === true ? '文件已保存到原版本，期间的新修改仍未保存' : '文件已保存' }
  if (name === 'artifact.save') {
    if (data.status === 'written') return { status: 'written', message: '作业成果已保存为新文件' }
    if (data.status === 'unknown') return { status: 'unknown', message: '成果交付回执未知，请核对目标文件，不要重试同一操作' }
    if (data.status === 'conflict' || data.status === 'stopped') return { status: 'failed', message: typeof data.message === 'string' ? data.message : '成果未保存' }
  }
  if (name === 'document.export' && data.status === 'generated') return { status: 'generated', message: '导出内容已生成，尚未写入文件' }
  if (name === 'document.export' && data.status === 'written') return { status: 'written', message: '导出文件已写入' }
  if (name === 'build.compile' && data.ok === false) return { status: 'failed', message: typeof data.message === 'string' ? data.message : '构建语法编译未通过' }
  if (name === 'build.check' && (data.status === 'failed' || data.status === 'cancelled' || data.status === 'exhausted')) {
    return { status: 'failed', message: data.status === 'failed' ? '构建检查未通过，请读取构建日志' : data.status === 'cancelled' ? '构建检查已取消' : '构建检查已耗尽预算' }
  }
  if (name === 'web.search' || name === 'web.open' || name === 'mcp.discover' || name === 'mcp.invoke'
    || name === 'media.start' || name === 'compute.run' || name === 'delegate.start') {
    const message = typeof data.reason === 'string' ? data.reason.slice(0, 240) : '外部能力未返回可用成果'
    if (data.status === 'unknown') return { status: 'unknown', message }
    if (name === 'compute.run' && (data.status === 'preparing' || data.status === 'running'))
      return { status: 'pending', message: '受限计算作业仍在运行，请等待并读取成果' }
    if (name === 'delegate.start' && (data.status === 'preparing' || data.status === 'running' || data.status === 'ready'))
      return { status: 'pending', message: '外部委派须等待并回读封存成果' }
    if (data.status === 'not-configured' || data.status === 'rejected' || data.status === 'failed'
      || data.status === 'stopped' || data.status === 'unconfigured' || data.status === 'access-required' || data.status === 'needs-material-reader'
      || (name === 'compute.run' || name === 'delegate.start') && (data.status === 'cancelled' || data.status === 'unapplied'))
      return { status: 'failed', message }
  }
  if (name === 'image.generate' || name === 'image.edit') {
    const failure = data.failure && typeof data.failure === 'object' ? data.failure as Record<string, unknown> : null
    const message = typeof failure?.message === 'string' && failure.message.trim() ? failure.message.slice(0, 240) : undefined
    // Stopping after dispatch leaves the provider outcome and charge unknown.
    // The user-facing stop flag must not authorize a fresh paid call ID.
    if (data.status === 'unknown' || failure?.outcome === 'unknown') return { status: 'unknown', message: message ?? '图片请求结果未知，未自动重试' }
    if (data.stopped === true) return { status: 'stopped', message: message ?? '图片任务已停止，成果尚未应用' }
    if (data.status === 'failed') return { status: 'failed', message: message ?? '图片请求失败，未得到可应用成果' }
    if (data.status === 'stopped' || data.status === 'unapplied') return { status: 'stopped', message: message ?? '图片任务已停止，成果尚未应用' }
    if (data.status === 'preparing' || data.status === 'running') return { status: 'pending', message: '图片作业仍在运行，请等待并读取成果' }
  }
  return null
}

export const toolFailed = (name: string, result?: ToolResult) => result?.kind === 'error' ||
  result?.kind === 'document-operation' && !committed(result) ||
  ['failed', 'unknown', 'pending', 'stopped'].includes(serviceToolOutcome(name, result)?.status ?? '')

const pendingJob = (tool: ExecutionToolRecord): { kind: 'image' | 'compute' | 'delegation'; id: string } | null => {
  if (serviceToolOutcome(tool.call.name, tool.result)?.status !== 'pending' || tool.result?.kind !== 'read') return null
  const data = tool.result.data as { job?: unknown }
  return (tool.call.name === 'image.generate' || tool.call.name === 'image.edit'
    || tool.call.name === 'compute.run' || tool.call.name === 'delegate.start')
    && typeof data.job === 'string' ? { kind: tool.call.name === 'compute.run' ? 'compute'
      : tool.call.name === 'delegate.start' ? 'delegation' : 'image', id: data.job } : null
}
const terminalJobReceipt = (tool: ExecutionToolRecord, pending: { kind: 'image' | 'compute' | 'delegation'; id: string }): boolean => {
  if (tool.result?.kind !== 'read' || toolFailed(tool.call.name, tool.result)) return false
  const data = tool.result.data as { job?: unknown; jobId?: unknown; kind?: unknown; status?: unknown; terminal?: unknown;
    sourceKind?: unknown; sourceId?: unknown; verifiedBytes?: unknown } | null
  if (pending.kind === 'delegation') return tool.call.name === 'delegate.read' && data?.job === pending.id
    && data.status === 'read' && data.verifiedBytes === true
  if (tool.call.name === 'artifact.save') return data?.status === 'written' && data.sourceKind === pending.kind
    && typeof data.sourceId === 'string' && data.sourceId.startsWith(`${pending.id}@`)
  if (!data || (data.job ?? data.jobId) !== pending.id) return false
  if (tool.call.name === 'image.status') return pending.kind === 'image' && data.status === 'ready'
  if (tool.call.name !== 'job.wait' && tool.call.name !== 'job.status') return false
  return data.kind === pending.kind && data.terminal === true
    && data.status === 'ready'
}

function jobOf(tool: ExecutionToolRecord): string | null {
  if (!tool.call.name.startsWith('build.')) return null
  const input = tool.call.input
  if (input && typeof input === 'object' && typeof (input as { job?: unknown }).job === 'string') return (input as { job: string }).job
  const result = tool.result
  if (tool.call.name === 'build.create' && result?.kind === 'read' && result.data && typeof result.data === 'object'
    && typeof (result.data as { job?: unknown }).job === 'string') return (result.data as { job: string }).job
  return null
}

function importedJobs(record: ExecutionRunRecord): Set<string> {
  return new Set(record.tools.flatMap(tool => tool.call.name === 'build.import' && committed(tool.result) && jobOf(tool)
    ? [jobOf(tool)!] : []))
}

/** A final canonical import supersedes earlier failed attempts for that same scratch job. */
const exploratoryNames = new Set(['read', 'inspect', 'listChildren', 'file.list', 'file.search', 'file.grep',
  'material.list', 'material.find', 'tools.load'])
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, stable(child)]))
  return value
}
/** Identical operation and arguments identify a retry of one concrete request, never a nearby success. */
const requestKey = (tool: ExecutionToolRecord) => JSON.stringify([tool.call.name, stable(tool.call.input)])
const delivered = (tool: ExecutionToolRecord) => !toolFailed(tool.call.name, tool.result)
  && (committed(tool.result) || fileCreated(tool.call.name, tool.result)
    || tool.result?.kind === 'read' && (tool.call.name === 'file.read' || tool.call.name === 'material.read'
      || tool.call.name === 'image.generate' && (tool.result.data as { status?: unknown })?.status === 'ready'
      || tool.call.name === 'image.edit' && (tool.result.data as { status?: unknown })?.status === 'ready'
      || serviceToolOutcome(tool.call.name, tool.result)?.status === 'saved'
      || serviceToolOutcome(tool.call.name, tool.result)?.status === 'written'
      || fileMutations.has(tool.call.name)))

function unresolvedToolFailures(record: ExecutionRunRecord): ExecutionToolRecord[] {
  const lastImportByJob = new Map<string, number>()
  record.tools.forEach((tool, index) => {
    const job = jobOf(tool)
    if (tool.call.name === 'build.import' && committed(tool.result) && job) lastImportByJob.set(job, index)
  })
  const hasDelivery = record.tools.some(tool => delivered(tool)
    && tool.call.name !== 'file.read' && tool.call.name !== 'material.read')
  return record.tools.filter((tool, index) => {
    // An unanswered or malformed question changed nothing; it is not an unfinished document operation.
    if (tool.call.name === USER_QUESTION_TOOL || !toolFailed(tool.call.name, tool.result)) return false
    // A modification the user declined is the user's decision, not an unfinished operation.
    if (tool.result?.kind === 'error' && tool.result.code === 'user-denied') return false
    const pending = pendingJob(tool)
    if (pending && record.tools.slice(index + 1).some(later => terminalJobReceipt(later, pending))) return false
    const job = jobOf(tool)
    if (tool.call.name.startsWith('build.') && job && (lastImportByJob.get(job) ?? -1) > index) return false
    // An unknown external effect cannot be repaired by issuing a second call ID.
    if (serviceToolOutcome(tool.call.name, tool.result)?.status === 'unknown'
      || tool.result?.kind === 'error' && /outcome-unknown/.test(tool.result.code)) return true
    if (record.tools.slice(index + 1).some(later => requestKey(later) === requestKey(tool)
      && later.state === 'returned' && !toolFailed(later.call.name, later.result)
      && (committed(later.result) || later.result?.kind === 'read'))) return false
    // A malformed model call never reached a tool. Once a concrete result was
    // delivered, keep that attempt in history without letting its syntax alone
    // downgrade the task. Failed requested writes and unknown effects still do.
    if (hasDelivery && tool.result?.kind === 'error' && tool.result.code === 'invalid-tool-arguments') return false
    // Invalid exploratory handles stay in the history but do not turn a verified
    // final delivery into a partial task. Other failed deliverables remain partial.
    if (hasDelivery && exploratoryNames.has(tool.call.name) && tool.result?.kind === 'error'
      && ['invalid-target', 'target-conflict', 'tool-load-failed'].includes(tool.result.code)) return false
    return true
  })
}

interface NewFileDeliveryFact { documentId: string; label: string; revision: number | null; savedRevision: number | null }

/** Only this run's receipts count: a created path is not evidence that subsequent edits reached that file. */
export function newFileDeliveryFacts(record: ExecutionRunRecord): NewFileDeliveryFact[] {
  const facts = new Map<string, NewFileDeliveryFact>()
  for (const tool of record.tools) {
    const data = tool.result?.kind === 'read' && tool.result.data && typeof tool.result.data === 'object'
      ? tool.result.data as Record<string, unknown> : null
    if (fileCreated(tool.call.name, tool.result) && typeof data?.documentId === 'string') {
      const label = typeof data.path === 'string' ? data.path.split(/[\\/]/).at(-1)! : data.documentId
      if (!facts.has(data.documentId)) facts.set(data.documentId, { documentId: data.documentId,
        label: label.slice(0, 160), revision: null, savedRevision: null })
    }
    const mutation = tool.result?.kind === 'document-operation' ? tool.result.result
      : tool.call.name === 'file.patch' && data?.documentResult && typeof data.documentResult === 'object'
        ? data.documentResult as Record<string, unknown> : null
    if (mutation?.status === 'applied' && typeof mutation.documentId === 'string'
      && typeof mutation.revision === 'number' && Number.isSafeInteger(mutation.revision)) {
      const fact = facts.get(mutation.documentId)
      if (fact) fact.revision = mutation.revision
    }
    if (tool.call.name === 'file.save' && data?.status === 'saved' && typeof data.documentId === 'string'
      && typeof data.savedRevision === 'number' && Number.isSafeInteger(data.savedRevision)) {
      const fact = facts.get(data.documentId)
      if (fact) {
        fact.savedRevision = data.savedRevision
        if (data.dirty === true && typeof data.currentRevision === 'number') fact.revision = data.currentRevision
      }
    }
  }
  return [...facts.values()]
}
const unconfirmedSave = (fact: NewFileDeliveryFact) => fact.revision !== null
  && (fact.savedRevision === null || fact.savedRevision < fact.revision)

export function hasUnresolvedToolFailure(record: ExecutionRunRecord): boolean {
  return unresolvedToolFailures(record).length > 0 || newFileDeliveryFacts(record).some(unconfirmedSave)
}

/** Only receipt-backed facts are summarized; scratch cleanup is not a new task failure. */
export function runEndSummary(record: ExecutionRunRecord): string | undefined {
  if (record.status === 'completed') return record.failure?.message
  const parts: string[] = []
  if (record.status === 'stopped') parts.push('任务已停止')
  else if (record.failure?.message) parts.push(record.failure.message)
  else if (record.status === 'partial') {
    const latest = unresolvedToolFailures(record).at(-1)
    const message = latest ? serviceToolOutcome(latest.call.name, latest.result)?.message
      ?? (latest.result?.kind === 'error' ? latest.result.message : '存在未完成的工具操作') : null
    if (message) parts.push(message)
  }
  const directApplied = record.tools.filter(tool => tool.call.name !== 'build.import'
    && tool.result?.kind === 'document-operation' && tool.result.result.status === 'applied').length
  const importApplied = record.tools.filter(tool => tool.call.name === 'build.import'
    && tool.result?.kind === 'document-operation' && tool.result.result.status === 'applied').length
  if (directApplied) parts.push(`已保留 ${directApplied} 项正式文档修改`)
  if (importApplied) parts.push(`已正式导入 ${importApplied} 项构建成果`)
  const createdFiles = record.tools.filter(tool => fileCreated(tool.call.name, tool.result)).length
  if (createdFiles) parts.push(`已创建 ${createdFiles} 个文件`)
  const fileFacts = newFileDeliveryFacts(record)
  const unsaved = fileFacts.filter(unconfirmedSave)
  if (unsaved.length) parts.push(`新文件的修改尚未确认保存：${unsaved.map(fact => `${fact.label}（文档版本 ${fact.revision}）`).join('、')}；可恢复状态不等于目标文件已写盘`)
  const scaffolds = fileFacts.filter(fact => fact.revision === null && /\.h5lesson$/i.test(fact.label))
  if (scaffolds.length) parts.push(`仅有创建回执、未见课件内容提交：${scaffolds.map(fact => fact.label).join('、')}`)
  const savedArtifacts = record.tools.filter(tool => tool.call.name === 'artifact.save'
    && serviceToolOutcome(tool.call.name, tool.result)?.status === 'written').length
  if (savedArtifacts) parts.push(`已保存 ${savedArtifacts} 项作业成果`)
  const attemptedJobs = new Set(record.tools.filter(tool => tool.call.name.startsWith('build.')).map(jobOf).filter((job): job is string => !!job))
  const imported = importedJobs(record)
  if ([...attemptedJobs].some(job => !imported.has(job))) parts.push('构建尚未正式导入')
  const unresolved = record.status === 'partial' ? unresolvedToolFailures(record) : []
  const ambiguousReadAfterEdit = !record.failure && (directApplied > 0 || importApplied > 0)
    && unresolved.length > 0 && unresolved.every(tool => (tool.call.name === 'read' || tool.call.name === 'inspect')
      && tool.result?.kind === 'error' && (tool.result.code === 'invalid-target' || tool.result.code === 'target-conflict'))
  if (record.status === 'partial' && ambiguousReadAfterEdit) parts.push('读取尝试失败，修改已应用；是否遗漏参考内容仍需确认')
  else if (record.status === 'stopped' || record.status === 'partial') parts.push('剩余工作未完成')
  return parts.length ? `${parts.join('；')}。` : undefined
}
