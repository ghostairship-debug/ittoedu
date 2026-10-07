import { isDeepStrictEqual } from 'node:util'
import type { ManagedBrowserTool } from './ManagedBrowserMcpService'

export interface BrowserActionApproval {
  runId: string
  operationId: string
  tool: ManagedBrowserTool
  arguments: Record<string, unknown>
  snapshotId: string
}

/** Host-observed effects; page/model descriptions never supply this classification. */
export type BrowserActionKind = 'prepare' | 'submit' | 'upload' | 'download' | 'unknown'
export type BrowserTaskAction = BrowserActionApproval & { pageUrl: string; action: BrowserActionKind }
export type BrowserTaskAuthorizer = (input: BrowserTaskAction) => boolean | Promise<boolean>

interface RunApprovals {
  pending: Map<string, BrowserActionApproval>
  consumed: Set<string>
  authorizeTaskAction?: BrowserTaskAuthorizer
  generation: number
}

function normalized(input: BrowserActionApproval): BrowserActionApproval {
  const args = structuredClone(input.arguments)
  if (args.snapshotId !== undefined && args.snapshotId !== input.snapshotId)
    throw new Error('浏览器批准的观察身份与工具参数不一致')
  delete args.snapshotId
  return { ...input, arguments: args }
}

/** Task authority and UI decisions both produce the same one-use, observed action grant. */
export class BrowserActionApprovals {
  private readonly runs = new Map<string, RunApprovals>()

  beginRun(runId: string, authorizeTaskAction?: BrowserTaskAuthorizer): void {
    if (!runId || this.runs.has(runId)) throw new Error('浏览器批准任务身份重复或无效')
    this.runs.set(runId, { pending: new Map(), consumed: new Set(), authorizeTaskAction, generation: 0 })
  }

  /** Main supplies the frozen task authority; this owner never infers it from a prompt or permission label. */
  async grantFromTask(input: BrowserTaskAction): Promise<boolean> {
    const run = this.runs.get(input.runId)
    if (!run?.authorizeTaskAction || run.consumed.has(input.operationId)) return false
    const generation = run.generation
    const approval = normalized({ runId: input.runId, operationId: input.operationId, tool: input.tool,
      arguments: input.arguments, snapshotId: input.snapshotId })
    const authorized = await run.authorizeTaskAction({ ...structuredClone(approval), pageUrl: input.pageUrl, action: input.action })
    if (!authorized || this.runs.get(input.runId) !== run || run.generation !== generation) return false
    this.grant(approval)
    return true
  }

  grant(input: BrowserActionApproval): void {
    const run = this.runs.get(input.runId)
    if (!run) throw new Error('浏览器任务未运行，无法登记外部写入批准')
    if (!['browser_click', 'browser_type', 'browser_file_upload'].includes(input.tool)
      || !input.operationId || !input.snapshotId
      || !input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments))
      throw new Error('浏览器批准必须绑定具体写入、操作身份和页面观察')
    if (run.consumed.has(input.operationId)) throw new Error('浏览器操作批准已经使用')
    const approval = normalized(input)
    const prior = run.pending.get(input.operationId)
    if (prior) {
      if (!isDeepStrictEqual(prior, approval)) throw new Error('同一浏览器操作不能更换已批准参数')
      return
    }
    run.pending.set(input.operationId, approval)
  }

  consume(input: BrowserActionApproval): boolean {
    const run = this.runs.get(input.runId)
    if (!run) return false
    const entry = run.pending.get(input.operationId)
    if (!entry) return false
    run.pending.delete(input.operationId)
    run.consumed.add(input.operationId)
    try { return isDeepStrictEqual(entry, normalized(input)) }
    catch { return false }
  }

  invalidate(runId: string): void {
    const run = this.runs.get(runId)
    if (run) { run.pending.clear(); run.generation++ }
  }

  revokeRun(runId: string): void { this.runs.delete(runId) }
}
