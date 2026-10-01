import { isDeepStrictEqual } from 'node:util'
import type { ManagedBrowserTool } from './ManagedBrowserMcpService'

export interface BrowserActionApproval {
  runId: string
  operationId: string
  tool: ManagedBrowserTool
  arguments: Record<string, unknown>
  snapshotId: string
}

interface RunApprovals {
  pending: Map<string, { approval: BrowserActionApproval; expiresAt: number }>
  consumed: Set<string>
}

function normalized(input: BrowserActionApproval): BrowserActionApproval {
  const args = structuredClone(input.arguments)
  if (args.snapshotId !== undefined && args.snapshotId !== input.snapshotId)
    throw new Error('浏览器批准的观察身份与工具参数不一致')
  delete args.snapshotId
  return { ...input, arguments: args }
}

/** A UI decision is a one-use grant for one observed browser action, never a run-wide write flag. */
export class BrowserActionApprovals {
  private readonly runs = new Map<string, RunApprovals>()

  beginRun(runId: string): void {
    if (!runId || this.runs.has(runId)) throw new Error('浏览器批准任务身份重复或无效')
    this.runs.set(runId, { pending: new Map(), consumed: new Set() })
  }

  grant(input: BrowserActionApproval): void {
    const run = this.runs.get(input.runId)
    if (!run) throw new Error('浏览器任务未运行，无法登记外部写入批准')
    if (!['browser_click', 'browser_type', 'browser_file_upload'].includes(input.tool)
      || !input.operationId || input.operationId.length > 512 || !input.snapshotId || input.snapshotId.length > 512
      || !input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments))
      throw new Error('浏览器批准必须绑定具体写入、操作身份和页面观察')
    if (run.consumed.has(input.operationId)) throw new Error('浏览器操作批准已经使用')
    const approval = normalized(input)
    const prior = run.pending.get(input.operationId)
    if (prior) {
      if (!isDeepStrictEqual(prior.approval, approval)) throw new Error('同一浏览器操作不能更换已批准参数')
      return
    }
    if (run.pending.size >= 100) throw new Error('本任务待执行的浏览器批准过多')
    run.pending.set(input.operationId, { approval, expiresAt: Date.now() + 2 * 60_000 })
  }

  consume(input: BrowserActionApproval): boolean {
    const run = this.runs.get(input.runId)
    if (!run) return false
    const entry = run.pending.get(input.operationId)
    if (!entry) return false
    run.pending.delete(input.operationId)
    run.consumed.add(input.operationId)
    try { return entry.expiresAt >= Date.now() && isDeepStrictEqual(entry.approval, normalized(input)) }
    catch { return false }
  }

  invalidate(runId: string): void { this.runs.get(runId)?.pending.clear() }

  revokeRun(runId: string): void { this.runs.delete(runId) }
}
