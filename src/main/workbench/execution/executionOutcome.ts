import type { ExecutionRunRecord, ExecutionToolRecord } from '../../../shared/workbench/execution'
import type { ToolResult } from '../../../shared/workbench/tools'
import { USER_QUESTION_TOOL } from '../../../shared/workbench/userQuestion'

export const committed = (result?: ToolResult): result is Extract<ToolResult, { kind: 'document-operation' }> =>
  result?.kind === 'document-operation' && (result.result.status === 'applied' || result.result.status === 'unchanged')

export const fileCreated = (name: string, result?: ToolResult): boolean => name === 'file.create' && result?.kind === 'read'
  && !!result.data && typeof result.data === 'object'
  && (result.data as { operation?: { status?: unknown } }).operation?.status === 'success'

export interface ServiceToolOutcome { status: 'failed' | 'unknown' | 'stopped'; message: string }

/** Only tools whose read receipt is itself a service job use its status for task settlement. */
export const serviceToolOutcome = (name: string, result?: ToolResult): ServiceToolOutcome | null => {
  if (result?.kind !== 'read' || !result.data || typeof result.data !== 'object') return null
  const data = result.data as Record<string, unknown>
  if (name === 'file.create' && data.operation && typeof data.operation === 'object') {
    const operation = data.operation as { status?: unknown; items?: { error?: { message?: string } }[] }
    if (operation.status === 'failed' || operation.status === 'cancelled' || operation.status === 'partial')
      return { status: 'failed', message: operation.items?.find(item => item.error?.message)?.error?.message ?? '新建文件未完整成功' }
  }
  if (name === 'build.compile' && data.ok === false) return { status: 'failed', message: typeof data.message === 'string' ? data.message : '构建语法编译未通过' }
  if (name === 'build.check' && (data.status === 'failed' || data.status === 'cancelled' || data.status === 'exhausted')) {
    return { status: 'failed', message: data.status === 'failed' ? '构建检查未通过，请读取构建日志' : data.status === 'cancelled' ? '构建检查已取消' : '构建检查已耗尽预算' }
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
    if (data.status === 'preparing' || data.status === 'running') return { status: 'unknown', message: '图片任务尚未结束，成果状态未确认' }
  }
  return null
}

export const toolFailed = (name: string, result?: ToolResult) => result?.kind === 'error' ||
  result?.kind === 'document-operation' && !committed(result) || serviceToolOutcome(name, result) !== null

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
function unresolvedToolFailures(record: ExecutionRunRecord): ExecutionToolRecord[] {
  const lastImportByJob = new Map<string, number>()
  record.tools.forEach((tool, index) => {
    const job = jobOf(tool)
    if (tool.call.name === 'build.import' && committed(tool.result) && job) lastImportByJob.set(job, index)
  })
  return record.tools.filter((tool, index) => {
    // An unanswered or malformed question changed nothing; it is not an unfinished document operation.
    if (tool.call.name === USER_QUESTION_TOOL || !toolFailed(tool.call.name, tool.result)) return false
    // A modification the user declined is the user's decision, not an unfinished operation.
    if (tool.result?.kind === 'error' && tool.result.code === 'user-denied') return false
    const job = jobOf(tool)
    return !(tool.call.name.startsWith('build.') && job && (lastImportByJob.get(job) ?? -1) > index)
  })
}

export function hasUnresolvedToolFailure(record: ExecutionRunRecord): boolean {
  return unresolvedToolFailures(record).length > 0
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
